import { prisma } from "../src/db/prisma.js";
import { materializeSlots } from "../src/slots/materialize.js";
import { logger } from "../src/config/logger.js";

/**
 * Seed a demo clinic: one doctor with weekday templates and limited Sunday
 * hours, then materialize concrete slots so the booking + concurrency flows
 * have real rows to lock. Idempotent — safe to re-run.
 */
async function main() {
  const doctor = await prisma.doctor.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Dra. Ana Souza",
      specialty: "Clínica Geral",
      active: true,
    },
  });

  // Mon–Fri full day; Saturday morning; Sunday narrow hours.
  const templates: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    slotMinutes: number;
  }> = [
    ...[1, 2, 3, 4, 5].map((dayOfWeek) => ({
      dayOfWeek,
      startTime: "09:00",
      endTime: "17:00",
      slotMinutes: 30,
    })),
    { dayOfWeek: 6, startTime: "09:00", endTime: "12:00", slotMinutes: 30 },
    { dayOfWeek: 0, startTime: "10:00", endTime: "12:00", slotMinutes: 30 }, // limited Sunday
  ];

  // Clear+recreate this doctor's templates so re-seeding stays deterministic.
  await prisma.availabilityTemplate.deleteMany({
    where: { doctorId: doctor.id },
  });
  await prisma.availabilityTemplate.createMany({
    data: templates.map((t) => ({ ...t, doctorId: doctor.id })),
  });

  const created = await materializeSlots();

  logger.info(
    { doctorId: doctor.id, templates: templates.length, slotsCreated: created },
    "seed complete"
  );
}

main()
  .catch((e) => {
    logger.error(e, "seed failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
