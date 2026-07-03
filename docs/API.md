# API Reference

Base URL: the deployed web service. All bodies are JSON. Errors return a JSON
`{ "error": "...", "message"?: "..." }` with an appropriate status — never a bare
500 for expected conditions.

## Health

| Method | Path | Notes |
|--------|------|-------|
| GET | `/healthz` | Liveness. `{ "status": "ok" }` |
| GET | `/readyz` | Readiness incl. a DB round-trip. |

## Patient booking

### `GET /api/doctors`
List active doctors. → `{ "doctors": [{ "id", "name", "specialty" }] }`

### `GET /api/slots?doctorId=<uuid>&date=<YYYY-MM-DD>`
Available slots for a doctor on a date (UTC).
→ `{ "slots": [{ "id", "startsAt", "endsAt", "status" }] }`
Errors: `400` if `doctorId`/`date` malformed.

### `POST /api/reservations`
Reserve a slot (row-locked). Rate-limited.
Body: `{ "slotId", "patientName", "patientEmail", "patientPhone" }`
→ `201 { "id", "slotId", "status": "Active", "reservedUntil" }`
Errors: `409 slot_unavailable` if already taken; `400` on invalid body; `429 rate_limited`.

### `POST /api/reservations/:id/payment`
Start a Pix or card payment for an active reservation. Rate-limited.
Body: `{ "method": "pix" | "card" }`
→ `201 { "paymentId", "providerRef", "pixQr"?, "checkoutUrl"?, "status": "Pending" }`
Errors: `409 reservation_not_payable`; `400` on invalid body.

### `GET /api/reservations/:id`
Status polling for the UI.
→ `{ "reservation": { "id", "status", "reservedUntil", "slot": { "id", "status", "startsAt", "endsAt" } } }`
Errors: `404 reservation_not_found`.

## Payment webhook

### `POST /webhooks/payment`
Provider callback. Raw body; HMAC-signature verified. Idempotent.
→ `200 { "status": "processed" }` | `200 { "status": "duplicate_ignored" }` | `401 invalid_signature` | `400`.
See [`WEBHOOKS.md`](./WEBHOOKS.md) for the exception matrix.

## Admin (guarded by `x-admin-api-key`)

| Method | Path | Body / Notes |
|--------|------|--------------|
| POST | `/admin/doctors` | `{ "name", "specialty"? }` |
| GET | `/admin/doctors` | list all |
| PATCH | `/admin/doctors/:id` | `{ "name"?, "specialty"?, "active"? }` |
| POST | `/admin/doctors/:id/availability` | `{ "dayOfWeek" 0-6, "startTime" "HH:MM", "endTime" "HH:MM", "slotMinutes"?, "active"? }` |
| POST | `/admin/materialize` | Generate concrete slots now. → `{ "created": <n> }` |

All admin routes return `401 unauthorized` without a valid `x-admin-api-key`.
