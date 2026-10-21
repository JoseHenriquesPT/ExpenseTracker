import { beforeEach, describe, expect, it, vi } from "vitest";
import { type FakeQuery, queueQuery } from "./fakeSupabase";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  add: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  toArray: vi.fn(),
  touch: vi.fn(),
  pushToast: vi.fn(),
}));

vi.mock("./supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("./db", () => ({
  OfflineError: class OfflineError extends Error {},
  db: {
    recurringEntries: {
      add: mocks.add,
      put: mocks.put,
      get: mocks.get,
      delete: mocks.del,
      toArray: mocks.toArray,
    },
    income: { put: vi.fn() },
    bills: { put: vi.fn() },
  },
}));
vi.mock("./household", () => ({ getHouseholdId: () => 1 }));
vi.mock("./live", () => ({ touch: mocks.touch }));
vi.mock("../lib/toast", () => ({ pushToast: mocks.pushToast }));

import {
  addRecurringIncome,
  ensureRecurring,
  saveRecurringOccurrence,
  stopRecurringFrom,
} from "./recurring";

function next(result: { data?: unknown; error?: unknown } = {}): FakeQuery {
  return queueQuery(mocks.from, result);
}

beforeEach(() => {
  vi.stubGlobal("navigator", { onLine: true });
  mocks.from.mockReset();
  mocks.add.mockReset();
  mocks.put.mockReset();
  mocks.get.mockReset();
  mocks.del.mockReset();
  mocks.toArray.mockReset();
  mocks.touch.mockReset();
  mocks.pushToast.mockReset();
});

describe("addRecurringIncome", () => {
  it("creates the series and materializes every month through the horizon", async () => {
    mocks.add.mockResolvedValue(42);
    next({ data: [] }); // existingDates
    const upsert = next({ data: null });
    mocks.put.mockResolvedValue(42);

    await addRecurringIncome(
      {
        date: "2026-01-31",
        value: 100,
        category: "Salary",
        person: "P1",
        description: "Monthly pay",
      },
      "2026-01-15"
    );

    expect(mocks.add).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "income",
        startDate: "2026-01-31",
        value: 100,
        category: "Salary",
        person: "P1",
      })
    );

    const call = upsert.calls.find((c) => c.method === "upsert");
    expect(call?.args[1]).toEqual({
      onConflict: "recurringId,date",
      ignoreDuplicates: true,
    });
    const rows = call?.args[0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(25);
    expect(rows[0]).toMatchObject({
      date: "2026-01-31",
      recurringId: 42,
      householdId: 1,
      person: "P1",
    });
    expect(rows[1]).toMatchObject({ date: "2026-02-28" });
    expect(rows[rows.length - 1]).toMatchObject({ date: "2028-01-31" });
    expect(mocks.put).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42, generatedThrough: "2028-01-31" })
    );
  });
});

describe("ensureRecurring", () => {
  it("tops up only the missing months and advances the marker", async () => {
    mocks.toArray.mockResolvedValue([
      {
        id: 7,
        kind: "bill",
        startDate: "2026-01-31",
        value: 10,
        category: "Phone",
        scope: "Common",
        paidBy: "P1",
        generatedThrough: "2026-02-28",
      },
    ]);
    next({ data: [{ date: "2026-03-31" }] }); // already generated elsewhere
    const upsert = next({ data: null });
    mocks.put.mockResolvedValue(7);

    await ensureRecurring("2026-03-10");

    const rows = upsert.calls.find((c) => c.method === "upsert")?.args[0] as Array<{
      date: string;
    }>;
    expect(rows).toHaveLength(24);
    expect(rows.map((r) => r.date)).not.toContain("2026-03-31");
    expect(rows[0].date).toBe("2026-04-30");
    expect(rows[rows.length - 1].date).toBe("2028-03-31");
    expect(mocks.put).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, generatedThrough: "2028-03-31" })
    );
  });

  it("does nothing when the series is already filled", async () => {
    mocks.toArray.mockResolvedValue([
      {
        id: 7,
        kind: "bill",
        startDate: "2026-01-31",
        value: 10,
        category: "Phone",
        scope: "Common",
        paidBy: "P1",
        generatedThrough: "2028-03-31",
      },
    ]);

    await ensureRecurring("2026-03-10");

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });
});

describe("saveRecurringOccurrence", () => {
  it("updates the series and every occurrence from this month onward", async () => {
    mocks.get.mockResolvedValue({
      id: 7,
      kind: "bill",
      startDate: "2026-01-31",
      value: 10,
      category: "Phone",
      scope: "Common",
      paidBy: "P1",
      generatedThrough: "2028-03-31",
    });
    mocks.put.mockResolvedValue(7);
    const update = next({ data: null });

    await saveRecurringOccurrence(
      "bill",
      {
        id: 5,
        date: "2026-03-31",
        value: 10,
        category: "Phone",
        scope: "Common",
        paidBy: "P1",
        recurringId: 7,
      },
      {
        date: "2026-03-31",
        value: 20,
        category: "Utilities",
        scope: "Common",
        paidBy: "P2",
        description: "",
      },
      "future"
    );

    expect(mocks.put).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 7,
        value: 20,
        category: "Utilities",
        paidBy: "P2",
      })
    );
    expect(update.calls).toContainEqual({
      method: "update",
      args: [{ value: 20, category: "Utilities", description: "", scope: "Common", paidBy: "P2" }],
    });
    expect(update.calls).toContainEqual({ method: "eq", args: ["householdId", 1] });
    expect(update.calls).toContainEqual({ method: "eq", args: ["recurringId", 7] });
    expect(update.calls).toContainEqual({ method: "gte", args: ["date", "2026-03-31"] });
  });
});

describe("stopRecurringFrom", () => {
  it("deletes this and future months, then the series", async () => {
    const del = next({ data: null });
    mocks.del.mockResolvedValue(undefined);

    await stopRecurringFrom("income", {
      id: 4,
      date: "2026-06-30",
      value: 100,
      category: "Salary",
      person: "P1",
      recurringId: 42,
    });

    expect(del.calls).toContainEqual({ method: "delete", args: [] });
    expect(del.calls).toContainEqual({ method: "eq", args: ["householdId", 1] });
    expect(del.calls).toContainEqual({ method: "eq", args: ["recurringId", 42] });
    expect(del.calls).toContainEqual({ method: "gte", args: ["date", "2026-06-30"] });
    expect(mocks.del).toHaveBeenCalledWith(42);
  });
});
