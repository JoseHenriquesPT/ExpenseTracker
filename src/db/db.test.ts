import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("./supabase", () => ({ supabase: { from } }));
vi.mock("./live", () => ({ touch: vi.fn() }));
vi.mock("../lib/toast", () => ({ pushToast: vi.fn() }));

import { db, ensureConfig } from "./db";
import { setHousehold } from "./household";

interface Call {
  method: string;
  args: unknown[];
}

type Outcome = { data: unknown; error: unknown };

/** Minimal stand-in for the supabase-js query builder: records every call and
 *  resolves to a canned result, so tests can assert exactly which filters and
 *  payloads the data layer would send. */
class FakeQuery {
  calls: Call[] = [];

  constructor(private readonly result: Outcome) {}

  private record(method: string, args: unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }

  select(...args: unknown[]): this { return this.record("select", args); }
  insert(...args: unknown[]): this { return this.record("insert", args); }
  update(...args: unknown[]): this { return this.record("update", args); }
  delete(...args: unknown[]): this { return this.record("delete", args); }
  eq(...args: unknown[]): this { return this.record("eq", args); }
  neq(...args: unknown[]): this { return this.record("neq", args); }
  order(...args: unknown[]): this { return this.record("order", args); }
  limit(...args: unknown[]): this { return this.record("limit", args); }

  maybeSingle(): Promise<Outcome> {
    this.calls.push({ method: "maybeSingle", args: [] });
    return Promise.resolve(this.result);
  }

  single(): Promise<Outcome> {
    this.calls.push({ method: "single", args: [] });
    return Promise.resolve(this.result);
  }

  then<TResult1 = Outcome, TResult2 = never>(
    onfulfilled?: ((value: Outcome) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

/** Queue the next `supabase.from(...)` call to return a fake query builder. */
function next(result: { data?: unknown; error?: unknown } = {}): FakeQuery {
  const q = new FakeQuery({
    data: result.data === undefined ? [] : result.data,
    error: result.error ?? null,
  });
  from.mockImplementationOnce(() => q);
  return q;
}

function eqCalls(q: FakeQuery): unknown[][] {
  return q.calls.filter((c) => c.method === "eq").map((c) => c.args);
}

beforeEach(() => {
  // Node ships a `navigator` without onLine, which would read as offline.
  vi.stubGlobal("navigator", { onLine: true });
  from.mockReset();
  setHousehold({ id: 1, name: "My household", kind: "couple", memberCount: 2 });
});

describe("SupaTable household scoping", () => {
  it("filters reads to the current household", async () => {
    const q = next({ data: [{ id: 1, value: 5 }] });
    const rows = await db.expenses.toArray();
    expect(rows).toEqual([{ id: 1, value: 5 }]);
    expect(from).toHaveBeenCalledWith("expenses");
    expect(eqCalls(q)).toEqual([["householdId", 1]]);
  });

  it("scopes ordered reads and applies the ordering", async () => {
    const q = next({ data: [] });
    await db.bills.orderBy("date").reverse().toArray();
    expect(eqCalls(q)).toEqual([["householdId", 1]]);
    expect(q.calls).toContainEqual({
      method: "order",
      args: ["date", { ascending: false }],
    });
  });

  it("scopes get() on top of the given filter", async () => {
    const q = next({ data: { id: 2, key: "config" } });
    const row = await db.config.get({ key: "config" });
    expect(row).toEqual({ id: 2, key: "config" });
    expect(eqCalls(q)).toEqual([
      ["householdId", 1],
      ["key", "config"],
    ]);
    expect(q.calls).toContainEqual({ method: "maybeSingle", args: [] });
  });

  it("stamps inserted rows with the household", async () => {
    const q = next({ data: { id: 9 } });
    const id = await db.expenses.add({
      date: "2026-01-01",
      value: 5,
      category: "Comida",
      paidBy: "P1",
    });
    expect(id).toBe(9);
    const insert = q.calls.find((c) => c.method === "insert");
    expect(insert?.args[0]).toMatchObject({ householdId: 1, category: "Comida" });
  });

  it("scopes updates by id and household", async () => {
    const q = next({ data: null });
    await db.expenses.put({
      id: 4,
      date: "2026-01-01",
      value: 5,
      category: "Comida",
      paidBy: "P2",
    });
    expect(q.calls.some((c) => c.method === "update")).toBe(true);
    expect(eqCalls(q)).toEqual([
      ["id", 4],
      ["householdId", 1],
    ]);
  });

  it("scopes deletes by id and household", async () => {
    const q = next({ data: null });
    await db.expenses.delete(4);
    expect(q.calls.some((c) => c.method === "delete")).toBe(true);
    expect(eqCalls(q)).toEqual([
      ["id", 4],
      ["householdId", 1],
    ]);
  });

  it("clear() deletes only the household's rows", async () => {
    const q = next({ data: null });
    await db.settlements.clear();
    expect(eqCalls(q)).toEqual([["householdId", 1]]);
    expect(q.calls.some((c) => c.method === "neq")).toBe(false);
  });

  it("stamps every bulk-inserted row with the household", async () => {
    const q = next({ data: null });
    await db.bills.bulkAdd([
      { date: "2026-01-01", value: 5, category: "Streaming", scope: "Common", paidBy: "P1" },
      { date: "2026-01-02", value: 6, category: "Musica", scope: "Common", paidBy: "P2" },
    ]);
    const insert = q.calls.find((c) => c.method === "insert");
    const rows = insert?.args[0] as Array<{ householdId?: number }>;
    expect(rows.map((r) => r.householdId)).toEqual([1, 1]);
  });

  it("refuses to read or write before the household is known", async () => {
    setHousehold(null);
    await expect(db.expenses.toArray()).rejects.toThrow(/household/i);
    await expect(
      db.expenses.add({ date: "2026-01-01", value: 5, category: "Comida", paidBy: "P1" }),
    ).rejects.toThrow(/household/i);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("ensureConfig", () => {
  it("returns the household's existing config without inserting", async () => {
    const q = next({ data: { id: 1, key: "config" } });
    const config = await ensureConfig();
    expect(config).toEqual({ id: 1, key: "config" });
    expect(q.calls.some((c) => c.method === "insert")).toBe(false);
    expect(eqCalls(q)).toEqual([
      ["householdId", 1],
      ["key", "config"],
    ]);
  });

  it("seeds a config row for the household when missing", async () => {
    next({ data: null });
    const insertQ = next({ data: { id: 3, key: "config", householdId: 1 } });
    const config = await ensureConfig();
    expect(config).toMatchObject({ id: 3, key: "config" });
    const insert = insertQ.calls.find((c) => c.method === "insert");
    expect(insert?.args[0]).toMatchObject({ key: "config", householdId: 1 });
  });

  it("seeds a single-person household with a one-name config", async () => {
    setHousehold({ id: 1, name: "My household", kind: "single", memberCount: 1 });
    next({ data: null });
    const insertQ = next({ data: { id: 3, key: "config", householdId: 1 } });
    await ensureConfig();
    const insert = insertQ.calls.find((c) => c.method === "insert");
    expect(insert?.args[0]).toMatchObject({ p1Name: "Me", householdId: 1 });
  });
});
