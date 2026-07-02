// Local visual preview of the booking widget — runs on this machine WITHOUT
// Prisma (pure-JS `pg`), so the flow is viewable even where the Prisma engine
// won't run. It serves public/index.html and implements the same booking API
// contract the real Express app exposes. For production, the real app
// (src/http) is authoritative; this is a dev/demo convenience.
//
// Usage: node scripts/preview-server.mjs   (then open http://localhost:3000)

import "dotenv/config";
import express from "express";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const PORT = Number(process.env.PREVIEW_PORT ?? 3000);
const TTL_MIN = Number(process.env.RESERVATION_TTL_MINUTES ?? 10);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL.split("?")[0] });
const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
const DEMO_DOCTOR = "00000000-0000-0000-0000-0000000000aa";

// Weekly template: Mon–Fri full day, Sat morning, limited Sunday hours.
const TEMPLATES = {
  1: ["09:00", "17:00"], 2: ["09:00", "17:00"], 3: ["09:00", "17:00"],
  4: ["09:00", "17:00"], 5: ["09:00", "17:00"], 6: ["09:00", "12:00"],
  0: ["10:00", "12:00"],
};

async function ensureSeed() {
  const exists = (await pool.query('SELECT 1 FROM "Doctor" WHERE id=$1', [DEMO_DOCTOR])).rowCount;
  if (!exists) {
    await pool.query('INSERT INTO "Doctor"(id,name,specialty) VALUES($1,$2,$3)',
      [DEMO_DOCTOR, "Dra. Ana Souza", "Clínica Geral"]);
  }
  // Materialize the next 14 days of 30-min slots (future only, idempotent).
  const now = new Date();
  for (let d = 0; d < 14; d++) {
    const day = new Date(now); day.setDate(now.getDate() + d);
    const tpl = TEMPLATES[day.getDay()]; if (!tpl) continue;
    const [sh, sm] = tpl[0].split(":").map(Number);
    const [eh, em] = tpl[1].split(":").map(Number);
    const start = new Date(day); start.setHours(sh, sm, 0, 0);
    const end = new Date(day); end.setHours(eh, em, 0, 0);
    for (let cur = new Date(start); cur < end; cur = new Date(cur.getTime() + 30 * 60000)) {
      const next = new Date(cur.getTime() + 30 * 60000);
      if (next > end || cur < now) continue;
      await pool.query(
        `INSERT INTO "AppointmentSlot"(id,"doctorId","startsAt","endsAt",status)
         VALUES($1,$2,$3,$4,'Available')
         ON CONFLICT ("doctorId","startsAt") DO NOTHING`,
        [randomUUID(), DEMO_DOCTOR, cur, next]
      );
    }
  }
}

const app = express();
app.use(express.json());

app.get("/api/doctors", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,name,specialty FROM "Doctor" WHERE active=true ORDER BY name');
    res.json({ doctors: rows });
  } catch (e) { next(e); }
});

app.get("/api/slots", async (req, res, next) => {
  try {
    const { doctorId, date } = req.query;
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600000);
    const { rows } = await pool.query(
      `SELECT id,"startsAt","endsAt",status FROM "AppointmentSlot"
       WHERE "doctorId"=$1 AND status='Available' AND "startsAt">=$2 AND "startsAt"<$3
       ORDER BY "startsAt"`, [doctorId, dayStart, dayEnd]);
    res.json({ slots: rows });
  } catch (e) { next(e); }
});

app.post("/api/reservations", async (req, res, next) => {
  const { slotId, patientName, patientEmail, patientPhone } = req.body || {};
  if (!slotId || !patientName || !patientEmail || !patientPhone) {
    return res.status(400).json({ error: "validation_error" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const slot = (await client.query(
      'SELECT id,status FROM "AppointmentSlot" WHERE id=$1 FOR UPDATE', [slotId])).rows[0];
    if (!slot || slot.status !== "Available") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "slot_unavailable", message: "Slot is no longer available" });
    }
    const reservedUntil = new Date(Date.now() + TTL_MIN * 60000);
    const id = randomUUID();
    await client.query('UPDATE "AppointmentSlot" SET status=$1,version=version+1 WHERE id=$2', ["Reserved", slotId]);
    await client.query(
      `INSERT INTO "Reservation"(id,"slotId","patientName","patientEmail","patientPhone",status,"reservedUntil")
       VALUES($1,$2,$3,$4,$5,'Active',$6)`,
      [id, slotId, patientName, patientEmail, patientPhone, reservedUntil]);
    await client.query("COMMIT");
    res.status(201).json({ id, slotId, status: "Active", reservedUntil });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    next(e);
  } finally { client.release(); }
});

app.get("/api/reservations/:id", async (req, res, next) => {
  try {
    const r = (await pool.query(
      `SELECT r.id,r.status,r."reservedUntil",s.id AS "slotId",s.status AS "slotStatus",
              s."startsAt",s."endsAt"
       FROM "Reservation" r JOIN "AppointmentSlot" s ON s.id=r."slotId" WHERE r.id=$1`,
      [req.params.id])).rows[0];
    if (!r) return res.status(404).json({ error: "reservation_not_found" });
    res.json({ reservation: {
      id: r.id, status: r.status, reservedUntil: r.reservedUntil,
      slot: { id: r.slotId, status: r.slotStatus, startsAt: r.startsAt, endsAt: r.endsAt },
    } });
  } catch (e) { next(e); }
});

// Payment start is Milestone 1.3 — mirror the real app's stub.
app.post("/api/reservations/:id/payment", (_req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Payment (Pix + card) arrives in Milestone 1.3." });
});

app.use(express.static(publicDir));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "internal_error" });
});

ensureSeed()
  .then(() => app.listen(PORT, () => {
    console.log(`\n▶ Booking widget preview:  http://localhost:${PORT}`);
    console.log(`  (pg-backed demo server — reservations held for ${TTL_MIN} min)\n`);
  }))
  .catch((e) => { console.error("preview seed failed:", e); process.exit(1); });
