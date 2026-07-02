import express from "express";
import { pinoHttp } from "pino-http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { logger } from "../config/logger.js";
import { healthRouter } from "./routes/health.js";
import { bookingRouter } from "./routes/booking.js";
import { webhookRouter } from "./routes/webhook.js";
import { adminRouter } from "../admin/routes.js";
import { errorHandler, notFound } from "./middleware/errors.js";

export function createApp() {
  const app = express();

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
