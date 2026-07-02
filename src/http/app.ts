import express from "express";
import { pinoHttp } from "pino-http";
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

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
