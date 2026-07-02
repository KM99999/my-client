import { prisma } from "../db/prisma.js";
import { logEvent } from "../db/eventLog.js";

export interface ReleaseResult {
  released: boolean;
  reason: string;
}

/**
 * Release an expired reservation and free its slot — always re-checked under a
 * row lock, never released blindly. This is the same lock the payment webhook
 * takes, so the payment-at-expiry race resolves to exactly one winner.
 *
 * Idempotent and safe to call from both the precise pg-boss job and the
 * periodic sweep: if the reservation was already paid or already released, it
 * does nothing.
 */
export async function releaseReservation(
  reservationId: string,
  now = new Date()
): Promise<ReleaseResult> {
  return prisma.$transaction(
    async (tx) => {
      // Lock the reservation and its slot together so a concurrent payment
      // webhook cannot flip them underneath us.
      const rows = await tx.$queryRaw<
        {
          reservationId: string;
          reservationStatus: string;
          reservedUntil: Date;
          slotId: string;
          slotStatus: string;
        }[]
      >`
        SELECT r.id           AS "reservationId",
               r.status       AS "reservationStatus",
               r."reservedUntil" AS "reservedUntil",
               s.id           AS "slotId",
               s.status       AS "slotStatus"
        FROM "Reservation" r
        JOIN "AppointmentSlot" s ON s.id = r."slotId"
        WHERE r.id = ${reservationId}
        FOR UPDATE OF r, s`;

      const row = rows[0];
      if (!row) return { released: false, reason: "reservation_not_found" };

      const stillActive = row.reservationStatus === "Active";
      const expired = now >= new Date(row.reservedUntil);
      const slotHeld = row.slotStatus === "Reserved";

      if (!(stillActive && expired && slotHeld)) {
        // It was paid, already released, or not yet due — leave it alone.
        return {
          released: false,
          reason: `noop(active=${stillActive},expired=${expired},slotReserved=${slotHeld})`,
        };
      }

      await tx.appointmentSlot.update({
        where: { id: row.slotId },
        data: { status: "Available", version: { increment: 1 } },
      });
      await tx.reservation.update({
        where: { id: row.reservationId },
        data: { status: "Expired" },
      });

      await logEvent(
        "reservation_expired",
        { slotId: row.slotId, refId: row.reservationId },
        tx
      );

      return { released: true, reason: "expired_and_released" };
    },
    { maxWait: 10_000, timeout: 20_000 }
  );
}
