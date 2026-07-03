import express, { Router } from "express";
import { handleWebhook } from "../../payments/webhook.js";
import { asyncHandler } from "../middleware/async.js";

export const webhookRouter = Router();

// The raw body is required for signature verification, so this route parses
// with express.raw(); it must be mounted BEFORE the global express.json().
webhookRouter.post(
  "/payment",
  express.raw({ type: "*/*" }),
  asyncHandler(async (req, res) => {
    // AbacatePay signs via X-Webhook-Signature (HMAC); some flows instead pass
    // a `webhookSecret` query param. Pass whichever is present to the provider.
    const querySecret =
      typeof req.query.webhookSecret === "string" ? req.query.webhookSecret : undefined;
    const signature =
      req.header("x-webhook-signature") ??
      req.header("x-signature") ??
      req.header("x-abacate-signature") ??
      querySecret;
    const result = await handleWebhook(req.body as Buffer, signature);
    res.status(result.httpStatus).json(result.body);
  })
);
