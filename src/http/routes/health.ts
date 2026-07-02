import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncHandler } from "../middleware/async.js";

export const healthRouter = Router();

healthRouter.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// Readiness includes a DB round-trip.
healthRouter.get(
  "/readyz",
  asyncHandler(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ready" });
  })
);
