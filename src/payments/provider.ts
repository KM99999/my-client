export type PaymentMethod = "pix" | "card";

export type NormalizedStatus = "approved" | "rejected" | "pending";

export interface CreateChargeInput {
  amountCents: number;
  method: PaymentMethod;
  idempotencyKey: string;
  reference: string; // reservation id
}

export interface CreateChargeResult {
  providerRef: string;
  pixQr?: string;
  checkoutUrl?: string;
}

export interface ParsedEvent {
  providerEventId: string;
  providerRef: string;
  status: NormalizedStatus;
}

/**
 * The only surface the rest of the app knows about. Concrete adapters
 * (AbacatePay, Mercado Pago, a test mock) implement it; all provider-specific
 * HTTP and crypto stays behind this boundary so the provider is swappable.
 */
export interface PaymentProvider {
  readonly name: string;

  createCharge(input: CreateChargeInput): Promise<CreateChargeResult>;

  /** Verify a webhook against the raw request body. Never throws — returns bool. */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): boolean;

  /** Parse a verified webhook body into the normalized event shape. */
  parseEvent(rawBody: Buffer): ParsedEvent;

  /**
   * Void/refund a charge that was approved but can no longer be honored
   * (slot released/re-sold before the webhook landed). Idempotent.
   */
  refund(providerRef: string): Promise<void>;
}
