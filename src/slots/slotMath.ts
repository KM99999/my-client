export interface SlotTemplate {
  startTime: string; // "09:00"
  endTime: string; // "17:00"
  slotMinutes: number;
}

export interface MaterializedSlot {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Pure slot math: walk a single day's template from startTime to endTime in
 * slotMinutes steps. A partial slot that would spill past endTime is dropped
 * (`next <= end`). "Limited Sunday hours" fall out naturally — Sunday just gets
 * a template with a narrower start/end.
 *
 * No DB or env dependency, so the arithmetic is unit-testable in isolation.
 */
export function* iterateSlots(
  day: Date,
  t: SlotTemplate
): Generator<MaterializedSlot> {
  const [sh, sm] = t.startTime.split(":").map(Number);
  const [eh, em] = t.endTime.split(":").map(Number);

  const start = new Date(day);
  start.setHours(sh, sm, 0, 0);
  const end = new Date(day);
  end.setHours(eh, em, 0, 0);

  for (let cur = new Date(start); cur < end; ) {
    const next = new Date(cur.getTime() + t.slotMinutes * 60_000);
    if (next <= end) yield { startsAt: new Date(cur), endsAt: new Date(next) };
    cur = next;
  }
}
