import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
} from "../../src/domain/stateMachine.js";

describe("slot state machine", () => {
  it("allows the happy-path booking lifecycle", () => {
    expect(canTransition("Available", "Reserved")).toBe(true);
    expect(canTransition("Reserved", "Paid")).toBe(true);
  });

  it("allows a reservation to expire or be released back to Available", () => {
    expect(canTransition("Reserved", "Expired")).toBe(true);
    expect(canTransition("Reserved", "Available")).toBe(true);
    expect(canTransition("Reserved", "Cancelled")).toBe(true);
    expect(canTransition("Expired", "Available")).toBe(true);
  });

  it("allows a paid appointment to be cancelled", () => {
    expect(canTransition("Paid", "Cancelled")).toBe(true);
  });

  it("forbids booking a slot that is not Available", () => {
    expect(canTransition("Reserved", "Reserved")).toBe(false);
    expect(canTransition("Paid", "Reserved")).toBe(false);
    expect(canTransition("Expired", "Reserved")).toBe(false);
    expect(canTransition("Cancelled", "Reserved")).toBe(false);
  });

  it("forbids skipping payment (Available -> Paid) directly", () => {
    expect(canTransition("Available", "Paid")).toBe(false);
  });

  it("treats Cancelled as terminal", () => {
    for (const to of [
      "Available",
      "Reserved",
      "Paid",
      "Expired",
      "Cancelled",
    ] as const) {
      expect(canTransition("Cancelled", to)).toBe(false);
    }
  });

  it("assertTransition throws on an illegal move and is silent on a legal one", () => {
    expect(() => assertTransition("Available", "Reserved")).not.toThrow();
    expect(() => assertTransition("Paid", "Available")).toThrow(
      /Illegal slot transition: Paid -> Available/
    );
  });
});
