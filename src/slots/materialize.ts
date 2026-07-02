import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { iterateSlots } from "./slotMath.js";

export { iterateSlots } from "./slotMath.js";
export type { SlotTemplate, MaterializedSlot } from "./slotMath.js";

/**
 * Turn active templates into concrete AppointmentSlot rows over a rolling
 * window. This is what makes row-level locking possible — you can only
 * `FOR UPDATE` a row that already exists.
 *
 * Idempotent: upserts on the (doctorId, startsAt) unique key and never disturbs
 * an already-Reserved/Paid slot, so it is safe to re-run nightly.
 *
 * Returns the number of newly created slots (existing slots are left untouched).
 */
export async function materializeSlots(now = new Date()): Promise<number> {
  const doctors = await prisma.doctor.findMany({
    where: { active: true },
    include: { templates: { where: { active: true } } },
  });

  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + env.SLOT_MATERIALIZATION_WEEKS * 7);

  let created = 0;

  for (const doctor of doctors) {
    for (
      let day = new Date(now);
      day <= horizon;
      day.setDate(day.getDate() + 1)
    ) {
      const dow = day.getDay();
      const templates = doctor.templates.filter((t) => t.dayOfWeek === dow);

      for (const t of templates) {
        for (const { startsAt, endsAt } of iterateSlots(day, t)) {
          if (startsAt < now) continue;

          // Upsert keeps re-runs idempotent. To count only genuinely new slots
          // we check existence first; the unique (doctorId, startsAt) index
          // still guarantees no duplicate is ever written under a race.
          const existing = await prisma.appointmentSlot.findUnique({
            where: { doctorId_startsAt: { doctorId: doctor.id, startsAt } },
            select: { id: true },
          });

          await prisma.appointmentSlot.upsert({
            where: {
              doctorId_startsAt: { doctorId: doctor.id, startsAt },
            },
            create: {
              doctorId: doctor.id,
              startsAt,
              endsAt,
              status: "Available",
            },
            update: {}, // never disturb existing slot state
          });

          if (!existing) created++;
        }
      }
    }
  }

  return created;
}
