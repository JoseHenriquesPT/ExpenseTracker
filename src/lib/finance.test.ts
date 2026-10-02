import { describe, expect, it } from "vitest";
import {
  buildIncomeSplits,
  buildOverview,
  commonShareFor,
  computeSettlement,
  investmentUnits,
  monthEnd,
  monthStart,
  netInvestmentByCategory,
  SAVINGS_CATEGORY,
  sumByCategory,
  summarizeInvestments,
  toISO,
  yearEnd,
  yearStart,
} from "./finance";
import type {
  Bill, Entry, ExpenseEntry, IncomeEntry, Investment, PersonalExpenseEntry,
} from "../db/types";

const income = (date: string, value: number, person: "P1" | "P2"): IncomeEntry => ({
  date, value, category: "Emprego", person,
});
const expense = (date: string, value: number, paidBy: "P1" | "P2"): ExpenseEntry => ({
  date, value, category: "Comida", paidBy,
});
const savedCommon = (date: string, value: number, paidBy: "P1" | "P2"): ExpenseEntry => ({
  date, value, category: SAVINGS_CATEGORY, paidBy, saved: true,
});
const savedPersonal = (
  date: string, value: number, person: "P1" | "P2"
): PersonalExpenseEntry => ({
  date, value, category: SAVINGS_CATEGORY, person, saved: true,
});
const bill = (
  date: string, value: number, scope: "P1" | "P2" | "Common", paidBy: "P1" | "P2"
): Bill => ({ date, value, category: "Streaming", scope, paidBy });
const investment = (over: Partial<Investment>): Investment => ({
  date: "2026-01-01", value: 0, category: "Trading 212",
  action: "Invested", scope: "Common", ...over,
});

describe("date helpers", () => {
  it("formats local dates as ISO", () => {
    expect(toISO(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toISO(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("computes month and year boundaries, including leap years", () => {
    expect(monthStart(2026, 2)).toBe("2026-02-01");
    expect(monthEnd(2026, 2)).toBe("2026-02-28");
    expect(monthEnd(2024, 2)).toBe("2024-02-29");
    expect(monthEnd(2026, 12)).toBe("2026-12-31");
    expect(yearStart(2026)).toBe("2026-01-01");
    expect(yearEnd(2026)).toBe("2026-12-31");
  });
});

describe("sumByCategory", () => {
  const rows: Entry[] = [
    { date: "2026-01-10", value: 10, category: "Comida" },
    { date: "2026-01-11", value: 5, category: "Comida" },
    { date: "2026-02-01", value: 99, category: "Comida" },
    { date: "2026-01-15", value: 7, category: "Bebidas" },
    { date: "2026-01-20", value: 3, category: "Removed" },
    { date: "2025-12-31", value: 50, category: "Removed" },
  ];

  it("sums configured categories inside the window and keeps zeros", () => {
    expect(sumByCategory(rows, ["Comida", "Bebidas", "Vazio"], "2026-01-01", "2026-01-31"))
      .toEqual([
        { category: "Comida", value: 15 },
        { category: "Bebidas", value: 7 },
        { category: "Vazio", value: 0 },
        { category: "Removed", value: 3 },
      ]);
  });

  it("keeps rows whose category is no longer configured, so money never vanishes", () => {
    const out = sumByCategory(rows, ["Comida"], "2026-01-01", "2026-12-31");
    expect(out).toContainEqual({ category: "Removed", value: 3 });
    expect(out).toContainEqual({ category: "Bebidas", value: 7 });
    expect(out.reduce((a, c) => a + c.value, 0)).toBe(10 + 5 + 99 + 7 + 3);
  });
});

describe("netInvestmentByCategory", () => {
  it("nets Invested minus Withdraw and keeps unknown names", () => {
    const rows = [
      investment({ id: 1, value: 100 }),
      investment({ id: 2, action: "Withdraw", value: 40 }),
      investment({ id: 3, value: 10, category: "Legacy name" }),
    ];
    expect(netInvestmentByCategory(rows, ["Trading 212"], "2026-01-01", "2026-12-31"))
      .toEqual([
        { category: "Trading 212", value: 60 },
        { category: "Legacy name", value: 10 },
      ]);
  });
});

describe("buildOverview", () => {
  it("totals each stream and saved, including unconfigured categories", () => {
    const out = buildOverview(
      {
        income: [income("2026-01-01", 100, "P1")],
        expenses: [
          expense("2026-01-02", 30, "P1"),
          {
            date: "2026-01-03", value: 2, category: "Removed", paidBy: "P2",
          } as ExpenseEntry,
          savedCommon("2026-01-06", 15, "P1"),
        ],
        personalExpenses: [
          {
            date: "2026-01-04", value: 5, category: "Comida", person: "P2",
          } as PersonalExpenseEntry,
        ],
        bills: [bill("2026-01-05", 10, "Common", "P1")],
        incomeCategories: ["Emprego"],
        expenseCategories: ["Comida"],
        billCategories: ["Streaming"],
      },
      "2026-01-01",
      "2026-01-31"
    );
    expect(out.totalIncome).toBe(100);
    expect(out.totalExpenses).toBe(32);
    expect(out.totalPersonal).toBe(5);
    expect(out.totalBills).toBe(10);
    expect(out.totalSavings).toBe(15);
    expect(out.totalSaved).toBe(100 - (32 + 5 + 10 + 15));
  });

  it("keeps saved money out of spending and reports it under the Savings category", () => {
    const out = buildOverview(
      {
        income: [],
        expenses: [savedCommon("2026-01-02", 200, "P1")],
        personalExpenses: [savedPersonal("2026-01-03", 50, "P2")],
        bills: [],
        incomeCategories: [],
        expenseCategories: [],
        billCategories: [],
      },
      "2026-01-01",
      "2026-01-31"
    );
    expect(out.totalExpenses).toBe(0);
    expect(out.totalPersonal).toBe(0);
    expect(out.totalSavings).toBe(250);
    expect(out.savings).toEqual([{ category: SAVINGS_CATEGORY, value: 250 }]);
  });
});

describe("commonShareFor", () => {
  it("scales the pool and merges same-named categories", () => {
    const common = commonShareFor(
      [{ category: "Comida", value: 100 }, { category: "Bebidas", value: 50 }],
      [{ category: "Comida", value: 50 }],
      0.5
    );
    expect(common.share).toBe(0.5);
    expect(common.expenses).toBe(75);
    expect(common.bills).toBe(25);
    expect(common.total).toBe(100);
    expect(common.byCategory).toEqual([
      { category: "Comida", value: 75 },
      { category: "Bebidas", value: 25 },
    ]);
  });
});

describe("investmentUnits", () => {
  it("prefers a positive stored unit count", () => {
    expect(investmentUnits(investment({ value: 10, units: 3, pricePoint: 2 }))).toBe(3);
  });

  it("derives units from value / price when units are missing", () => {
    expect(investmentUnits(investment({ value: 10, pricePoint: 2 }))).toBe(5);
  });

  it("treats zero or negative stored units as unknown, never as a real quantity", () => {
    expect(investmentUnits(investment({ value: 10, units: 0, pricePoint: 2 }))).toBe(5);
    expect(investmentUnits(investment({ value: 10, units: -2 }))).toBeNull();
    expect(investmentUnits(investment({ value: 10, units: 0 }))).toBeNull();
  });
});

describe("summarizeInvestments", () => {
  it("books realized profit against average cost on a partial withdrawal", () => {
    const rows = [
      investment({ id: 1, date: "2026-01-01", value: 100, units: 10, pricePoint: 10 }),
      investment({
        id: 2, date: "2026-02-01", action: "Withdraw",
        value: 100, units: 5, pricePoint: 20,
      }),
    ];
    const { holdings, profitByRow } = summarizeInvestments(rows);
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({
      name: "Trading 212", units: 5, costBasis: 50, avgCost: 10,
      invested: 100, withdrawn: 100, realized: 50,
    });
    expect(profitByRow.get(2)).toBe(50);
  });

  it("keeps each scope's position separate when names collide", () => {
    const rows = [
      investment({ id: 1, value: 100, units: 10, scope: "Common" }),
      investment({ id: 2, value: 50, units: 5, scope: "P1" }),
    ];
    const { holdings } = summarizeInvestments(rows);
    expect(holdings).toHaveLength(2);
    expect(holdings.find((h) => h.scope === "Common")?.units).toBe(10);
    expect(holdings.find((h) => h.scope === "P1")?.units).toBe(5);
  });

  it("derives units for a withdrawal that stored zero, instead of booking all proceeds as profit", () => {
    const rows = [
      investment({ id: 1, value: 100, units: 10, pricePoint: 10 }),
      investment({
        id: 2, action: "Withdraw", value: 50, units: 0, pricePoint: 10,
      }),
    ];
    const { holdings, profitByRow } = summarizeInvestments(rows);
    expect(profitByRow.get(2)).toBe(0);
    expect(holdings[0].units).toBe(5);
    expect(holdings[0].costBasis).toBe(50);
  });

  it("reports null profit when a withdrawal has no unit information", () => {
    const rows = [
      investment({ id: 1, value: 100, units: 10 }),
      investment({ id: 2, action: "Withdraw", value: 50, units: 0 }),
    ];
    const { holdings, profitByRow } = summarizeInvestments(rows);
    expect(profitByRow.get(2)).toBeNull();
    expect(holdings[0].units).toBe(10);
  });

  it("ignores negative stored units rather than adding them to the holding", () => {
    const rows = [
      investment({ id: 1, value: 100, units: 10, pricePoint: 10 }),
      investment({
        id: 2, action: "Withdraw", value: 50, units: -5, pricePoint: 10,
      }),
    ];
    const { holdings, profitByRow } = summarizeInvestments(rows);
    expect(profitByRow.get(2)).toBe(0);
    expect(holdings[0].units).toBe(5);
  });

  it("never sells more units than are held or lets cost go negative", () => {
    const rows = [
      investment({ id: 1, value: 100, units: 10, pricePoint: 10 }),
      investment({
        id: 2, action: "Withdraw", value: 400, units: 20, pricePoint: 20,
      }),
    ];
    const { holdings, profitByRow } = summarizeInvestments(rows);
    expect(holdings[0].units).toBe(0);
    expect(holdings[0].costBasis).toBe(0);
    expect(holdings[0].realized).toBe(100);
    expect(profitByRow.get(2)).toBe(100);
  });

  it("leaves legacy value-only withdrawals unvalued", () => {
    const rows = [
      investment({ id: 1, value: 100 }),
      investment({ id: 2, action: "Withdraw", value: 40 }),
    ];
    const { profitByRow } = summarizeInvestments(rows);
    expect(profitByRow.get(2)).toBeNull();
  });
});

describe("computeSettlement", () => {
  const start = "2026-01-01";
  const end = "2026-01-31";

  it("splits the pool by income share and computes a single transfer", () => {
    const s = computeSettlement(
      {
        income: [income(start, 3000, "P1"), income(start, 1000, "P2")],
        expenses: [expense(start, 400, "P1"), expense(start, 400, "P2")],
        bills: [bill(start, 200, "Common", "P1"), bill(start, 500, "P2", "P2")],
      },
      start, end
    );
    expect(s.pool).toBe(1000);
    expect(s.shareP1).toBeCloseTo(0.75);
    expect(s.shareP2).toBeCloseTo(0.25);
    expect(s.fairP1).toBe(750);
    expect(s.fairP2).toBe(250);
    expect(s.balanceP1).toBe(-150);
    expect(s).toMatchObject({ from: "P1", to: "P2", amount: 150, usedFallbackShare: false });
  });

  it("falls back to 50/50 when no income is recorded", () => {
    const s = computeSettlement(
      { income: [], expenses: [expense(start, 100, "P1")], bills: [] },
      start, end
    );
    expect(s.usedFallbackShare).toBe(true);
    expect(s.shareP1).toBe(0.5);
    expect(s).toMatchObject({ from: "P2", to: "P1", amount: 50 });
  });

  it("nets out recorded settlements for the exact window only", () => {
    const input = {
      income: [income(start, 1000, "P1"), income(start, 1000, "P2")],
      expenses: [expense(start, 200, "P1")],
      bills: [],
    };
    const noSettlement = computeSettlement(input, start, end);
    expect(noSettlement).toMatchObject({ from: "P2", to: "P1", amount: 100 });

    const settled = computeSettlement(
      {
        ...input,
        settlements: [
          { date: end, periodStart: start, periodEnd: end, from: "P2", to: "P1", amount: 100 },
          { date: end, periodStart: "2025-01-01", periodEnd: "2025-01-31", from: "P1", to: "P2", amount: 999 },
        ],
      },
      start, end
    );
    expect(settled.settledNetP1).toBe(100);
    expect(settled).toMatchObject({ from: null, to: null, amount: 0 });
  });

  it("accounts for partial and reverse transfers", () => {
    const s = computeSettlement(
      {
        income: [income(start, 1000, "P1"), income(start, 1000, "P2")],
        expenses: [expense(start, 200, "P1")],
        bills: [],
        settlements: [
          { date: end, periodStart: start, periodEnd: end, from: "P2", to: "P1", amount: 130 },
        ],
      },
      start, end
    );
    expect(s.settledNetP1).toBe(130);
    expect(s).toMatchObject({ from: "P1", to: "P2", amount: 30 });
  });

  it("keeps saved-into-investments rows out of the shared pool", () => {
    const s = computeSettlement(
      {
        income: [income(start, 1000, "P1"), income(start, 1000, "P2")],
        expenses: [expense(start, 200, "P1"), savedCommon(start, 500, "P1")],
        bills: [],
      },
      start, end
    );
    expect(s.pool).toBe(200);
    expect(s.paidP1).toBe(200);
    expect(s).toMatchObject({ from: "P2", to: "P1", amount: 100 });
  });
});

describe("buildIncomeSplits", () => {
  const start = "2026-01-01";
  const end = "2026-01-31";

  it("splits each person's income into expenses, invested and saved", () => {
    const { p1, p2 } = buildIncomeSplits(
      {
        income: [income(start, 3000, "P1"), income(start, 1000, "P2")],
        expenses: [
          expense(start, 400, "P1"),
          savedCommon(start, 200, "P1"),
        ],
        personalExpenses: [
          {
            date: start, value: 50, category: "Comida", person: "P2",
          } as PersonalExpenseEntry,
          savedPersonal(start, 300, "P2"),
        ],
        bills: [bill(start, 100, "Common", "P1")],
      },
      start, end
    );
    // P1 carries 75% of common spending, so 0.75×(400 + 100) = 375 and
    // 0.75×200 = 150 of the common investing.
    expect(p1).toMatchObject({ income: 3000, expenses: 375, invested: 150 });
    expect(p1.saved).toBeCloseTo(3000 - 375 - 150);
    // P2's own 50 spend + 300 saved, plus 25% of the common side.
    expect(p2).toMatchObject({ income: 1000, expenses: 175, invested: 350 });
    expect(p2.saved).toBeCloseTo(1000 - 175 - 350);
  });

  it("falls back to a 50/50 share with no income, and reports a negative saved", () => {
    const { p1, p2 } = buildIncomeSplits(
      { income: [], expenses: [expense(start, 100, "P1")], personalExpenses: [], bills: [] },
      start, end
    );
    expect(p1).toMatchObject({ income: 0, expenses: 50, invested: 0, saved: -50 });
    expect(p2).toMatchObject({ income: 0, expenses: 50, invested: 0, saved: -50 });
  });
});
