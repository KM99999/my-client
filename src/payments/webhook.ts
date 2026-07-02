import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { getProvider } from "./registry.js";
import type { PaymentProvider } from "./provider.js";
import { logEvent } from "../db/eventLog.js";
import { logger } from "../config/logger.js";

export interface WebhookResult {
  httpStatus: number;
  body: unknown;
}

/**
 * Signature-verified, idempotent payment webhook.
 *
 * The exception matrix the client scrutinized is resolved here, all under the
 * SAME row lock the expiry job takes — so the payment-at-expiry race always
 * ends in exactly one consistent state:
 *
 *   approved + slot still Reserved by this reservation -> confirm (slot Paid)
 *   approved + slot already released/re-sold           -> refund (never confirm)
 *   rejected                                           -> leave slot to expire
 *
 * Idempotency is guaranteed at the storage layer: the unique
 * (provider, providerEventId) index makes any replay a no-op.
 */
export async function handleWebhook(
  rawBody: Buffer,
  signature: string | undefined,
  provider: PaymentProvider = getProvider()
): Promise<WebhookResult> {
  // 1. Reject tampered/unsigned payloads.
  if (!provider.verifyWebhook(rawBody, signature)) {
    return { httpStatus: 401, body: { error: "invalid_signature" } };
  }

  // 2. Parse to the normalized shape.
  let event;
  try {
    event = provider.parseEvent(rawBody);
  } catch {
    return { httpStatus: 400, body: { error: "unparseable_body" } };
  }
  if (!event.providerEventId) {
    return { httpStatus: 400, body: { error: "missing_event_id" } };
  }

  // 3. Record the event; a duplicate delivery short-circuits to a 200 no-op.
  try {
    await prisma.webhookEvent.create({
      data: { provider: provider.name, providerEventId: event.providerEventId },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { httpStatus: 200, body: { status: "duplicate_ignored" } };
    }
    throw e;
  }

  // Provider refund (external I/O) is dispatched AFTER the transaction commits,
  // so we never hold a row lock across a network call.
  let refundRef: string | null = null;

  await prisma.$transaction(
    async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { provider: provider.name, providerRef: event.providerRef },
      });
      if (!payment) {
        await logEvent(
          "webhook_no_payment",
          { payload: { providerRef: event.providerRef } },
          tx
        );
        return;
      }

      // Lock reservation + slot together (same lock the expiry job takes).
      const rows = await tx.$queryRaw<
        { reservationStatus: string; slotId: string; slotStatus: string }[]
      >`
        SELECT r.status AS "reservationStatus",
               s.id     AS "slotId",
               s.status AS "slotStatus"
        FROM "Reservation" r
        JOIN "AppointmentSlot" s ON s.id = r."slotId"
        WHERE r.id = ${payment.reservationId}
        FOR UPDATE OF r, s`;
      const row = rows[0];

      if (event.status === "approved") {
        const stillHeld =
          row && row.slotStatus === "Reserved" && row.reservationStatus === "Active";
        if (stillHeld) {
          await tx.appointmentSlot.update({
            where: { id: row.slotId },
            data: { status: "Paid", version: { increment: 1 } },
          });
          await tx.reservation.update({
            where: { id: payment.reservationId },
            data: { status: "Paid" },
          });
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: "Approved" },
          });
          await logEvent(
            "payment_approved",
            { slotId: row.slotId, refId: payment.reservationId },
            tx
          );
        } else {
          // Slot was released/re-sold/expired before this landed — do NOT
          // confirm; void the charge instead.
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: "Refunded" },
          });
          if (payment.providerRef) refundRef = payment.providerRef;
          await logEvent(
            "payment_refunded_after_release",
            { slotId: row?.slotId, refId: payment.reservationId },
            tx
          );
        }
      } else if (event.status === "rejected") {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: "Rejected" },
        });
        await logEvent(
          "payment_rejected",
          { slotId: row?.slotId, refId: payment.reservationId },
          tx
        );
        // Leave the slot to expire naturally via the reservation TTL.
      } else {
        await logEvent(
          "payment_pending",
          { refId: payment.reservationId },
          tx
        );
      }

      await tx.webhookEvent.update({
        where: {
          provider_providerEventId: {
            provider: provider.name,
            providerEventId: event.providerEventId,
          },
        },
        data: { processedAt: new Date() },
      });
    },
    { maxWait: 10_000, timeout: 20_000 }
  );

  if (refundRef) {
    try {
      await provider.refund(refundRef);
    } catch (err) {
      // The payment is already marked Refunded; surface for manual/ops retry.
      // TODO(prod): move refund dispatch to a durable pg-boss job with retries.
      logger.error({ err, providerRef: refundRef }, "refund dispatch failed");
    }
  }

  return { httpStatus: 200, body: { status: "processed" } };
}
