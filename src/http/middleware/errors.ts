import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { SlotUnavailableError } from "../../reservations/reserve.js";
import { ReservationNotPayableError } from "../../payments/startPayment.js";
import { logger } from "../../config/logger.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** 404 for unmatched routes. */
export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: "not_found" });
}

/**
 * Central error handler. Maps known errors to clean status codes so malformed
 * or losing requests never surface as a 500 (hardening acceptance item).
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof ZodError) {
    return res
      .status(400)
      .json({ error: "validation_error", details: err.flatten() });
  }
  if (err instanceof SlotUnavailableError) {
    return res.status(409).json({ error: "slot_unavailable", message: err.message });
  }
  if (err instanceof ReservationNotPayableError) {
    return res.status(409).json({ error: "reservation_not_payable", message: err.message });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  logger.error({ err }, "unhandled error");
  return res.status(500).json({ error: "internal_error" });
}
