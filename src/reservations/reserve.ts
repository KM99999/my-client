import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { logEvent } from "../db/eventLog.js";

/** Thrown when a slot cannot be reserved (missing or no longer Available). */
export class SlotUnavailableError extends Error {
  constructor(message = "Slot is no longer available") {
    super(message);
    this.name = "SlotUnavailableError";
  }
}

export interface ReserveInput {
  slotId: string;
  patientName: string;
  patientEmail: string;
  patientPhone: string;
}

/**
 * The single most important function in the project.
 *
 * Uses a raw `SELECT … FOR UPDATE` inside a Prisma interactive transaction so
 * two concurrent callers cannot both win the same slot: the second caller
 * blocks on the row lock, then reads the updated status and loses cleanly.
 *
 * The DB constraints (`Reservation.slotId` unique, `one_live_slot_hold`) are the
 * backstop — even if this logic were wrong, the database would refuse a second
 * live hold on the slot.
 */
export async function reserveSlot(input: ReserveInput) {
  return prisma.$transaction(
    async (tx) => {
      // Lock exactly this slot row. Concurrent callers block here, then read
      // the updated status and lose cleanly.
      const rows = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status FROM "AppointmentSlot"
        WHERE id = ${input.slotId}
        FOR UPDATE`;

      const slot = rows[0];
      if (!slot) throw new SlotUnavailableError("Slot not found");
      if (slot.status !== "Available") {
        throw new SlotUnavailableError("Slot is no longer available");
      }

      const reservedUntil = new Date(
        Date.now() + env.RESERVATION_TTL_MINUTES * 60_000
      );

      await tx.appointmentSlot.update({
        where: { id: slot.id },
        data: { status: "Reserved", version: { increment: 1 } },
      });

      const reservation = await tx.reservation.create({
        data: {
          slotId: slot.id,
          patientName: input.patientName,
          patientEmail: input.patientEmail,
          patientPhone: input.patientPhone,
          status: "Active",
          reservedUntil,
        },
      });

      // Logged inside the transaction so the event and the state change commit
      // atomically together.
      await logEvent(
        "slot_reserved",
        { slotId: slot.id, refId: reservation.id },
        tx
      );

      return reservation;
    },
    // Under a burst of concurrent reserves, callers queue on the row lock and
    // for a connection-pool slot. Give them room to wait rather than failing
    // with a pool/lock-wait timeout (which would look like an error, not the
    // clean "unavailable" the loser should get).
    { maxWait: 10_000, timeout: 20_000 }
  );
}
