import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { reserveSlot } from "../../src/reservations/reserve.js";
import { releaseReservation } from "../../src/jobs/releaseReservation.js";
import { sweepExpiredReservations } from "../../src/jobs/sweep.js";
import { resetDb, seedOneSlot, patient } from "./helpers.js";

// Client acceptance criterion #3: expired reservations auto-release, via both
// the precise job path (releaseReservation) and the sweep backstop.
describe("reservation expiry", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  async function expire(reservationId: string) {
    // Simulate the TTL elapsing by moving reservedUntil into the past.
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { reservedUntil: new Date(Date.now() - 60_000) },
    });
  }

  it("releases an expired reservation and frees the slot", async () => {
    const { slotId } = await seedOneSlot();
    const reservation = await reserveSlot({ slotId, ...patient });
    await expire(reservation.id);

    const result = await releaseReservation(reservation.id);
    expect(result.released).toBe(true);

    const slot = await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: slotId } });
    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(slot.status).toBe("Available");
    expect(after.status).toBe("Expired");
  });

  it("does not release a reservation that is not yet due", async () => {
    const { slotId } = await seedOneSlot();
    const reservation = await reserveSlot({ slotId, ...patient });

    const result = await releaseReservation(reservation.id);
    expect(result.released).toBe(false);

    const slot = await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: slotId } });
    expect(slot.status).toBe("Reserved");
  });

  it("the sweep backstop releases anything past TTL (missed precise job)", async () => {
    const { slotId } = await seedOneSlot();
    const reservation = await reserveSlot({ slotId, ...patient });
    await expire(reservation.id);

    const released = await sweepExpiredReservations();
    expect(released).toBeGreaterThanOrEqual(1);

    const slot = await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: slotId } });
    expect(slot.status).toBe("Available");
  });
});
