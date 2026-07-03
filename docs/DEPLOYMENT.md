# Deployment Runbook (Railway / Render)

The system runs as **two processes from one repo/image**, sharing one managed
PostgreSQL:

| Service | Command | Role |
|---------|---------|------|
| **web** | `npx prisma migrate deploy && node dist/server.js` | HTTP API + webhook receiver |
| **worker** | `node dist/worker.js` | Expiry scheduling, sweep, nightly materialization |

pg-boss stores its queue in the same Postgres, so no Redis is needed for M1.

---

## Railway (primary)

1. **Provision Postgres** — New → Database → PostgreSQL. Copy its
   `DATABASE_URL` (the `.internal` URL for service-to-service).
2. **Web service** — New → GitHub repo → this repo. Railway reads
   [`railway.json`](../railway.json) (Dockerfile build, start command with
   migrate-on-release, `/healthz` healthcheck).
3. **Worker service** — New → same repo → set **start command** to
   `node dist/worker.js` (and skip the healthcheck).
4. **Environment variables** (both services) — from [`.env.example`](../.env.example):
   - `DATABASE_URL` (reference the Postgres service)
   - `PAYMENT_PROVIDER=abacatepay`, `PAYMENT_API_KEY`, `PAYMENT_WEBHOOK_SECRET`, `PAYMENT_API_BASE_URL`
   - `ADMIN_API_KEY` (a strong secret)
   - `RESERVATION_TTL_MINUTES`, `SLOT_MATERIALIZATION_WEEKS`, `DEFAULT_PRICE_CENTS`
   - `TRUST_PROXY=true`, `FORCE_HTTPS=true`, `NODE_ENV=production`
5. **btree_gist** — created automatically by the `hard_constraints` migration
   during `prisma migrate deploy`; no manual step.
6. **Register the webhook** — in the AbacatePay dashboard, point the payment
   webhook at `https://<web-domain>/webhooks/payment`.
7. **Smoke test** — run one sandbox Pix and one card payment against the live
   URL end-to-end; confirm a reservation expires in prod (worker is running).

## Render (alternative)

- **Web Service** — Docker; start `npx prisma migrate deploy && node dist/server.js`; health check `/healthz`.
- **Background Worker** — same image; start `node dist/worker.js`.
- **PostgreSQL** — managed instance; wire `DATABASE_URL` into both.
- Same env vars as above.

---

## Release checklist

- [ ] `DATABASE_URL` points at the managed Postgres (private URL).
- [ ] All env vars set on **both** services; secrets are real sandbox keys.
- [ ] Web deploy shows migrations applied (`migrate deploy` in the logs).
- [ ] Worker deploy is running (a test reservation expires after its TTL).
- [ ] Webhook URL registered and reachable; a test event returns 200.
- [ ] `TRUST_PROXY=true` and `FORCE_HTTPS=true` in production.
- [ ] One live Pix and one live card payment completed end-to-end.

## Rollback

Redeploy the previous image/commit. Migrations are additive in M1; no
destructive down-migrations are used.
