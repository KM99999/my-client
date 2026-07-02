import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import {
  reserveSlot,
  SlotUnavailableError,
} from "../../src/reservations/reserve.js";
import { resetDb, seedOneSlot, patient } from "./helpers.js";

// Client acceptance criterion #1: concurrent booking on one slot yields
// exactly one success — never two, never a 500.
describe("reserve race (row-level lock)", () => {
  beforeAll(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDb();
  });

  const CONTENDERS = 50;

  it(`fires ${CONTENDERS} concurrent reserves at one slot -> exactly 1 success`, async () => {
    const { slotId } = await seedOneSlot();

    const results = await Promise.allSettled(
      Array.from({ length: CONTENDERS }, () =>
        reserveSlot({ slotId, ...patient })
      )
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one caller wins.
    expect(fulfilled).toHaveLength(1);
    // Everyone else loses cleanly with SlotUnavailableError — no other error type.
    expect(rejected).toHaveLength(CONTENDERS - 1);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(
        SlotUnavailableError
      );
    }

    // Database reality must match the HTTP-level truth.
    const slot = await prisma.appointmentSlot.findUniqueOrThrow({
      where: { id: slotId },
    });
    expect(slot.status).toBe("Reserved");

    const reservations = await prisma.reservation.findMany({
      where: { slotId },
    });
    expect(reservations).toHaveLength(1);
    expect(reservations[0].status).toBe("Active");
  });

  // Race conditions are probabilistic — a single green run proves nothing.
  // Repeat the contest so the guarantee is demonstrated, not merely observed once.
  it("holds across 20 repeated rounds", async () => {
    for (let round = 0; round < 20; round++) {
      await resetDb();
      const { slotId } = await seedOneSlot();

      const results = await Promise.allSettled(
        Array.from({ length: CONTENDERS }, () =>
          reserveSlot({ slotId, ...patient })
        )
      );

      const successes = results.filter((r) => r.status === "fulfilled").length;
      expect(successes, `round ${round} had ${successes} successes`).toBe(1);

      const count = await prisma.reservation.count({ where: { slotId } });
      expect(count, `round ${round} reservation rows`).toBe(1);
    }
  });
});
