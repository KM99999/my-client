// Database-level expiry proof, driver-agnostic (pure-JS `pg`).
//
// Mirrors releaseReservation()'s locked logic and checks the three cases the
// client cares about (acceptance criterion #3):
//   1. expired + still Active  -> slot freed to Available, reservation Expired
//   2. not yet due             -> no-op (slot stays Reserved)
//   3. already Paid            -> no-op (never frees a paid slot)
//
// Usage: node scripts/verify-expiry.mjs

import "dotenv/config";
import pg from "pg";
import { randomUUID } from "node:crypto";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL.split("?")[0] });

async function reset() {
  for (const t of [
    "EventLog",
    "Payment",
    "Reservation",
    "AppointmentSlot",
    "AvailabilityTemplate",
    "Doctor",
  ])
    await pool.query(`DELETE FROM "${t}"`);
}

async function seedReservation({ slotStatus, reservationStatus, reservedUntil }) {
  const doctorId = randomUUID();
  const slotId = randomUUID();
  const reservationId = randomUUID();
  await pool.query('INSERT INTO "Doctor"(id,name) VALUES($1,$2)', [doctorId, "Doc"]);
  await pool.query(
    'INSERT INTO "AppointmentSlot"(id,"doctorId","startsAt","endsAt",status) VALUES($1,$2,$3,$4,$5)',
    [slotId, doctorId, new Date("2026-08-01T09:00:00Z"), new Date("2026-08-01T09:30:00Z"), slotStatus]
  );
  await pool.query(
    `INSERT INTO "Reservation"(id,"slotId","patientName","patientEmail","patientPhone",status,"reservedUntil")
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [reservationId, slotId, "P", "p@e.c", "+550000000000", reservationStatus, reservedUntil]
  );
  return { slotId, reservationId };
}

// Faithful port of releaseReservation()'s transaction.
async function release(reservationId, now = new Date()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT r.id AS "reservationId", r.status AS "reservationStatus",
              r."reservedUntil" AS "reservedUntil",
              s.id AS "slotId", s.status AS "slotStatus"
       FROM "Reservation" r JOIN "AppointmentSlot" s ON s.id = r."slotId"
       WHERE r.id = $1 FOR UPDATE OF r, s`,
      [reservationId]
    );
    const row = rows[0];
    if (!row) { await client.query("COMMIT"); return { released: false }; }
    const ok =
      row.reservationStatus === "Active" &&
      now >= new Date(row.reservedUntil) &&
      row.slotStatus === "Reserved";
    if (!ok) { await client.query("COMMIT"); return { released: false }; }
    await client.query('UPDATE "AppointmentSlot" SET status=$1, version=version+1 WHERE id=$2', ["Available", row.slotId]);
    await client.query('UPDATE "Reservation" SET status=$1 WHERE id=$2', ["Expired", row.reservationId]);
    await client.query("COMMIT");
    return { released: true };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function statusOf(slotId, reservationId) {
  const s = (await pool.query('SELECT status FROM "AppointmentSlot" WHERE id=$1', [slotId])).rows[0].status;
  const r = (await pool.query('SELECT status FROM "Reservation" WHERE id=$1', [reservationId])).rows[0].status;
  return { slot: s, reservation: r };
}

async function main() {
  const past = new Date(Date.now() - 60_000);
  const future = new Date(Date.now() + 60 * 60_000);
  let allGreen = true;
  const check = (name, cond, detail) => {
    allGreen &&= cond;
    console.log(`${cond ? "PASS" : "FAIL"} | ${name} ${detail ?? ""}`);
  };

  // Case 1: expired + Active -> released.
  await reset();
  let ids = await seedReservation({ slotStatus: "Reserved", reservationStatus: "Active", reservedUntil: past });
  let res = await release(ids.reservationId);
  let st = await statusOf(ids.slotId, ids.reservationId);
  check("expired reservation is released", res.released && st.slot === "Available" && st.reservation === "Expired", `-> slot=${st.slot} reservation=${st.reservation}`);

  // Case 2: not yet due -> no-op.
  await reset();
  ids = await seedReservation({ slotStatus: "Reserved", reservationStatus: "Active", reservedUntil: future });
  res = await release(ids.reservationId);
  st = await statusOf(ids.slotId, ids.reservationId);
  check("not-yet-due reservation is left alone", !res.released && st.slot === "Reserved" && st.reservation === "Active", `-> slot=${st.slot} reservation=${st.reservation}`);

  // Case 3: already Paid -> no-op (never frees a paid slot).
  await reset();
  ids = await seedReservation({ slotStatus: "Paid", reservationStatus: "Paid", reservedUntil: past });
  res = await release(ids.reservationId);
  st = await statusOf(ids.slotId, ids.reservationId);
  check("paid reservation is never released", !res.released && st.slot === "Paid" && st.reservation === "Paid", `-> slot=${st.slot} reservation=${st.reservation}`);

  await reset();
  await pool.end();
  console.log(`\n${allGreen ? "✅ ALL EXPIRY CASES PASSED" : "❌ SOME CASES FAILED"}`);
  process.exit(allGreen ? 0 : 1);
}

main().catch((e) => { console.error("harness error:", e); process.exit(2); });
