-- Constraints Prisma's schema language cannot express. These are the
-- storage-layer guarantees behind acceptance criterion #2: "duplicate
-- reservations are prevented even in the event of application logic errors."

-- Partial unique index documenting intent: a slot can hold at most one
-- live (Reserved/Paid) claim. (Reservation.slotId is already @unique, but
-- this makes the guarantee explicit on the slot side too.)
CREATE UNIQUE INDEX "one_live_slot_hold"
  ON "AppointmentSlot" ("id")
  WHERE status IN ('Reserved', 'Paid');

-- Prevent overlapping slots for the same doctor. Requires btree_gist so an
-- equality predicate on doctorId can share a GiST index with a range overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "AppointmentSlot"
  ADD CONSTRAINT "no_overlap_per_doctor"
  EXCLUDE USING gist (
    "doctorId" WITH =,
    tsrange("startsAt", "endsAt") WITH &&
  );
