import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHousehold, getHouseholdId, getHouseholdSnapshot, onHouseholdChange,
  setHousehold, type Household,
} from "./household";

const H1: Household = { id: 7, name: "My household", kind: "couple", memberCount: 2 };

beforeEach(() => {
  setHousehold(null);
});

describe("household state", () => {
  it("throws a clear error before the household is known", () => {
    expect(() => getHousehold()).toThrow(/household/i);
    expect(() => getHouseholdId()).toThrow(/household/i);
  });

  it("returns the household and its id after it is set", () => {
    setHousehold(H1);
    expect(getHousehold()).toEqual(H1);
    expect(getHouseholdId()).toBe(7);
    expect(getHouseholdSnapshot()).toEqual(H1);
  });

  it("clears back to unset", () => {
    setHousehold(H1);
    setHousehold(null);
    expect(getHouseholdSnapshot()).toBeNull();
    expect(() => getHousehold()).toThrow(/household/i);
  });

  it("notifies listeners on change and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = onHouseholdChange(listener);
    setHousehold(H1);
    setHousehold(null);
    unsubscribe();
    setHousehold(H1);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not notify when the same household object is set again", () => {
    setHousehold(H1);
    const listener = vi.fn();
    const unsubscribe = onHouseholdChange(listener);
    setHousehold(H1);
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });
});
