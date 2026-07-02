// Database-level concurrency proof, driver-agnostic (pure-JS `pg`).
//
// Mirrors reserveSlot()'s transaction exactly (SELECT … FOR UPDATE → check →
// UPDATE slot → INSERT reservation → COMMIT) and fires N concurrent attempts at
// one slot, asserting exactly one succeeds. This validates acceptance criterion
// #1 at the storage layer, independent of the ORM/runtime.
//
// Usage: node scripts/verify-locking.mjs [contenders] [rounds]

import "dotenv/config";
import pg from "pg";
import { randomUUID } from "node:crypto";

const CONTENDERS = Number(process.argv[2] ?? 50);
const ROUNDS = Number(process.argv[3] ?? 20);

// Strip Prisma-only query params; keep a generous pool for the race.
const raw = process.env.DATABASE_URL;
const connectionString = raw.split("?")[0];
const pool = new pg.Pool({ connectionString, max: CONTENDERS + 5 });

class SlotUnavailable extends Error {}

async function reserve(slotId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      'SELECT id, status FROM "AppointmentSlot" WHERE id = $1 FOR UPDATE',
      [slotId]
    );
    const slot = rows[0];
    if (!slot) throw new SlotUnavailable("not found");
    if (slot.status !== "Available") throw new SlotUnavailable("taken");

    await client.query(
      'UPDATE "AppointmentSlot" SET status = $1, version = version + 1 WHERE id = $2',
      ["Reserved", slotId]
    );
    const reservedUntil = new Date(Date.now() + 10 * 60_000);
    await client.query(
      `INSERT INTO "Reservation"
         (id, "slotId", "patientName", "patientEmail", "patientPhone", status, "reservedUntil")
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), slotId, "Load", "load@test.dev", "+550000000000", "Active", reservedUntil]
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function resetAndSeed() {
  await pool.query('DELETE FROM "EventLog"');
  await pool.query('DELETE FROM "Payment"');
  await pool.query('DELETE FROM "Reservation"');
  await pool.query('DELETE FROM "AppointmentSlot"');
  await pool.query('DELETE FROM "AvailabilityTemplate"');
  await pool.query('DELETE FROM "Doctor"');
  const doctorId = randomUUID();
  await pool.query('INSERT INTO "Doctor" (id, name) VALUES ($1,$2)', [
    doctorId,
    "Race Doc",
  ]);
  const slotId = randomUUID();
  await pool.query(
    'INSERT INTO "AppointmentSlot" (id, "doctorId", "startsAt", "endsAt", status) VALUES ($1,$2,$3,$4,$5)',
    [slotId, doctorId, new Date("2026-08-01T09:00:00Z"), new Date("2026-08-01T09:30:00Z"), "Available"]
  );
  return slotId;
}

async function main() {
  console.log(`Concurrency proof: ${CONTENDERS} contenders x ${ROUNDS} rounds\n`);
  let allGreen = true;

  for (let round = 1; round <= ROUNDS; round++) {
    const slotId = await resetAndSeed();
    const results = await Promise.allSettled(
      Array.from({ length: CONTENDERS }, () => reserve(slotId))
    );
    const successes = results.filter((r) => r.status === "fulfilled").length;
    const cleanLosses = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof SlotUnavailable
    ).length;
    const dirtyErrors = results.filter(
      (r) => r.status === "rejected" && !(r.reason instanceof SlotUnavailable)
    );

    const slot = (
      await pool.query('SELECT status FROM "AppointmentSlot" WHERE id = $1', [slotId])
    ).rows[0];
    const resCount = Number(
      (await pool.query('SELECT count(*)::int AS c FROM "Reservation" WHERE "slotId" = $1', [slotId]))
        .rows[0].c
    );

    const ok =
      successes === 1 &&
      cleanLosses === CONTENDERS - 1 &&
      dirtyErrors.length === 0 &&
      slot.status === "Reserved" &&
      resCount === 1;
    allGreen &&= ok;

    console.log(
      `round ${String(round).padStart(2)}: ${ok ? "PASS" : "FAIL"} ` +
        `| successes=${successes} cleanLosses=${cleanLosses} ` +
        `dirtyErrors=${dirtyErrors.length} slot=${slot.status} reservations=${resCount}`
    );
    if (dirtyErrors.length) console.log("   dirty:", dirtyErrors[0].reason?.message);
  }

  await pool.end();
  console.log(`\n${allGreen ? "✅ ALL ROUNDS PASSED" : "❌ SOME ROUNDS FAILED"}`);
  process.exit(allGreen ? 0 : 1);
}

main().catch((e) => {
  console.error("harness error:", e);
  process.exit(2);
});
