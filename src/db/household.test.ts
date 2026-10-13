import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHouseholdId, onHouseholdChange, setHouseholdId } from "./household";

beforeEach(() => {
  setHouseholdId(null);
});

describe("household id state", () => {
  it("throws a clear error before the household is known", () => {
    expect(() => getHouseholdId()).toThrow(/household/i);
  });

  it("returns the id after it is set", () => {
    setHouseholdId(7);
    expect(getHouseholdId()).toBe(7);
  });

  it("clears back to unset", () => {
    setHouseholdId(7);
    setHouseholdId(null);
    expect(() => getHouseholdId()).toThrow(/household/i);
  });

  it("notifies listeners on change and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = onHouseholdChange(listener);
    setHouseholdId(3);
    setHouseholdId(null);
    unsubscribe();
    setHouseholdId(4);
    expect(listener.mock.calls).toEqual([[3], [null]]);
  });

  it("does not notify when the same id is set again", () => {
    setHouseholdId(3);
    const listener = vi.fn();
    const unsubscribe = onHouseholdChange(listener);
    setHouseholdId(3);
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });
});
