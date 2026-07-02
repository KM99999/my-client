import { prisma } from "../db/prisma.js";
import { releaseReservation } from "./releaseReservation.js";
import { logger } from "../config/logger.js";

/**
 * Safety-net sweep: find every reservation still Active past its TTL and run
 * the (lock-checked) release path on each. Covers the case where a precise
 * pg-boss expiry job was missed — worker restart, crash, clock skew.
 *
 * Returns the number of reservations actually released this pass.
 */
export async function sweepExpiredReservations(now = new Date()): Promise<number> {
  const due = await prisma.reservation.findMany({
    where: { status: "Active", reservedUntil: { lte: now } },
    select: { id: true },
    take: 500, // bound the batch; the next tick picks up the rest
  });

  let released = 0;
  for (const r of due) {
    try {
      const result = await releaseReservation(r.id, now);
      if (result.released) released++;
    } catch (err) {
      logger.error({ err, reservationId: r.id }, "sweep: release failed");
    }
  }

  if (released > 0) logger.info({ released }, "sweep released expired reservations");
  return released;
}
