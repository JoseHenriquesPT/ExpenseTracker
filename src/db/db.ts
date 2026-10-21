import { supabase } from "./supabase";
import { touch } from "./live";
import { getHouseholdId, getHouseholdSnapshot } from "./household";
import { pushToast } from "../lib/toast";
import { toMessage } from "../lib/errors";
import i18n from "../i18n";
import type {
  ExpenseEntry, IncomeEntry, PersonalExpenseEntry, Investment,
  Bill, PlannedExpense, SettlementRecord, Config, RecurringEntry,
} from "./types";

// Hosted storage: every table lives in Supabase Postgres, gated by Row-Level
// Security + Google sign-in (see supabase/migrations/0001_init.sql).
//
// This module keeps the small slice of the old Dexie API the pages relied on
// (orderBy/reverse/toArray, get, add, put, delete, clear, bulkAdd) so the page
// code barely changed. finance.ts / format.ts are untouched.
//
// Multi-tenant scoping: every read is filtered by the signed-in user's
// household id and every write is stamped with it. RLS enforces the same rule
// server-side; this makes the intent explicit and keeps one household's rows
// out of another's queries even if a policy is ever loosened.

/** App table key -> Postgres table name. */
const TABLE = {
  expenses: "expenses",
  income: "income",
  personalExpenses: "personal_expenses",
  investments: "investments",
  bills: "bills",
  plannedExpenses: "planned_expenses",
  settlements: "settlements",
  recurringEntries: "recurring_entries",
  config: "config",
} as const;

/** Postgres identity columns can't be written, so never send `id`. */
function stripId<T extends { id?: number }>(obj: T): Omit<T, "id"> {
  const { id: _omit, ...rest } = obj;
  return rest;
}

/** Column that ties every row to its household (migration 0008). */
const HOUSEHOLD = "householdId";

/** Insert payload for one row: identity `id` stripped, household stamped. */
function stamped(obj: object, householdId: number): Record<string, unknown> {
  return { ...stripId(obj as { id?: number }), [HOUSEHOLD]: householdId };
}

/** Fail fast on writes while offline, with a message the UI can show — instead
 *  of a confusing network error or a button that silently does nothing. */
export class OfflineError extends Error {
  constructor() {
    super(i18n.t("errors.offline"));
    this.name = "OfflineError";
  }
}
function assertOnline(): void {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new OfflineError();
}

/** Run a write: block when offline (banner handles that case), and on any other
 *  failure raise an error toast so the user knows it didn't save, then rethrow. */
async function guardWrite<R>(op: () => Promise<R>): Promise<R> {
  assertOnline(); // OfflineError: surfaced by the offline banner, not a toast
  try {
    return await op();
  } catch (e) {
    pushToast(toMessage(e), "error");
    throw e;
  }
}

export class SupaTable<T extends { id?: number }> {
  constructor(private readonly table: string) {}

  async toArray(): Promise<T[]> {
    const hid = getHouseholdId();
    const { data, error } = await supabase
      .from(this.table)
      .select("*")
      .eq(HOUSEHOLD, hid);
    if (error) throw error;
    return (data ?? []) as T[];
  }

  /** Mirror of Dexie's `orderBy(col)` with optional `.reverse()`. */
  orderBy(column: string) {
    const run = async (ascending: boolean): Promise<T[]> => {
      const hid = getHouseholdId();
      const { data, error } = await supabase
        .from(this.table)
        .select("*")
        .eq(HOUSEHOLD, hid)
        .order(column, { ascending });
      if (error) throw error;
      return (data ?? []) as T[];
    };
    return {
      toArray: () => run(true),
      reverse: () => ({ toArray: () => run(false) }),
    };
  }

  async get(filter: Partial<T>): Promise<T | undefined> {
    const hid = getHouseholdId();
    let q = supabase.from(this.table).select("*").eq(HOUSEHOLD, hid);
    for (const [k, v] of Object.entries(filter)) q = q.eq(k, v as never);
    const { data, error } = await q.limit(1).maybeSingle();
    if (error) throw error;
    return (data ?? undefined) as T | undefined;
  }

  /** Raw insert of one row (no guard/toast) — shared by add() and put(). */
  private async insertOne(obj: T): Promise<number> {
    const hid = getHouseholdId();
    const { data, error } = await supabase
      .from(this.table)
      .insert(stamped(obj, hid) as never)
      .select("id")
      .single();
    if (error) throw error;
    touch();
    return (data as { id: number }).id;
  }

  async add(obj: T): Promise<number> {
    return guardWrite(() => this.insertOne(obj));
  }

  async put(obj: T): Promise<number> {
    return guardWrite(async () => {
      if (obj.id == null) return this.insertOne(obj);
      const hid = getHouseholdId();
      const { error } = await supabase
        .from(this.table)
        .update(stripId(obj) as never)
        .eq("id", obj.id)
        .eq(HOUSEHOLD, hid);
      if (error) throw error;
      touch();
      return obj.id;
    });
  }

  async delete(id: number): Promise<void> {
    return guardWrite(async () => {
      const hid = getHouseholdId();
      const { error } = await supabase
        .from(this.table)
        .delete()
        .eq("id", id)
        .eq(HOUSEHOLD, hid);
      if (error) throw error;
      touch();
    });
  }

  /** Delete every row (used by backup restore). */
  async clear(): Promise<void> {
    return guardWrite(async () => {
      const hid = getHouseholdId();
      const { error } = await supabase
        .from(this.table)
        .delete()
        .eq(HOUSEHOLD, hid);
      if (error) throw error;
      touch();
    });
  }

  async bulkAdd(objs: T[]): Promise<void> {
    if (!objs.length) return;
    return guardWrite(async () => {
      const hid = getHouseholdId();
      const rows = objs.map((o) => stamped(o, hid));
      const { error } = await supabase.from(this.table).insert(rows as never);
      if (error) throw error;
      touch();
    });
  }
}

export const db = {
  expenses: new SupaTable<ExpenseEntry>(TABLE.expenses),
  income: new SupaTable<IncomeEntry>(TABLE.income),
  personalExpenses: new SupaTable<PersonalExpenseEntry>(TABLE.personalExpenses),
  investments: new SupaTable<Investment>(TABLE.investments),
  bills: new SupaTable<Bill>(TABLE.bills),
  plannedExpenses: new SupaTable<PlannedExpense>(TABLE.plannedExpenses),
  settlements: new SupaTable<SettlementRecord>(TABLE.settlements),
  recurringEntries: new SupaTable<RecurringEntry>(TABLE.recurringEntries),
  config: new SupaTable<Config>(TABLE.config),
};

/** Default config for a brand-new account. */
export const DEFAULT_CONFIG: Omit<Config, "id"> = {
  key: "config",
  p1Name: "Person 1",
  p2Name: "Person 2",
  incomeCategories: ["Salary", "Freelance", "Investments", "Other"],
  expenseCategories: [
    "Groceries",
    "Transport",
    "Dining",
    "Bills",
    "Shopping",
    "Health",
    "Entertainment",
    "Other",
  ],
  billCategories: ["Streaming", "Music", "Gym", "Phone", "Utilities"],
  investmentCategories: ["Brokerage"],
  plannedTags: ["House", "Priority", "Kitchen", "Living Room/Office", "Bedroom"],
  actions: ["Invested", "Withdraw"],
  settlementMethod: "proportional",
  customShareP1: 50,
  hidePaidBy: false,
};

/** Ensure the signed-in household's config row exists; returns it. Safe under a
 *  race: if another client inserts first, the unique (householdId, key)
 *  conflict is recovered. A single-person household seeds one name ("Me"),
 *  since there is no P2 to distinguish from. */
export async function ensureConfig(): Promise<Config> {
  const existing = await db.config.get({ key: "config" });
  if (existing) return existing;

  const single = getHouseholdSnapshot()?.kind === "single";
  const fresh: Omit<Config, "id"> = {
    ...DEFAULT_CONFIG,
    p1Name: single ? "Me" : DEFAULT_CONFIG.p1Name,
  };
  const { data, error } = await supabase
    .from("config")
    .insert(stamped(fresh, getHouseholdId()) as never)
    .select("*")
    .single();

  if (error) {
    const again = await db.config.get({ key: "config" });
    if (again) return again;
    throw error;
  }
  touch();
  return data as Config;
}
