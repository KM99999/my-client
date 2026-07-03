# Milestone 1 — Acceptance Evidence

A living record of the proof behind each acceptance criterion. Everything here is
reproducible from the repo; CI re-proves it on every push.

## Automated CI (Linux + PostgreSQL)

- **CI workflow:** [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
  — install → prisma generate → **migrate deploy** → typecheck → unit tests →
  **integration suite (reserve-race, expiry, webhook)** → concurrency/expiry/webhook proofs.
  - green run: https://github.com/KM99999/my-client/actions/runs/28630825510
- **Load workflow:** [`.github/workflows/load.yml`](../.github/workflows/load.yml)
  — boots the real Express + Prisma server on Linux, runs k6 (50 VUs) at one
  contended slot, then asserts **exactly one reservation won**.
  - green run: https://github.com/KM99999/my-client/actions/runs/28630825547

The integration suite runs the guarantees through the **real application code**
(Prisma `reserveSlot`, `releaseReservation`, the webhook handler) on Linux — not
just the standalone scripts.

## Criterion → evidence

| # | Client criterion | Evidence |
|---|------------------|----------|
| 1 | No double booking under load | `verify:locking` — 50 concurrent × 20 rounds, exactly one winner each round; integration `reserve-race`; k6 HTTP load test ([`load.yml`](../.github/workflows/load.yml)) asserting exactly one reservation. |
| 2 | Duplicate/retried webhooks confirm once, charge once | `verify:webhook` — same event ×5 (sequential + concurrent) → one confirmation, one charge; out-of-order convergence; integration `webhook`. |
| 3 | Expired reservations auto-release | `verify:expiry` + integration `expiry` — expired→freed, not-due→held, paid→never freed; precise job **and** sweep paths. |
| 4 | Payment-at-expiry always consistent | `verify:webhook` race — 50 rounds always resolve to Paid+Approved **or** freed+Refunded, never paid-but-unbooked. |
| — | Reproducible setup | `prisma migrate deploy` from a clean DB (CI does this every run); [`docs/RUN_ONLINE.md`](./RUN_ONLINE.md) + [`docs/README.md`](./README.md). |

## Reproduce locally

```bash
npm test                 # unit
npm run test:integration # Prisma integration (needs a DB)
npm run verify:locking   # concurrency proof
npm run verify:expiry    # expiry proof
npm run verify:webhook   # idempotency + payment-at-expiry proof
```

## Pending (external dependencies)

- Live Pix + card sandbox runs (needs AbacatePay keys) — recordings to be added here.
- Staging deployment URL (needs Railway access) — to be added here.
