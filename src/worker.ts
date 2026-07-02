import {
  boss,
  RELEASE_QUEUE,
  SWEEP_QUEUE,
  MATERIALIZE_QUEUE,
} from "./jobs/scheduleExpiry.js";
import { releaseReservation } from "./jobs/releaseReservation.js";
import { sweepExpiredReservations } from "./jobs/sweep.js";
import { materializeSlots } from "./slots/materialize.js";
import { logger } from "./config/logger.js";

async function main() {
  await boss.start();

  // pg-boss v10 requires queues to exist before send/work/schedule.
  await boss.createQueue(RELEASE_QUEUE);
  await boss.createQueue(SWEEP_QUEUE);
  await boss.createQueue(MATERIALIZE_QUEUE);

  // Precise, per-reservation expiry (scheduled at reservedUntil).
  await boss.work<{ reservationId: string }>(RELEASE_QUEUE, async ([job]) => {
    const result = await releaseReservation(job.data.reservationId);
    logger.info({ reservationId: job.data.reservationId, ...result }, "release job");
  });

  // Belt-and-suspenders periodic sweep + nightly materialization.
  await boss.work(SWEEP_QUEUE, async () => {
    await sweepExpiredReservations();
  });
  await boss.work(MATERIALIZE_QUEUE, async () => {
    const created = await materializeSlots();
    logger.info({ created }, "nightly materialization");
  });

  await boss.schedule(SWEEP_QUEUE, "* * * * *"); // every minute
  await boss.schedule(MATERIALIZE_QUEUE, "0 3 * * *"); // 03:00 daily

  logger.info("worker started");
}

main().catch((e) => {
  logger.error(e, "worker failed to start");
  process.exit(1);
});
