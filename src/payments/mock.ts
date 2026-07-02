import type {
  CreateChargeInput,
  CreateChargeResult,
  ParsedEvent,
  PaymentProvider,
} from "./provider.js";
import { verifyHmac } from "./signature.js";

/**
 * In-memory provider for tests and the local verification harness. Uses the
 * same HMAC-SHA256 raw-body signature scheme as the real adapters, so webhook
 * verification and idempotency behave identically to production.
 *
 * Webhook body shape it understands:
 *   { "id": "<providerEventId>", "providerRef": "<ref>", "status": "approved|rejected|pending" }
 */
export class MockProvider implements PaymentProvider {
  readonly name = "mock";
  constructor(private readonly secret: string) {}

  async createCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    const providerRef = `mock_${input.idempotencyKey}`;
    return input.method === "pix"
      ? { providerRef, pixQr: `00020126PIX-${providerRef}` }
      : { providerRef, checkoutUrl: `https://mock.pay/checkout/${providerRef}` };
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): boolean {
    return verifyHmac(rawBody, signature, this.secret);
  }

  parseEvent(rawBody: Buffer): ParsedEvent {
    const body = JSON.parse(rawBody.toString("utf8")) as {
      id: string;
      providerRef: string;
      status: ParsedEvent["status"];
    };
    return {
      providerEventId: body.id,
      providerRef: body.providerRef,
      status: body.status,
    };
  }

  async refund(_providerRef: string): Promise<void> {
    // no-op for the mock
  }
}
