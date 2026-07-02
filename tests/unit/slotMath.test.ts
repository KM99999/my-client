import { describe, it, expect } from "vitest";
import { iterateSlots } from "../../src/slots/slotMath.js";

// Use a fixed weekday date; slot math uses local-time setHours, so we build
// expectations the same way to stay timezone-agnostic in CI.
function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

describe("iterateSlots", () => {
  const day = new Date(2026, 6, 6); // Mon Jul 6 2026 (local)

  it("produces evenly spaced 30-minute slots across a full day", () => {
    const slots = [
      ...iterateSlots(day, {
        startTime: "09:00",
        endTime: "12:00",
        slotMinutes: 30,
      }),
    ];
    expect(slots).toHaveLength(6);
    expect(hhmm(slots[0].startsAt)).toBe("09:00");
    expect(hhmm(slots[0].endsAt)).toBe("09:30");
    expect(hhmm(slots[5].startsAt)).toBe("11:30");
    expect(hhmm(slots[5].endsAt)).toBe("12:00");
  });

  it("respects a non-30 slot length", () => {
    const slots = [
      ...iterateSlots(day, {
        startTime: "09:00",
        endTime: "10:00",
        slotMinutes: 20,
      }),
    ];
    expect(slots.map((s) => hhmm(s.startsAt))).toEqual([
      "09:00",
      "09:20",
      "09:40",
    ]);
  });

  it("drops a trailing partial slot that would spill past endTime", () => {
    // 09:00–10:00 in 45-min steps: 09:00 fits, 09:45 would end 10:30 → dropped.
    const slots = [
      ...iterateSlots(day, {
        startTime: "09:00",
        endTime: "10:00",
        slotMinutes: 45,
      }),
    ];
    expect(slots).toHaveLength(1);
    expect(hhmm(slots[0].startsAt)).toBe("09:00");
    expect(hhmm(slots[0].endsAt)).toBe("09:45");
  });

  it("models limited Sunday hours as a narrower window", () => {
    const sunday = new Date(2026, 6, 5); // Sun Jul 5 2026
    const slots = [
      ...iterateSlots(sunday, {
        startTime: "09:00",
        endTime: "11:00",
        slotMinutes: 30,
      }),
    ];
    expect(slots).toHaveLength(4);
    expect(hhmm(slots.at(-1)!.endsAt)).toBe("11:00");
  });

  it("yields nothing when the window is empty or inverted", () => {
    expect([
      ...iterateSlots(day, {
        startTime: "09:00",
        endTime: "09:00",
        slotMinutes: 30,
      }),
    ]).toHaveLength(0);
    expect([
      ...iterateSlots(day, {
        startTime: "12:00",
        endTime: "09:00",
        slotMinutes: 30,
      }),
    ]).toHaveLength(0);
  });
});
