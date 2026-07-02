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
    const signature =
      req.header("x-signature") ??
      req.header("x-webhook-signature") ??
      req.header("x-abacate-signature");
    const result = await handleWebhook(req.body as Buffer, signature);
    res.status(result.httpStatus).json(result.body);
  })
);
