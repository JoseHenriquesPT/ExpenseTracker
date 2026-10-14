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
  plannedExpenses: [
    {
      id: 8, name: "New couch",
      links: [{ text: "Idea", url: "https://example.com/couch" }],
      purchased: false,
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

  it("keeps the saved-into-investments flag, and treats a missing flag as spending", () => {
    const out = validateBackup(
      withRow("expenses", {
        date: "2026-06-03", value: 50, category: "Savings", paidBy: "P1", saved: true,
      })
    );
    expect(out.expenses[0]).toEqual({
      date: "2026-06-03", value: 50, category: "Savings", paidBy: "P1", saved: true,
    });
    // Old exports have no `saved` key — they must still import as plain spending.
    const legacy = validateBackup(validBackup());
    expect(legacy.expenses[0]).not.toHaveProperty("saved");
  });

  it("rejects a junk saved flag", () => {
    expect(() =>
      validateBackup(
        withRow("expenses", {
          date: "2026-06-03", value: 50, category: "Savings", paidBy: "P1", saved: "yes",
        })
      )
    ).toThrow(/saved/);
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
    expect(out.plannedExpenses).toEqual([]);
  });

  it("validates planned expenses, stripping ids and keeping link rows", () => {
    const out = validateBackup(validBackup());
    expect(out.plannedExpenses).toEqual([
      {
        name: "New couch",
        links: [{ text: "Idea", url: "https://example.com/couch" }],
        purchased: false,
        tags: [],
      },
    ]);
  });

  it("keeps purchase details on a purchased plan", () => {
    const out = validateBackup(
      withRow("plannedExpenses", {
        name: "New couch",
        links: [],
        purchased: true,
        purchasedDate: "2026-07-01",
        finalValue: 499.99,
        scope: "Common",
        paidBy: "P1",
      })
    );
    expect(out.plannedExpenses[0]).toEqual({
      name: "New couch",
      links: [],
      purchased: true,
      tags: [],
      purchasedDate: "2026-07-01",
      finalValue: 499.99,
      scope: "Common",
      paidBy: "P1",
    });
  });

  it("drops stray purchase details from an unpurchased plan", () => {
    const out = validateBackup(
      withRow("plannedExpenses", {
        name: "New couch", links: [], purchased: false,
        purchasedDate: "2026-07-01", finalValue: 10, scope: "P1", paidBy: "P2",
      })
    );
    expect(out.plannedExpenses[0]).toEqual({
      name: "New couch", links: [], purchased: false, tags: [],
    });
  });

  it("drops paidBy on an individual purchased plan — the scope is the person", () => {
    const out = validateBackup(
      withRow("plannedExpenses", {
        name: "New couch", links: [], purchased: true,
        purchasedDate: "2026-07-01", finalValue: 10, scope: "P2", paidBy: "P1",
      })
    );
    expect(out.plannedExpenses[0]).not.toHaveProperty("paidBy");
  });

  it("keeps a planned expense's notes on both a draft and a purchased plan", () => {
    const draft = validateBackup(
      withRow("plannedExpenses", {
        name: "New couch", links: [], purchased: false, notes: "Wait for the summer sale",
      })
    );
    expect(draft.plannedExpenses[0].notes).toBe("Wait for the summer sale");

    const purchased = validateBackup(
      withRow("plannedExpenses", {
        name: "New couch", links: [], purchased: true, notes: "Bought the grey one",
        purchasedDate: "2026-07-01", finalValue: 10, scope: "P1",
      })
    );
    expect(purchased.plannedExpenses[0].notes).toBe("Bought the grey one");
  });

  it("rejects a non-string notes value with the row position", () => {
    expect(() =>
      validateBackup(
        withRow("plannedExpenses", { name: "x", links: [], purchased: false, notes: 7 })
      )
    ).toThrow(/notes/);
  });

  it("keeps a planned expense's tags and defaults missing ones to an empty list", () => {
    const tagged = validateBackup(
      withRow("plannedExpenses", {
        name: "New couch", links: [], purchased: false,
        tags: ["Living room", "Sale"],
      })
    );
    expect(tagged.plannedExpenses[0].tags).toEqual(["Living room", "Sale"]);

    // Old exports have no `tags` key — they must still import as untagged.
    expect(validateBackup(validBackup()).plannedExpenses[0].tags).toEqual([]);
  });

  it("rejects malformed planned tags with the row position", () => {
    expect(() =>
      validateBackup(
        withRow("plannedExpenses", { name: "x", links: [], purchased: false, tags: "Sale" })
      )
    ).toThrow(/plannedExpenses\[0\]/);
    expect(() =>
      validateBackup(
        withRow("plannedExpenses", { name: "x", links: [], purchased: false, tags: [1] })
      )
    ).toThrow(/tags/);
  });

  it("keeps config planned tags and defaults missing ones to an empty list", () => {
    expect(validateBackup(validBackup()).config[0].plannedTags).toEqual([]);

    const withTags = validateBackup(
      withRow("config", {
        key: "config", p1Name: "A", p2Name: "B",
        incomeCategories: [], expenseCategories: [], billCategories: [],
        investmentCategories: [], actions: [], plannedTags: ["Kitchen"],
      })
    );
    expect(withTags.config[0].plannedTags).toEqual(["Kitchen"]);
  });

  it("rejects malformed config planned tags", () => {
    expect(() =>
      validateBackup(
        withRow("config", {
          key: "config", p1Name: "A", p2Name: "B",
          incomeCategories: [], expenseCategories: [], billCategories: [],
          investmentCategories: [], actions: [], plannedTags: [1],
        })
      )
    ).toThrow(/plannedTags/);
  });

  it("requires date, price, valid scope and (for Common) payer on a purchased plan", () => {
    const base = {
      name: "New couch", links: [], purchased: true, scope: "P1",
      purchasedDate: "2026-07-01", finalValue: 10,
    };
    expect(() =>
      validateBackup(withRow("plannedExpenses", { ...base, scope: "Common" }))
    ).toThrow(/paidBy/);
    expect(() =>
      validateBackup(withRow("plannedExpenses", { ...base, purchasedDate: undefined }))
    ).toThrow(/purchasedDate/);
    expect(() =>
      validateBackup(withRow("plannedExpenses", { ...base, finalValue: undefined }))
    ).toThrow(/finalValue/);
    expect(() =>
      validateBackup(withRow("plannedExpenses", { ...base, scope: "Both" }))
    ).toThrow(/scope/);
  });

  it("treats a missing purchased flag as not purchased, but rejects junk types", () => {
    const out = validateBackup(
      withRow("plannedExpenses", { name: "New couch", links: [] })
    );
    expect(out.plannedExpenses[0].purchased).toBe(false);
    expect(() =>
      validateBackup(
        withRow("plannedExpenses", { name: "New couch", links: [], purchased: "yes" })
      )
    ).toThrow(/purchased/);
  });

  it("rejects malformed link rows with the row position in the message", () => {
    expect(() =>
      validateBackup(
        withRow("plannedExpenses", { name: "x", links: [{ text: "only text" }], purchased: false })
      )
    ).toThrow(/links\[0\]/);
    expect(() =>
      validateBackup(
        withRow("plannedExpenses", { name: "x", links: "nope", purchased: false })
      )
    ).toThrow(/links/);
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

  it("defaults missing settlement settings to proportional 50/50", () => {
    const out = validateBackup(validBackup());
    expect(out.config[0].settlementMethod).toBe("proportional");
    expect(out.config[0].customShareP1).toBe(50);
  });

  it("keeps valid settlement settings", () => {
    const out = validateBackup(
      withRow("config", {
        key: "config", p1Name: "A", p2Name: "B",
        incomeCategories: [], expenseCategories: [], billCategories: [],
        investmentCategories: [], actions: [],
        settlementMethod: "custom", customShareP1: 65,
      })
    );
    expect(out.config[0].settlementMethod).toBe("custom");
    expect(out.config[0].customShareP1).toBe(65);
  });

  it("rejects an unknown settlement method", () => {
    expect(() =>
      validateBackup(
        withRow("config", {
          key: "config", p1Name: "A", p2Name: "B",
          incomeCategories: [], expenseCategories: [], billCategories: [],
          investmentCategories: [], actions: [],
          settlementMethod: "equal",
        })
      )
    ).toThrow(/settlementMethod/);
  });

  it("clamps a custom share outside 0–100 and rejects junk types", () => {
    const config = (customShareP1: unknown) =>
      withRow("config", {
        key: "config", p1Name: "A", p2Name: "B",
        incomeCategories: [], expenseCategories: [], billCategories: [],
        investmentCategories: [], actions: [],
        settlementMethod: "custom", customShareP1,
      });
    expect(validateBackup(config(150)).config[0].customShareP1).toBe(100);
    expect(validateBackup(config(-10)).config[0].customShareP1).toBe(0);
    expect(() => validateBackup(config("high"))).toThrow(/customShareP1/);
  });
});
