import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../../config/env.js";

/**
 * Rate limiter for abuse-prone write endpoints (reservation + payment start).
 * Configurable via env; RATE_LIMIT_MAX=0 disables it entirely (used by the
 * load-test job so the concurrency proof isn't throttled).
 *
 * On limit, returns a clean 429 JSON — never a 500.
 */
export const writeRateLimiter: RequestHandler =
  env.RATE_LIMIT_MAX <= 0
    ? (_req, _res, next) => next()
    : rateLimit({
        windowMs: env.RATE_LIMIT_WINDOW_MS,
        max: env.RATE_LIMIT_MAX,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) =>
          res.status(429).json({ error: "rate_limited", message: "Too many requests, slow down." }),
      });
