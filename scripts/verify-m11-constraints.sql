-- Milestone 1.1 data-layer assertions. Run against a migrated database.
-- Each check reports PASS/FAIL without aborting the script.

DELETE FROM "AppointmentSlot" WHERE "doctorId" = 'm11';
DELETE FROM "Doctor" WHERE id = 'm11';
INSERT INTO "Doctor"(id, name) VALUES ('m11', 'M1.1 Doc');
INSERT INTO "AppointmentSlot"(id,"doctorId","startsAt","endsAt",status)
  VALUES ('m11s1','m11','2026-08-01 09:00','2026-08-01 09:30','Available');

-- 1. Overlapping slot (09:15–09:45) must be rejected by no_overlap_per_doctor.
DO $$
BEGIN
  INSERT INTO "AppointmentSlot"(id,"doctorId","startsAt","endsAt",status)
    VALUES ('m11s2','m11','2026-08-01 09:15','2026-08-01 09:45','Available');
  RAISE NOTICE 'FAIL | overlap should have been rejected';
EXCEPTION WHEN exclusion_violation THEN
  RAISE NOTICE 'PASS | overlapping slot rejected (no_overlap_per_doctor)';
END $$;

-- 2. Duplicate (doctorId, startsAt) must be rejected by the unique index
--    (this is what makes materialization re-runs idempotent).
DO $$
BEGIN
  INSERT INTO "AppointmentSlot"(id,"doctorId","startsAt","endsAt",status)
    VALUES ('m11s3','m11','2026-08-01 09:00','2026-08-01 09:30','Available');
  RAISE NOTICE 'FAIL | duplicate (doctorId,startsAt) should have been rejected';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'PASS | duplicate slot rejected (unique index -> idempotent materialize)';
END $$;

-- 3. Non-overlapping slot (09:30–10:00) must be accepted.
DO $$
BEGIN
  INSERT INTO "AppointmentSlot"(id,"doctorId","startsAt","endsAt",status)
    VALUES ('m11s4','m11','2026-08-01 09:30','2026-08-01 10:00','Available');
  RAISE NOTICE 'PASS | adjacent non-overlapping slot accepted';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAIL | non-overlapping slot was rejected: %', SQLERRM;
END $$;

-- 4. Final: exactly the 2 valid slots (s1, s4) exist for this doctor.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "AppointmentSlot" WHERE "doctorId" = 'm11';
  IF n = 2 THEN RAISE NOTICE 'PASS | slot count = 2 (only the valid inserts survived)';
  ELSE RAISE NOTICE 'FAIL | slot count = % (expected 2)', n;
  END IF;
END $$;

DELETE FROM "AppointmentSlot" WHERE "doctorId" = 'm11';
DELETE FROM "Doctor" WHERE id = 'm11';
