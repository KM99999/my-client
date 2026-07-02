import type {
  CreateChargeInput,
  CreateChargeResult,
  ParsedEvent,
  NormalizedStatus,
  PaymentProvider,
} from "./provider.js";
import { verifyHmac } from "./signature.js";
import { env } from "../config/env.js";

/**
 * AbacatePay adapter.
 *
 * ⚠️ SANDBOX-WIRING TODO: the endpoint paths, request/response field names, and
 * the exact webhook signature scheme below are the integration points to
 * confirm against AbacatePay's sandbox docs once credentials are available.
 * Everything provider-agnostic (idempotency, the exception matrix, the payment
 * + slot state transitions) is already built and tested against the mock, so
 * only THIS file should need to change when keys arrive.
 */
export class AbacatePayProvider implements PaymentProvider {
  readonly name = "abacatepay";

  private get baseUrl(): string {
    return env.PAYMENT_API_BASE_URL ?? "https://api.abacatepay.com";
  }

  private authHeaders(): Record<string, string> {
    if (!env.PAYMENT_API_KEY) {
      throw new Error("PAYMENT_API_KEY is not set — cannot call AbacatePay");
    }
    return {
      Authorization: `Bearer ${env.PAYMENT_API_KEY}`,
      "Content-Type": "application/json",
    };
  }

  async createCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    // TODO(sandbox): confirm endpoint + payload shape.
    const res = await fetch(`${this.baseUrl}/v1/billing/create`, {
      method: "POST",
      headers: { ...this.authHeaders(), "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({
        amount: input.amountCents,
        methods: [input.method],
        externalId: input.reference,
      }),
    });
    if (!res.ok) {
      throw new Error(`AbacatePay createCharge failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      id: string;
      pixQrCode?: string;
      url?: string;
    };
    return {
      providerRef: data.id,
      pixQr: data.pixQrCode,
      checkoutUrl: data.url,
    };
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): boolean {
    // TODO(sandbox): AbacatePay may sign via an HMAC header OR a configured
    // webhook secret passed differently. Confirm and adjust here only.
    return verifyHmac(rawBody, signature, env.PAYMENT_WEBHOOK_SECRET);
  }

  parseEvent(rawBody: Buffer): ParsedEvent {
    // TODO(sandbox): confirm webhook envelope + status vocabulary.
    const body = JSON.parse(rawBody.toString("utf8")) as {
      event?: string;
      id?: string;
      data?: { id?: string; status?: string; externalId?: string };
    };
    const raw = (body.data?.status ?? "").toLowerCase();
    const status: NormalizedStatus =
      raw === "paid" || raw === "approved"
        ? "approved"
        : raw === "refused" || raw === "rejected" || raw === "failed"
          ? "rejected"
          : "pending";
    return {
      providerEventId: String(body.id ?? body.data?.id ?? ""),
      providerRef: String(body.data?.id ?? ""),
      status,
    };
  }

  async refund(providerRef: string): Promise<void> {
    // TODO(sandbox): confirm refund/void endpoint.
    const res = await fetch(`${this.baseUrl}/v1/billing/${providerRef}/refund`, {
      method: "POST",
      headers: this.authHeaders(),
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`AbacatePay refund failed: ${res.status}`);
    }
  }
}
