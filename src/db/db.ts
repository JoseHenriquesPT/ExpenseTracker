import { supabase } from "./supabase";
import { touch } from "./live";
import type {
  ExpenseEntry, IncomeEntry, Investment, Bill, BillPayment, Config,
} from "./types";

// Hosted storage: every table lives in Supabase Postgres, gated by Row-Level
// Security + Google sign-in (see supabase/migrations/0001_init.sql).
//
// This module keeps the small slice of the old Dexie API the pages relied on
// (orderBy/reverse/toArray, get, add, put, delete, clear, bulkAdd) so the page
// code barely changed. finance.ts / format.ts are untouched.

/** App table key -> Postgres table name. */
const TABLE = {
  expenses: "expenses",
  income: "income",
  investments: "investments",
  bills: "bills",
  billPayments: "bill_payments",
  config: "config",
} as const;

/** Postgres identity columns can't be written, so never send `id`. */
function stripId<T extends { id?: number }>(obj: T): Omit<T, "id"> {
  const { id: _omit, ...rest } = obj;
  return rest;
}

export class SupaTable<T extends { id?: number }> {
  constructor(private readonly table: string) {}

  async toArray(): Promise<T[]> {
    const { data, error } = await supabase.from(this.table).select("*");
    if (error) throw error;
    return (data ?? []) as T[];
  }

  /** Mirror of Dexie's `orderBy(col)` with optional `.reverse()`. */
  orderBy(column: string) {
    const run = async (ascending: boolean): Promise<T[]> => {
      const { data, error } = await supabase
        .from(this.table)
        .select("*")
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
    let q = supabase.from(this.table).select("*");
    for (const [k, v] of Object.entries(filter)) q = q.eq(k, v as never);
    const { data, error } = await q.limit(1).maybeSingle();
    if (error) throw error;
    return (data ?? undefined) as T | undefined;
  }

  async add(obj: T): Promise<number> {
    const { data, error } = await supabase
      .from(this.table)
      .insert(stripId(obj) as never)
      .select("id")
      .single();
    if (error) throw error;
    touch();
    return (data as { id: number }).id;
  }

  async put(obj: T): Promise<number> {
    if (obj.id != null) {
      const { error } = await supabase
        .from(this.table)
        .update(stripId(obj) as never)
        .eq("id", obj.id);
      if (error) throw error;
      touch();
      return obj.id;
    }
    return this.add(obj);
  }

  async delete(id: number): Promise<void> {
    const { error } = await supabase.from(this.table).delete().eq("id", id);
    if (error) throw error;
    touch();
  }

  /** Delete every row (used by backup restore). */
  async clear(): Promise<void> {
    const { error } = await supabase.from(this.table).delete().neq("id", -1);
    if (error) throw error;
    touch();
  }

  async bulkAdd(objs: T[]): Promise<void> {
    if (!objs.length) return;
    const { error } = await supabase.from(this.table).insert(objs.map(stripId) as never);
    if (error) throw error;
    touch();
  }
}

export const db = {
  expenses: new SupaTable<ExpenseEntry>(TABLE.expenses),
  income: new SupaTable<IncomeEntry>(TABLE.income),
  investments: new SupaTable<Investment>(TABLE.investments),
  bills: new SupaTable<Bill>(TABLE.bills),
  billPayments: new SupaTable<BillPayment>(TABLE.billPayments),
  config: new SupaTable<Config>(TABLE.config),
};

/** Default config, seeded from the original spreadsheet. */
export const DEFAULT_CONFIG: Omit<Config, "id"> = {
  key: "config",
  p1Name: "Person 1",
  p2Name: "Person 2",
  incomeCategories: ["Emprego", "Sub. Refeição", "Side Hustle", "Venda", "Prémio"],
  expenseCategories: [
    "Comida",
    "Compras",
    "Combustível",
    "Restaurante",
    "Bebidas",
    "Divertimento",
    "Roupa",
    "Calçado",
    "Acessórios",
    "Retoma",
  ],
  billCategories: ["Streaming", "Musica", "Ginásio", "Tarifário"],
  investmentCategories: ["Trading 212"],
  actions: ["Invested", "Withdraw"],
  recurrencies: ["Weekly", "Monthly", "Yearly"],
  statuses: ["Active", "Stopped", "Canceled"],
};

/** Ensure the singleton config row exists; returns it. Safe under a race:
 *  if another client inserts first, the unique `key` conflict is recovered. */
export async function ensureConfig(): Promise<Config> {
  const existing = await db.config.get({ key: "config" } as Partial<Config>);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("config")
    .insert(DEFAULT_CONFIG as never)
    .select("*")
    .single();

  if (error) {
    const again = await db.config.get({ key: "config" } as Partial<Config>);
    if (again) return again;
    throw error;
  }
  touch();
  return data as Config;
}
