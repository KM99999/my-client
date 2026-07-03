// AbacatePay sandbox connectivity check — run the moment credentials arrive.
// Creates a real Pix QR charge and prints the copy-paste code. No DB needed.
//
//   PAYMENT_API_KEY=<sandbox key> node scripts/sandbox-smoke.mjs
// (or set PAYMENT_API_KEY in .env)

import "dotenv/config";

const KEY = process.env.PAYMENT_API_KEY;
const BASE = (process.env.PAYMENT_API_BASE_URL ?? "https://api.abacatepay.com").replace(/\/+$/, "");

if (!KEY || KEY === "__set_me__" || KEY === "dummy") {
  console.error("Set PAYMENT_API_KEY to your AbacatePay sandbox key first.");
  process.exit(1);
}

const res = await fetch(`${BASE}/v1/pixQrCode/create`, {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    amount: 15000, // R$150.00 in centavos
    expiresIn: 600,
    description: "Smoke test — booking-core",
  }),
});

const json = await res.json().catch(() => ({}));
console.log("HTTP", res.status);
if (!res.ok || json.error) {
  console.error("FAILED:", JSON.stringify(json.error ?? json, null, 2));
  process.exit(1);
}

const d = json.data ?? json;
console.log("OK — Pix charge created");
console.log("  id:    ", d.id);
console.log("  status:", d.status);
console.log("  brCode:", d.brCode ? d.brCode.slice(0, 48) + "…" : "(none)");
console.log("  QR PNG:", d.brCodeBase64 ? "present" : "(none)");
console.log("\nNext: complete this charge in the sandbox, confirm the webhook lands at /webhooks/payment.");
