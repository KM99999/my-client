import PgBoss from "pg-boss";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

export const RELEASE_QUEUE = "release-reservation";
export const SWEEP_QUEUE = "sweep-expired";
export const MATERIALIZE_QUEUE = "materialize-slots";

// pg-boss stores its queue in the same Postgres, so no Redis is needed for M1.
export const boss = new PgBoss({ connectionString: env.DATABASE_URL });

boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

/**
 * Enqueue a precise expiry job to fire at `runAt` (the reservation's
 * reservedUntil). The periodic sweep is the backstop if this job is ever lost.
 *
 * Best-effort: if enqueuing fails we log and carry on — the sweep still
 * guarantees the slot is eventually freed.
 */
export async function scheduleExpiry(reservationId: string, runAt: Date): Promise<void> {
  try {
    await boss.send(RELEASE_QUEUE, { reservationId }, { startAfter: runAt });
  } catch (err) {
    logger.error(
      { err, reservationId },
      "failed to schedule precise expiry; sweep will cover it"
    );
  }
}
