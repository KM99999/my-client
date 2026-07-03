import type {
  CreateChargeInput,
  CreateChargeResult,
  ParsedEvent,
  NormalizedStatus,
  PaymentProvider,
} from "./provider.js";
import { verifyHmac, safeEqualStr } from "./signature.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

/**
 * AbacatePay adapter — pre-wired against the public docs (https://docs.abacatepay.com):
 *   - Base URL: https://api.abacatepay.com  (override via PAYMENT_API_BASE_URL)
 *   - Auth: `Authorization: Bearer <PAYMENT_API_KEY>`
 *   - Amounts in centavos (BRL). Responses wrap payloads in `{ data, error }`.
 *   - Pix:  POST /v1/pixQrCode/create  -> data.{ id, brCode, brCodeBase64, status }
 *   - Card: POST /v1/billing/create    -> data.{ id, url, status }
 *   - Webhook: HMAC-SHA256 over the raw body in `X-Webhook-Signature`, keyed with
 *     the secret set at webhook registration. Some flows instead append
 *     `?webhookSecret=<secret>`; both are accepted below.
 *
 * ⚠️ Confirm against the sandbox once credentials arrive: the exact billing
 * request shape (v1 `billing/create` inline products vs v2 `checkouts/create`
 * with product ids) and the webhook event vocabulary. These are the only
 * provider-specific details; everything else in the app is provider-agnostic.
 */
export class AbacatePayProvider implements PaymentProvider {
  readonly name = "abacatepay";

  private get baseUrl(): string {
    return (env.PAYMENT_API_BASE_URL ?? "https://api.abacatepay.com").replace(/\/+$/, "");
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

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: T;
      error?: unknown;
    };
    if (!res.ok || json.error) {
      throw new Error(
        `AbacatePay ${path} failed: ${res.status} ${JSON.stringify(json.error ?? "")}`
      );
    }
    return json.data as T;
  }

  async createCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    if (input.method === "pix") {
      // Transparent Pix QR charge.
      const data = await this.post<{
        id: string;
        brCode?: string;
        brCodeBase64?: string;
      }>("/v1/pixQrCode/create", {
        amount: input.amountCents,
        expiresIn: env.RESERVATION_TTL_MINUTES * 60,
        description: `Consulta ${input.reference}`,
        externalId: input.reference,
        metadata: { reservationId: input.reference },
      });
      return { providerRef: data.id, pixQr: data.brCode };
    }

    // Card -> hosted checkout that returns a redirect URL.
    const data = await this.post<{ id: string; url?: string }>(
      "/v1/billing/create",
      {
        frequency: "ONE_TIME",
        methods: ["CARD"],
        products: [
          {
            externalId: input.reference,
            name: "Consulta",
            quantity: 1,
            price: input.amountCents,
          },
        ],
        externalId: input.reference,
        metadata: { reservationId: input.reference },
      }
    );
    return { providerRef: data.id, checkoutUrl: data.url };
  }

  verifyWebhook(rawBody: Buffer, signatureOrSecret: string | undefined): boolean {
    // Accept either an HMAC-SHA256 signature over the raw body (X-Webhook-Signature)
    // or the shared webhookSecret (query param) matching our configured secret.
    return (
      verifyHmac(rawBody, signatureOrSecret, env.PAYMENT_WEBHOOK_SECRET) ||
      safeEqualStr(signatureOrSecret, env.PAYMENT_WEBHOOK_SECRET)
    );
  }

  parseEvent(rawBody: Buffer): ParsedEvent {
    const body = JSON.parse(rawBody.toString("utf8")) as {
      id?: string;
      event?: string;
      data?: {
        id?: string;
        status?: string;
        externalId?: string;
        pixQrCode?: { id?: string; status?: string };
        billing?: { id?: string; status?: string };
      };
    };

    const event = (body.event ?? "").toLowerCase();
    const inner = body.data ?? {};
    const statusRaw = (
      inner.status ??
      inner.pixQrCode?.status ??
      inner.billing?.status ??
      ""
    ).toLowerCase();

    const looksPaid = /paid|completed|approved/.test(event) || /paid|approved/.test(statusRaw);
    const looksRejected = /refund|fail|lost|expired|cancel|dispute/.test(event) || /refund|fail|expired|cancel/.test(statusRaw);
    const status: NormalizedStatus = looksPaid ? "approved" : looksRejected ? "rejected" : "pending";

    // The charge id we stored as providerRef at createCharge time.
    const providerRef = String(
      inner.id ?? inner.pixQrCode?.id ?? inner.billing?.id ?? inner.externalId ?? ""
    );
    // A stable id for idempotency: prefer an explicit event id, else derive one.
    const providerEventId = String(body.id ?? `${providerRef}:${event || statusRaw}`);

    if (!providerRef) logger.warn({ body }, "abacatepay webhook: no providerRef found");
    return { providerEventId, providerRef, status };
  }

  async refund(providerRef: string): Promise<void> {
    // Void/refund a charge. Endpoint to confirm in sandbox.
    const res = await fetch(`${this.baseUrl}/v1/billing/${providerRef}/refund`, {
      method: "POST",
      headers: this.authHeaders(),
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`AbacatePay refund failed: ${res.status}`);
    }
  }
}
