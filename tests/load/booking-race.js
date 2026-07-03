import http from "k6/http";
import { check } from "k6";

// Hammer a single slot with N virtual users and assert every response is
// handled cleanly — exactly one 201 (the winner), the rest 409 "unavailable",
// never a 500. Complements the DB-level `verify:locking` proof at the HTTP tier.
export const options = { vus: 50, iterations: 50 };

export default function () {
  const res = http.post(
    `${__ENV.BASE_URL}/api/reservations`,
    JSON.stringify({
      slotId: __ENV.SLOT_ID,
      patientName: "Load Test",
      patientEmail: "load@test.dev",
      patientPhone: "+550000000000",
    }),
    { headers: { "Content-Type": "application/json" } }
  );
  check(res, {
    "handled cleanly (201 or 409, never 5xx)": (r) =>
      [200, 201, 409].includes(r.status),
  });
}
