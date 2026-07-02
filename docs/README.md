# Booking Core — Local Setup

Healthcare appointment booking system (Milestone 1: the reliability spine).
Stack: **Node.js · Express · PostgreSQL · Prisma · pg-boss**, deployed on
Railway/Render.

> **Status:** Milestone 1.1 (foundation & data layer) is code-complete. The
> booking API, worker, and payments arrive in M1.2 / M1.3 — see
> [`../MILESTONES.md`](../MILESTONES.md).

## Prerequisites

- Node.js LTS (v20 or v22)
- Docker (for local Postgres) — or any PostgreSQL 15+ instance
- npm

## One-time setup

```bash
# 1. Start Postgres (local Docker)
docker compose up -d

# 2. Configure environment
cp .env.example .env        # then edit values as needed

# 3. Install dependencies
npm install

# 4. Generate the Prisma client + apply migrations
npx prisma generate
npx prisma migrate deploy   # applies init + hard_constraints (needs btree_gist)

# 5. Seed a demo doctor, templates, and materialized slots
npm run seed
```

## Everyday commands

| Command | What it does |
|---------|--------------|
| `npm test` | Run the unit test suite (state machine + slot math) |
| `npm run test:integration` | Prisma-based integration tests (needs a running DB) |
| `npm run verify:locking` | Prove the no-double-booking guarantee (50×20 concurrency rounds) |
| `npm run verify:expiry` | Prove expired reservations release and paid ones never do |
| `npm run seed` | (Re)seed the demo clinic and materialize slots |
| `npx prisma studio` | Browse the database in a GUI |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Run the web server (API) with hot reload |
| `npm run worker` | Run the background worker (expiry + sweep + materialization) |

## What exists today (M1.1)

- **Schema & migrations** — all tables, indexes, and the two hard DB constraints
  (`one_live_slot_hold`, `no_overlap_per_doctor`).
- **State machine** — `src/domain/stateMachine.ts`, the pure safety net for all
  slot transitions.
- **Slot materialization** — `src/slots/` turns availability templates into
  concrete, lockable `AppointmentSlot` rows.
- **Plumbing** — env validation, logging, Prisma client, event logging.

## Verifying the constraints (after `migrate deploy`)

```sql
-- The GiST exclusion constraint should reject an overlapping slot for a doctor:
\d "AppointmentSlot"      -- shows no_overlap_per_doctor
-- The partial unique index guarding live holds:
\di one_live_slot_hold
```

A full `SCHEMA.md`, `API.md`, `WEBHOOKS.md`, `DEPLOYMENT.md`, and the Postman
collection are M1.3 deliverables.
