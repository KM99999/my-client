import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { createReservation } from "../../reservations/service.js";
import { startPayment } from "../../payments/startPayment.js";
import { asyncHandler } from "../middleware/async.js";
import { validateBody } from "../middleware/validate.js";
import { HttpError } from "../middleware/errors.js";

export const bookingRouter = Router();

// 1. List active doctors.
bookingRouter.get(
  "/doctors",
  asyncHandler(async (_req, res) => {
    const doctors = await prisma.doctor.findMany({
      where: { active: true },
      select: { id: true, name: true, specialty: true },
      orderBy: { name: "asc" },
    });
    res.json({ doctors });
  })
);

// 2. Available slots for a doctor on a given date (clinic timezone = UTC for M1).
const slotsQuery = z.object({
  doctorId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});
bookingRouter.get(
  "/slots",
  asyncHandler(async (req, res) => {
    const { doctorId, date } = slotsQuery.parse(req.query);
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

    const slots = await prisma.appointmentSlot.findMany({
      where: {
        doctorId,
        status: "Available",
        startsAt: { gte: dayStart, lt: dayEnd },
      },
      select: { id: true, startsAt: true, endsAt: true, status: true },
      orderBy: { startsAt: "asc" },
    });
    res.json({ slots });
  })
);

// 3. Reserve a slot (the concurrency-protected path).
const reserveBody = z.object({
  slotId: z.string().uuid(),
  patientName: z.string().min(1),
  patientEmail: z.string().email(),
  patientPhone: z.string().min(5),
});
bookingRouter.post(
  "/reservations",
  validateBody(reserveBody),
  asyncHandler(async (req, res) => {
    const reservation = await createReservation(req.body);
    res.status(201).json({
      id: reservation.id,
      slotId: reservation.slotId,
      status: reservation.status,
      reservedUntil: reservation.reservedUntil,
    });
  })
);

// 4. Start payment (Pix or card) for an active reservation.
const paymentBody = z.object({ method: z.enum(["pix", "card"]) });
bookingRouter.post(
  "/reservations/:id/payment",
  validateBody(paymentBody),
  asyncHandler(async (req, res) => {
    const result = await startPayment({
      reservationId: String(req.params.id),
      method: req.body.method,
    });
    res.status(201).json(result);
  })
);

// 5. Status polling for the UI (Reserved -> Paid).
bookingRouter.get(
  "/reservations/:id",
  asyncHandler(async (req, res) => {
    const reservation = await prisma.reservation.findUnique({
      where: { id: String(req.params.id) },
      select: {
        id: true,
        status: true,
        reservedUntil: true,
        slot: { select: { id: true, status: true, startsAt: true, endsAt: true } },
      },
    });
    if (!reservation) throw new HttpError(404, "reservation_not_found");
    res.json({ reservation });
  })
);
