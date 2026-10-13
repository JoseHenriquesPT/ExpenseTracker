import { describe, expect, it } from "vitest";
import { purchaseEntry, purchasedPlanPatch } from "./planned";
import type { PlannedExpense } from "../db/types";

const plan: PlannedExpense = {
  id: 1,
  name: "  New couch  ",
  links: [{ text: "Idea", url: "https://example.com/couch" }],
  purchased: false,
  tags: ["Living room"],
};

describe("purchaseEntry", () => {
  it("routes a common purchase to shared expenses, paid by the chosen person", () => {
    const { table, row } = purchaseEntry(plan, {
      value: 499.99,
      scope: "Common",
      paidBy: "P2",
      date: "2026-07-01",
    });
    expect(table).toBe("expenses");
    expect(row).toEqual({
      date: "2026-07-01",
      value: 499.99,
      category: "New couch",
      paidBy: "P2",
      description: "Planned purchase",
    });
    // Plan tags are areas for filtering the wishlist; they never enter the ledger.
    expect(row).not.toHaveProperty("tags");
  });

  it("routes an individual purchase to that person's personal expenses", () => {
    const { table, row } = purchaseEntry(plan, {
      value: 25,
      scope: "P1",
      paidBy: "P2",
      date: "2026-07-02",
    });
    expect(table).toBe("personalExpenses");
    expect(row).toEqual({
      date: "2026-07-02",
      value: 25,
      category: "New couch",
      person: "P1",
      description: "Planned purchase",
    });
  });

  it("uses the individual scope's own person and ignores paidBy", () => {
    const target = purchaseEntry(plan, {
      value: 5,
      scope: "P2",
      paidBy: "P1",
      date: "2026-07-03",
    });
    if (target.table !== "personalExpenses") {
      throw new Error(`expected personalExpenses, got ${target.table}`);
    }
    expect(target.row.person).toBe("P2");
  });

  it("falls back to a usable category when the plan name is blank", () => {
    const { row } = purchaseEntry(
      { ...plan, name: "   " },
      { value: 1, scope: "Common", paidBy: "P1", date: "2026-07-01" }
    );
    expect(row.category).toBe("Planned expense");
  });
});

describe("purchasedPlanPatch", () => {
  it("stamps the final price, date, scope and payer on a common purchase", () => {
    expect(
      purchasedPlanPatch({
        value: 80,
        scope: "Common",
        paidBy: "P1",
        date: "2026-07-04",
      })
    ).toEqual({
      purchased: true,
      purchasedDate: "2026-07-04",
      finalValue: 80,
      scope: "Common",
      paidBy: "P1",
    });
  });

  it("omits paidBy for an individual purchase — the scope is the person", () => {
    expect(
      purchasedPlanPatch({
        value: 12,
        scope: "P2",
        paidBy: "P1",
        date: "2026-07-04",
      })
    ).toEqual({
      purchased: true,
      purchasedDate: "2026-07-04",
      finalValue: 12,
      scope: "P2",
    });
  });
});
