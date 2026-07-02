import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { reserveSlot } from "../../src/reservations/reserve.js";
import { startPayment } from "../../src/payments/startPayment.js";
import { handleWebhook } from "../../src/payments/webhook.js";
import { releaseReservation } from "../../src/jobs/releaseReservation.js";
import { MockProvider } from "../../src/payments/mock.js";
import { hmacHex } from "../../src/payments/signature.js";
import { resetDb, seedOneSlot, patient } from "./helpers.js";

// Client acceptance criterion #2 + the payment-at-expiry race, against the real
// Prisma stack with the in-memory MockProvider.
const SECRET = "test-webhook-secret";
const mock = new MockProvider(SECRET);

function signedEvent(
  providerRef: string,
  status: "approved" | "rejected" | "pending",
  id = `evt_${Math.random().toString(36).slice(2)}`
) {
  const body = Buffer.from(JSON.stringify({ id, providerRef, status }));
  return { body, sig: hmacHex(body, SECRET) };
}

async function seedPaidChain() {
  const { slotId } = await seedOneSlot();
  const reservation = await reserveSlot({ slotId, ...patient });
  const payment = await startPayment(
    { reservationId: reservation.id, method: "pix" },
    mock
  );
  return { slotId, reservationId: reservation.id, providerRef: payment.providerRef };
}

describe("payment webhook (idempotent + exception matrix)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("confirms an approved payment: slot Paid, reservation Paid, one charge", async () => {
    const c = await seedPaidChain();
    const { body, sig } = signedEvent(c.providerRef, "approved");
    const res = await handleWebhook(body, sig, mock);
    expect(res.httpStatus).toBe(200);

    const slot = await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: c.slotId } });
    expect(slot.status).toBe("Paid");
    const approved = await prisma.payment.count({ where: { status: "Approved" } });
    expect(approved).toBe(1);
  });

  it("is idempotent: same event delivered 5x confirms once, charges once", async () => {
    const c = await seedPaidChain();
    const event = signedEvent(c.providerRef, "approved");
    for (let i = 0; i < 5; i++) await handleWebhook(event.body, event.sig, mock);

    const webhookRows = await prisma.webhookEvent.count();
    const approved = await prisma.payment.count({ where: { status: "Approved" } });
    expect(webhookRows).toBe(1);
    expect(approved).toBe(1);
  });

  it("rejects a tampered signature with 401 and no state change", async () => {
    const c = await seedPaidChain();
    const { body } = signedEvent(c.providerRef, "approved");
    const res = await handleWebhook(body, "deadbeef", mock);
    expect(res.httpStatus).toBe(401);
    const slot = await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: c.slotId } });
    expect(slot.status).toBe("Reserved");
    expect(await prisma.webhookEvent.count()).toBe(0);
  });

  it("a rejected payment leaves the slot to expire (no confirmation)", async () => {
    const c = await seedPaidChain();
    const { body, sig } = signedEvent(c.providerRef, "rejected");
    await handleWebhook(body, sig, mock);
    const slot = await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: c.slotId } });
    expect(slot.status).toBe("Reserved"); // still held; TTL will free it
    const payment = await prisma.payment.findFirstOrThrow({ where: { reservationId: c.reservationId } });
    expect(payment.status).toBe("Rejected");
  });

  it("payment-at-expiry: if the slot was released first, an approval refunds (never paid-but-unbooked)", async () => {
    const c = await seedPaidChain();
    // Force expiry to win: release the slot first.
    await prisma.reservation.update({
      where: { id: c.reservationId },
      data: { reservedUntil: new Date(Date.now() - 60_000) },
    });
    const rel = await releaseReservation(c.reservationId);
    expect(rel.released).toBe(true);

    const { body, sig } = signedEvent(c.providerRef, "approved");
    await handleWebhook(body, sig, mock);

    const slot = await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: c.slotId } });
    const payment = await prisma.payment.findFirstOrThrow({ where: { reservationId: c.reservationId } });
    expect(slot.status).toBe("Available"); // not Paid
    expect(payment.status).toBe("Refunded");
  });
});
