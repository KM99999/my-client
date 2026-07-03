# Milestone 1.3 — Execution Plan & Intake Checklist

M1.3 is **payments (AbacatePay Pix + card), live sandbox validation, deployment,
and acceptance**. The provider-agnostic core is already built and CI-proven; what
remains is gated on two inputs from the customer.

## What's already done (no dependencies)

- Provider-agnostic `PaymentProvider` interface + in-memory mock.
- **AbacatePay adapter pre-wired** to the documented v1 API (`/v1/pixQrCode/create`
  for Pix, `/v1/billing/create` for card) with Bearer auth and centavos amounts.
- Signature-verified, idempotent **webhook handler** with the full exception
  matrix — accepts both `X-Webhook-Signature` (HMAC-SHA256) and a `webhookSecret`
  query param.
- `startPayment` with a stable idempotency key.
- Proven in CI: idempotency (5× seq + concurrent), out-of-order, tampered-sig
  rejection, and the payment-at-expiry race (50 rounds, never paid-but-unbooked).
- Deployment ready: Dockerfile, `railway.json`, [DEPLOYMENT.md](./DEPLOYMENT.md).

## Intake checklist — what we need from the customer

**1. AbacatePay sandbox credentials**
- [ ] `PAYMENT_API_KEY` — sandbox API key
- [ ] `PAYMENT_WEBHOOK_SECRET` — the secret set when registering the webhook
- [ ] Confirm base URL (default `https://api.abacatepay.com`) and whether the
      account is on the **v1** (`pixQrCode`/`billing`) or **v2**
      (`transparents`/`checkouts`) API — this decides two endpoint paths in the
      adapter and nothing else.

**2. Hosting (Railway assumed)**
- [ ] Access to create the Postgres + web + worker services (or an invite to the
      project), OR confirmation to proceed and hand over config for you to click.

## Execution plan (once the above arrives)

1. **Connectivity smoke** — set the key, run `npm run sandbox:smoke` → confirms a
   real Pix charge is created and returns a `brCode`. (Adjust the two endpoint
   paths if the account is v2.)
2. **Local end-to-end** — book → start Pix payment → complete in sandbox →
   confirm the webhook verifies and flips the reservation to `Paid`; repeat for
   card (approved → Paid; declined → left to expire).
3. **Deploy** — provision Postgres, deploy web + worker (migrate-on-release),
   register the webhook URL `https://<domain>/webhooks/payment`.
4. **Live smoke on staging** — one Pix and one card end-to-end on the deployed
   URL; confirm the worker expires a test reservation in prod.
5. **Evidence** — capture recordings/screenshots of both flows into
   [ACCEPTANCE_EVIDENCE.md](./ACCEPTANCE_EVIDENCE.md).
6. **Hardening finish** — DB least-privilege role, `TRUST_PROXY`/`FORCE_HTTPS`
   on, confirm no secrets in logs.
7. **Acceptance** — walkthrough of all four criteria + written sign-off.

## M1.3 definition of done

- [ ] Pix and card both complete end-to-end in sandbox, with captured evidence.
- [ ] Webhook signatures verified; payment-at-expiry always Paid or Refunded.
- [ ] Web + worker deployed and confirmed running in production.
- [ ] Docs + Postman current; acceptance evidence updated.
- [ ] Written client acceptance received.
