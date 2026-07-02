import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { getProvider } from "./registry.js";
import type { PaymentMethod, PaymentProvider } from "./provider.js";
import { logEvent } from "../db/eventLog.js";

export class ReservationNotPayableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReservationNotPayableError";
  }
}

export interface StartPaymentInput {
  reservationId: string;
  method: PaymentMethod;
}

/**
 * Begin payment for an active reservation.
 *
 * Idempotent: the idempotency key is stable per (reservation, method), so a
 * retried "start payment" reuses the same Payment row and the provider's own
 * idempotency, never creating a second charge.
 */
export async function startPayment(
  input: StartPaymentInput,
  provider: PaymentProvider = getProvider()
) {
  const reservation = await prisma.reservation.findUnique({
    where: { id: input.reservationId },
  });
  if (!reservation) {
    throw new ReservationNotPayableError("reservation_not_found");
  }
  if (reservation.status !== "Active") {
    throw new ReservationNotPayableError("reservation_not_active");
  }

  const idempotencyKey = `reservation:${reservation.id}:${input.method}`;

  // One Payment row per (reservation, method). Re-running does not duplicate it.
  const payment = await prisma.payment.upsert({
    where: { idempotencyKey },
    update: {},
    create: {
      reservationId: reservation.id,
      provider: provider.name,
      idempotencyKey,
      amountCents: env.DEFAULT_PRICE_CENTS,
      method: input.method,
      status: "Pending",
    },
  });

  const charge = await provider.createCharge({
    amountCents: payment.amountCents,
    method: input.method,
    idempotencyKey,
    reference: reservation.id,
  });

  if (payment.providerRef !== charge.providerRef) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { providerRef: charge.providerRef },
    });
  }

  await logEvent("payment_started", {
    refId: reservation.id,
    payload: { paymentId: payment.id, method: input.method },
  });

  return {
    paymentId: payment.id,
    providerRef: charge.providerRef,
    pixQr: charge.pixQr,
    checkoutUrl: charge.checkoutUrl,
    status: "Pending" as const,
  };
}
