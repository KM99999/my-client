import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Never let secrets reach the logs (acceptance: "no secrets in logs").
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers['x-admin-api-key']",
      "*.apiKey",
      "*.api_key",
      "*.secret",
      "*.password",
      "*.card",
    ],
    censor: "[redacted]",
  },
});
