import type { PaymentProvider } from "./provider.js";
import { AbacatePayProvider } from "./abacatepay.js";
import { env } from "../config/env.js";

let cached: PaymentProvider | null = null;

/** Resolve the configured payment provider (singleton). */
export function getProvider(): PaymentProvider {
  if (cached) return cached;
  switch (env.PAYMENT_PROVIDER) {
    case "abacatepay":
      cached = new AbacatePayProvider();
      break;
    case "mercadopago":
      throw new Error(
        "Mercado Pago adapter not implemented in M1.3 (AbacatePay was selected). Add src/payments/mercadopago.ts to enable."
      );
    default:
      throw new Error(`Unknown PAYMENT_PROVIDER: ${env.PAYMENT_PROVIDER}`);
  }
  return cached;
}

/** Test hook: override the resolved provider (e.g. with the mock). */
export function __setProviderForTests(p: PaymentProvider | null) {
  cached = p;
}
