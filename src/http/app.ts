import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { healthRouter } from "./routes/health.js";
import { bookingRouter } from "./routes/booking.js";
import { webhookRouter } from "./routes/webhook.js";
import { adminRouter } from "../admin/routes.js";
import { errorHandler, notFound } from "./middleware/errors.js";

export function createApp() {
  const app = express();

  // Behind Railway/Render's proxy, trust X-Forwarded-* for correct client IPs
  // (rate limiting) and the HTTPS check.
  if (env.TRUST_PROXY) app.set("trust proxy", 1);

  // Secure headers. CSP is disabled because the embeddable reference widget is
  // a single inline HTML/JS file; a strict CSP for it is a later enhancement.
  app.use(helmet({ contentSecurityPolicy: false }));

  // Redirect HTTP -> HTTPS in production (TLS terminates at the proxy).
  if (env.FORCE_HTTPS) {
    app.use((req, res, next) => {
      if (req.secure || req.header("x-forwarded-proto") === "https") return next();
      res.redirect(308, `https://${req.header("host")}${req.originalUrl}`);
    });
  }

  app.use(pinoHttp({ logger }));

  // The payment webhook needs the RAW body for signature verification, so it is
  // mounted (with its own express.raw) BEFORE the global json parser.
  app.use("/webhooks", webhookRouter);

  // express.json() applies to every OTHER route.
  app.use(express.json());

  app.use(healthRouter);
  app.use("/api", bookingRouter);
  app.use("/admin", adminRouter);

  // Serve the reference booking widget at "/". `public/` sits at the project
  // root (two levels up from dist/http or src/http).
  const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../public");
  app.use(express.static(publicDir));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
