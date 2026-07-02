// Database-level webhook proof, driver-agnostic (pure-JS `pg`).
//
// Faithfully ports handleWebhook() + releaseReservation() and demonstrates:
//   #2  idempotency        — same event x5 (sequential AND concurrent) confirms
//                            once, charges once
//       out-of-order       — pending-then-approved and approved-then-pending
//                            reach the same final state (keyed off status)
//   #4  payment-at-expiry  — webhook vs expiry fired together always resolves to
//                            (Paid & Approved) OR (freed & Refunded); never
//                            paid-but-unbooked, over many rounds
//
// Usage: node scripts/verify-webhook.mjs [raceRounds]

import "dotenv/config";
import pg from "pg";
import { randomUUID, createHmac } from "node:crypto";

const RACE_ROUNDS = Number(process.argv[2] ?? 50);
const SECRET = "test-webhook-secret";
const PROVIDER = "mock";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL.split("?")[0], max: 20 });

const sign = (body) => createHmac("sha256", SECRET).update(body).digest("hex");
const verify = (body, sig) => {
  try {
    const a = Buffer.from(sign(body), "hex");
    const b = Buffer.from(sig ?? "", "hex");
    return a.length === b.length && a.length > 0 && a.equals(b);
  } catch {
    return false;
  }
};

async function reset() {
  for (const t of ["WebhookEvent", "EventLog", "Payment", "Reservation", "AppointmentSlot", "AvailabilityTemplate", "Doctor"])
    await pool.query(`DELETE FROM "${t}"`);
}

// Seed doctor + Reserved slot + Active reservation + Pending payment.
async function seedChain(reservedUntil = new Date(Date.now() + 60 * 60_000)) {
  const doctorId = randomUUID(), slotId = randomUUID(), reservationId = randomUUID(), paymentId = randomUUID();
  const providerRef = `mock_${reservationId}`;
  await pool.query('INSERT INTO "Doctor"(id,name) VALUES($1,$2)', [doctorId, "Doc"]);
  await pool.query('INSERT INTO "AppointmentSlot"(id,"doctorId","startsAt","endsAt",status) VALUES($1,$2,$3,$4,$5)',
    [slotId, doctorId, new Date("2026-08-01T09:00:00Z"), new Date("2026-08-01T09:30:00Z"), "Reserved"]);
  await pool.query(`INSERT INTO "Reservation"(id,"slotId","patientName","patientEmail","patientPhone",status,"reservedUntil")
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [reservationId, slotId, "P", "p@e.c", "+550000000000", "Active", reservedUntil]);
  await pool.query(`INSERT INTO "Payment"(id,"reservationId",provider,"providerRef","idempotencyKey","amountCents",method,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [paymentId, reservationId, PROVIDER, providerRef, `reservation:${reservationId}:pix`, 15000, "pix", "Pending"]);
  return { slotId, reservationId, paymentId, providerRef };
}

const evt = (providerRef, status, providerEventId = randomUUID()) => {
  const body = Buffer.from(JSON.stringify({ id: providerEventId, providerRef, status }));
  return { body, sig: sign(body) };
};

// Faithful port of handleWebhook().
async function handleWebhook({ body, sig }) {
  if (!verify(body, sig)) return { httpStatus: 401 };
  const event = JSON.parse(body.toString());
  if (!event.id) return { httpStatus: 400 };

  try {
    await pool.query('INSERT INTO "WebhookEvent"(id,provider,"providerEventId") VALUES($1,$2,$3)', [randomUUID(), PROVIDER, event.id]);
  } catch (e) {
    if (e.code === "23505") return { httpStatus: 200, dup: true }; // unique_violation
    throw e;
  }

  const client = await pool.connect();
  let refundRef = null;
  try {
    await client.query("BEGIN");
    const pay = (await client.query('SELECT id,"reservationId","providerRef" FROM "Payment" WHERE provider=$1 AND "providerRef"=$2', [PROVIDER, event.providerRef])).rows[0];
    if (pay) {
      const row = (await client.query(
        `SELECT r.status AS rs, s.id AS sid, s.status AS ss FROM "Reservation" r
         JOIN "AppointmentSlot" s ON s.id=r."slotId" WHERE r.id=$1 FOR UPDATE OF r,s`, [pay.reservationId])).rows[0];
      if (event.status === "approved") {
        if (row && row.ss === "Reserved" && row.rs === "Active") {
          await client.query('UPDATE "AppointmentSlot" SET status=$1,version=version+1 WHERE id=$2', ["Paid", row.sid]);
          await client.query('UPDATE "Reservation" SET status=$1 WHERE id=$2', ["Paid", pay.reservationId]);
          await client.query('UPDATE "Payment" SET status=$1 WHERE id=$2', ["Approved", pay.id]);
        } else {
          await client.query('UPDATE "Payment" SET status=$1 WHERE id=$2', ["Refunded", pay.id]);
          refundRef = pay.providerRef;
        }
      } else if (event.status === "rejected") {
        await client.query('UPDATE "Payment" SET status=$1 WHERE id=$2', ["Rejected", pay.id]);
      }
    }
    await client.query('UPDATE "WebhookEvent" SET "processedAt"=now() WHERE provider=$1 AND "providerEventId"=$2', [PROVIDER, event.id]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return { httpStatus: 200, refunded: !!refundRef };
}

// Faithful port of releaseReservation().
async function release(reservationId, now = new Date()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = (await client.query(
      `SELECT r.status AS rs, r."reservedUntil" AS ru, s.id AS sid, s.status AS ss FROM "Reservation" r
       JOIN "AppointmentSlot" s ON s.id=r."slotId" WHERE r.id=$1 FOR UPDATE OF r,s`, [reservationId])).rows[0];
    if (row && row.rs === "Active" && now >= new Date(row.ru) && row.ss === "Reserved") {
      await client.query('UPDATE "AppointmentSlot" SET status=$1,version=version+1 WHERE id=$2', ["Available", row.sid]);
      await client.query('UPDATE "Reservation" SET status=$1 WHERE id=$2', ["Expired", reservationId]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function states(ids) {
  const s = (await pool.query('SELECT status FROM "AppointmentSlot" WHERE id=$1', [ids.slotId])).rows[0].status;
  const r = (await pool.query('SELECT status FROM "Reservation" WHERE id=$1', [ids.reservationId])).rows[0].status;
  const p = (await pool.query('SELECT status FROM "Payment" WHERE id=$1', [ids.paymentId])).rows[0].status;
  const wc = Number((await pool.query('SELECT count(*)::int c FROM "WebhookEvent"')).rows[0].c);
  const approved = Number((await pool.query(`SELECT count(*)::int c FROM "Payment" WHERE status='Approved'`)).rows[0].c);
  return { slot: s, reservation: r, payment: p, webhookRows: wc, approvedPayments: approved };
}

async function main() {
  let allGreen = true;
  const check = (name, cond, detail) => { allGreen &&= cond; console.log(`${cond ? "PASS" : "FAIL"} | ${name} ${detail ?? ""}`); };

  // --- Idempotency: same event delivered 5x sequentially ---
  await reset();
  let ids = await seedChain();
  const e1 = evt(ids.providerRef, "approved");
  for (let i = 0; i < 5; i++) await handleWebhook(e1);
  let st = await states(ids);
  check("idempotent (5x sequential): confirmed once, charged once",
    st.slot === "Paid" && st.reservation === "Paid" && st.approvedPayments === 1 && st.webhookRows === 1,
    `-> slot=${st.slot} approved=${st.approvedPayments} webhookRows=${st.webhookRows}`);

  // --- Idempotency: same event delivered 5x concurrently ---
  await reset();
  ids = await seedChain();
  const e2 = evt(ids.providerRef, "approved");
  await Promise.allSettled(Array.from({ length: 5 }, () => handleWebhook(e2)));
  st = await states(ids);
  check("idempotent (5x concurrent): confirmed once, charged once",
    st.slot === "Paid" && st.approvedPayments === 1 && st.webhookRows === 1,
    `-> slot=${st.slot} approved=${st.approvedPayments} webhookRows=${st.webhookRows}`);

  // --- Out-of-order: pending then approved ---
  await reset();
  ids = await seedChain();
  await handleWebhook(evt(ids.providerRef, "pending"));
  await handleWebhook(evt(ids.providerRef, "approved"));
  st = await states(ids);
  check("out-of-order (pending->approved) ends Paid", st.slot === "Paid" && st.payment === "Approved", `-> slot=${st.slot} payment=${st.payment}`);

  // --- Out-of-order: approved then a later pending event is inert ---
  await reset();
  ids = await seedChain();
  await handleWebhook(evt(ids.providerRef, "approved"));
  await handleWebhook(evt(ids.providerRef, "pending"));
  st = await states(ids);
  check("out-of-order (approved->pending) stays Paid", st.slot === "Paid" && st.payment === "Approved", `-> slot=${st.slot} payment=${st.payment}`);

  // --- Tampered signature rejected ---
  await reset();
  ids = await seedChain();
  const bad = evt(ids.providerRef, "approved");
  const res401 = await handleWebhook({ body: bad.body, sig: "deadbeef" });
  st = await states(ids);
  check("tampered signature rejected (401), no state change", res401.httpStatus === 401 && st.slot === "Reserved" && st.webhookRows === 0, `-> http=${res401.httpStatus} slot=${st.slot}`);

  // --- Payment-at-expiry race, many rounds ---
  let raceGreen = true, paidWins = 0, refundWins = 0;
  for (let i = 0; i < RACE_ROUNDS; i++) {
    await reset();
    ids = await seedChain(new Date(Date.now() - 1000)); // already past TTL → both are eligible
    const approved = evt(ids.providerRef, "approved");
    await Promise.allSettled([handleWebhook(approved), release(ids.reservationId)]);
    st = await states(ids);
    const paidOutcome = st.slot === "Paid" && st.reservation === "Paid" && st.payment === "Approved";
    const refundOutcome = (st.slot === "Available" || st.slot === "Expired") && st.reservation === "Expired" && st.payment === "Refunded";
    const consistent = paidOutcome || refundOutcome;
    // The forbidden states, checked explicitly:
    const paidButUnbooked = st.payment === "Approved" && st.slot !== "Paid";
    const paidSlotNotConfirmed = st.slot === "Paid" && st.reservation !== "Paid";
    if (!consistent || paidButUnbooked || paidSlotNotConfirmed) {
      raceGreen = false;
      console.log(`  race round ${i} INCONSISTENT -> slot=${st.slot} reservation=${st.reservation} payment=${st.payment}`);
    }
    if (paidOutcome) paidWins++; else if (refundOutcome) refundWins++;
  }
  check(`payment-at-expiry race consistent across ${RACE_ROUNDS} rounds`, raceGreen, `(paid-wins=${paidWins}, refund-wins=${refundWins})`);

  await reset();
  await pool.end();
  console.log(`\n${allGreen ? "✅ ALL WEBHOOK PROOFS PASSED" : "❌ SOME PROOFS FAILED"}`);
  process.exit(allGreen ? 0 : 1);
}

main().catch((e) => { console.error("harness error:", e); process.exit(2); });
