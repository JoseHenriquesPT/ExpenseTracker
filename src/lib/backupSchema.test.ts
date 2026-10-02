import { describe, expect, it } from "vitest";
import { BackupValidationError, validateBackup } from "./backupSchema";

const validBackup = () => ({
  version: 1,
  exportedAt: "2026-06-30T18:05:04.986Z",
  expenses: [
    { id: 1, date: "2026-06-03", value: 20, category: "Comida", paidBy: "P1", description: "x" },
  ],
  income: [
    { id: 2, date: "2026-06-03", value: 100, category: "Emprego", person: "P2" },
  ],
  personalExpenses: [
    { id: 3, date: "2026-06-03", value: 5, category: "Compras", person: "P1", description: null },
  ],
  investments: [
    {
      id: 4, date: "2026-06-03", value: 50, category: "Trading 212",
      action: "Invested", scope: "Common", pricePoint: 10, units: 5, description: null,
    },
  ],
  bills: [
    {
      id: 5, date: "2026-06-03", value: 30, category: "Streaming",
      scope: "Common", paidBy: "P2", description: null,
    },
  ],
  settlements: [
    {
      id: 6, date: "2026-06-30", periodStart: "2026-06-01",
      periodEnd: "2026-06-30", from: "P2", to: "P1", amount: 25,
    },
  ],
  config: [
    {
      id: 7, key: "config", p1Name: "A", p2Name: "B",
      incomeCategories: ["Emprego"], expenseCategories: [],
      billCategories: [], investmentCategories: [], actions: ["Invested", "Withdraw"],
    },
  ],
});

const withRow = (table: string, row: Record<string, unknown>) => ({
  ...validBackup(), [table]: [row],
});

describe("validateBackup", () => {
  it("accepts a valid backup and strips ids and unknown keys", () => {
    const out = validateBackup(validBackup());
    expect(out.expenses).toEqual([
      { date: "2026-06-03", value: 20, category: "Comida", paidBy: "P1", description: "x" },
    ]);
    expect(out.income[0]).not.toHaveProperty("id");
    expect(out.income[0]).not.toHaveProperty("unknown");
  });

  it("drops null optional fields so they restore as empty", () => {
    const out = validateBackup(validBackup());
    expect(out.personalExpenses[0]).not.toHaveProperty("description");
    expect(out.investments[0]).not.toHaveProperty("description");
    expect(out.bills[0]).not.toHaveProperty("description");
  });

  it("forces the singleton config key", () => {
    const data = validBackup();
    data.config[0].key = "something-else";
    expect(validateBackup(data).config[0].key).toBe("config");
  });

  it("drops non-positive unit/price values instead of failing the whole backup", () => {
    const out = validateBackup(
      withRow("investments", {
        date: "2026-06-03", value: 50, category: "X",
        action: "Withdraw", scope: "P1", pricePoint: -2, units: 0,
      })
    );
    expect(out.investments[0]).not.toHaveProperty("pricePoint");
    expect(out.investments[0]).not.toHaveProperty("units");
  });

  it("defaults missing tables to empty arrays", () => {
    const out = validateBackup({ version: 1 });
    expect(out.expenses).toEqual([]);
    expect(out.config).toEqual([]);
  });

  it("rejects non-objects, wrong versions and non-array tables", () => {
    expect(() => validateBackup(null)).toThrow(BackupValidationError);
    expect(() => validateBackup([])).toThrow(BackupValidationError);
    expect(() => validateBackup({ version: 2 })).toThrow(/version/i);
    expect(() => validateBackup({ version: 1, expenses: {} })).toThrow(/expenses/i);
  });

  it("rejects malformed rows with the table and position in the message", () => {
    expect(() =>
      validateBackup(withRow("expenses", { date: "2026-6-3", value: 1, category: "x", paidBy: "P1" }))
    ).toThrow(/expenses\[0\]/);
    expect(() =>
      validateBackup(withRow("expenses", { date: "2026-02-30", value: 1, category: "x", paidBy: "P1" }))
    ).toThrow(BackupValidationError);
    expect(() =>
      validateBackup(withRow("expenses", { date: "2026-06-03", value: NaN, category: "x", paidBy: "P1" }))
    ).toThrow(/value/);
    expect(() =>
      validateBackup(withRow("expenses", { date: "2026-06-03", value: 1, category: "", paidBy: "P1" }))
    ).toThrow(/category/);
    expect(() =>
      validateBackup(withRow("expenses", { date: "2026-06-03", value: 1, category: "x", paidBy: "P3" }))
    ).toThrow(/paidBy/);
    expect(() =>
      validateBackup(withRow("income", { date: "2026-06-03", value: 1, category: "x", person: "P1", extra: 1, paidBy: "P1" }))
    ).not.toThrow();
    expect(() =>
      validateBackup(withRow("investments", { date: "2026-06-03", value: 1, category: "x", action: "Buy", scope: "Common" }))
    ).toThrow(/action/);
    expect(() =>
      validateBackup(withRow("bills", { date: "2026-06-03", value: 1, category: "x", scope: "House", paidBy: "P1" }))
    ).toThrow(/scope/);
    expect(() =>
      validateBackup(withRow("settlements", { date: "2026-06-03", periodStart: "2026-06-01", periodEnd: "2026-06-30", from: "P1", amount: 5 }))
    ).toThrow(/"to"/);
    expect(() =>
      validateBackup(withRow("config", { p1Name: "A", p2Name: "B", incomeCategories: [1], expenseCategories: [], billCategories: [], investmentCategories: [], actions: [] }))
    ).toThrow(/incomeCategories/);
  });
});
