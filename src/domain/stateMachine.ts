import type { SlotStatus } from "@prisma/client";

// Encode transitions as data so illegal moves are impossible, not just
// discouraged. This is the pure safety net the whole booking flow relies on.
const allowed: Record<SlotStatus, SlotStatus[]> = {
  Available: ["Reserved"],
  Reserved: ["Paid", "Expired", "Cancelled", "Available"], // Available = released
  Paid: ["Cancelled"],
  Expired: ["Available"],
  Cancelled: [],
};

export function canTransition(from: SlotStatus, to: SlotStatus): boolean {
  return allowed[from]?.includes(to) ?? false;
}

export function assertTransition(from: SlotStatus, to: SlotStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal slot transition: ${from} -> ${to}`);
  }
}
