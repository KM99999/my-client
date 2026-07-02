import { prisma } from "../../src/db/prisma.js";

/** Wipe all domain tables in FK-safe order. Used between integration tests. */
export async function resetDb() {
  // Order matters: children before parents.
  await prisma.webhookEvent.deleteMany();
  await prisma.eventLog.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.appointmentSlot.deleteMany();
  await prisma.availabilityTemplate.deleteMany();
  await prisma.doctor.deleteMany();
}

/** Create a doctor with a single Available slot and return their ids. */
export async function seedOneSlot(startsAt = new Date("2026-08-01T09:00:00Z")) {
  const doctor = await prisma.doctor.create({
    data: { name: "Dra. Ana Souza", specialty: "Clínica Geral" },
  });
  const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
  const slot = await prisma.appointmentSlot.create({
    data: {
      doctorId: doctor.id,
      startsAt,
      endsAt,
      status: "Available",
    },
  });
  return { doctorId: doctor.id, slotId: slot.id };
}

export const patient = {
  patientName: "Load Test",
  patientEmail: "load@test.dev",
  patientPhone: "+550000000000",
};
