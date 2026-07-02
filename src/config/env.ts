import { z } from "zod";
import "dotenv/config";

// Parse and validate env with zod so a missing key fails loudly at boot,
// not mid-payment.
const schema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.string().default("development"),
  LOG_LEVEL: z.string().default("info"),
  RESERVATION_TTL_MINUTES: z.coerce.number().default(10),
  SLOT_MATERIALIZATION_WEEKS: z.coerce.number().default(8),
  PAYMENT_PROVIDER: z.enum(["mercadopago", "abacatepay"]).default("mercadopago"),
  // Payment + admin secrets are only required once the app actually talks to a
  // provider / exposes admin routes (M1.2+). Kept optional so M1.1 boots and
  // tests run without real sandbox keys; validated at point of use instead.
  PAYMENT_API_KEY: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  PAYMENT_API_BASE_URL: z.string().url().optional(),
  // Consultation price used when creating a charge (cents). Per-doctor pricing
  // is a later enhancement; M1 uses one configurable clinic price.
  DEFAULT_PRICE_CENTS: z.coerce.number().int().positive().default(15000),
  ADMIN_API_KEY: z.string().optional(),
});

export const env = schema.parse(process.env);

export type Env = z.infer<typeof schema>;
