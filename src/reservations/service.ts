import { reserveSlot, type ReserveInput } from "./reserve.js";
import { scheduleExpiry } from "../jobs/scheduleExpiry.js";

/**
 * Book a slot and arm its precise expiry. The atomic reservation is the
 * guarantee; scheduling is best-effort (the periodic sweep is the backstop if
 * the enqueue fails or the worker was down).
 */
export async function createReservation(input: ReserveInput) {
  const reservation = await reserveSlot(input);
  await scheduleExpiry(reservation.id, reservation.reservedUntil);
  return reservation;
}
