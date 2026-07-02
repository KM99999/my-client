import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../http/middleware/async.js";
import { validateBody } from "../http/middleware/validate.js";
import { adminAuth } from "../http/middleware/adminAuth.js";
import { materializeSlots } from "../slots/materialize.js";
import { logEvent } from "../db/eventLog.js";

export const adminRouter = Router();

// Every admin route sits behind the shared-secret guard.
adminRouter.use(adminAuth);

const createDoctor = z.object({
  name: z.string().min(1),
  specialty: z.string().optional(),
});
adminRouter.post(
  "/doctors",
  validateBody(createDoctor),
  asyncHandler(async (req, res) => {
    const doctor = await prisma.doctor.create({ data: req.body });
    res.status(201).json({ doctor });
  })
);

adminRouter.get(
  "/doctors",
  asyncHandler(async (_req, res) => {
    const doctors = await prisma.doctor.findMany({ orderBy: { name: "asc" } });
    res.json({ doctors });
  })
);

const patchDoctor = z.object({
  name: z.string().min(1).optional(),
  specialty: z.string().nullable().optional(),
  active: z.boolean().optional(),
});
adminRouter.patch(
  "/doctors/:id",
  validateBody(patchDoctor),
  asyncHandler(async (req, res) => {
    const doctor = await prisma.doctor.update({
      where: { id: String(req.params.id) },
      data: req.body,
    });
    res.json({ doctor });
  })
);

// Create an availability template. Sunday just gets a narrower start/end.
const createTemplate = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  slotMinutes: z.number().int().positive().default(30),
  active: z.boolean().default(true),
});
adminRouter.post(
  "/doctors/:id/availability",
  validateBody(createTemplate),
  asyncHandler(async (req, res) => {
    const template = await prisma.availabilityTemplate.create({
      data: { ...req.body, doctorId: String(req.params.id) },
    });
    res.status(201).json({ template });
  })
);

// Trigger slot materialization on demand (also runs nightly in the worker).
adminRouter.post(
  "/materialize",
  asyncHandler(async (_req, res) => {
    const created = await materializeSlots();
    await logEvent("slots_materialized", { payload: { created } });
    res.json({ created });
  })
);
