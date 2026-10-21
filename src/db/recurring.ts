import { supabase } from "./supabase";
import { db, OfflineError } from "./db";
import { getHouseholdId } from "./household";
import { touch } from "./live";
import { pushToast } from "../lib/toast";
import { toMessage } from "../lib/errors";
import { toISO } from "../lib/finance";
import {
  generationThrough,
  occurrencesBetween,
  RECURRING_HORIZON_MONTHS,
} from "../lib/recurring";
import type {
  Bill, IncomeEntry, Person, RecurringEntry, Scope,
} from "./types";

// Recurring income and bills are materialized as ordinary rows: each series in
// `recurring_entries` writes one income/bills row per month, linked back with
// `recurringId`. Reads and every finance calculation stay unchanged.
//
// Generation is idempotent: the (recurringId, date) unique index plus
// ignore-duplicates upsert means two devices topping up the same series can't
// write a month twice. `generatedThrough` means a month the user deleted is
// never silently recreated.

export type RecurringKind = "income" | "bill";

export interface RecurringIncomeInput {
  date: string;
  value: number;
  category: string;
  person: Person;
  description?: string;
}

export interface RecurringBillInput {
  date: string;
  value: number;
  category: string;
  scope: Scope;
  paidBy: Person;
  description?: string;
}

/** Fields an edit can change on one month (and optionally on future months). */
export interface EntryChanges {
  date: string;
  value: number;
  category: string;
  description?: string;
  person?: Person;
  scope?: Scope;
  paidBy?: Person;
}

type Occurrence = IncomeEntry | Bill;

function todayISO(): string {
  return toISO(new Date());
}

function tableFor(kind: RecurringKind): "income" | "bills" {
  return kind === "income" ? "income" : "bills";
}

function assertOnline(): void {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new OfflineError();
  }
}

function occurrenceRow(series: RecurringEntry, date: string): Occurrence {
  if (series.kind === "income") {
    return {
      date,
      value: series.value,
      category: series.category,
      ...(series.description ? { description: series.description } : {}),
      person: series.person!,
      recurringId: series.id,
    };
  }
  return {
    date,
    value: series.value,
    category: series.category,
    ...(series.description ? { description: series.description } : {}),
    scope: series.scope!,
    paidBy: series.paidBy!,
    recurringId: series.id,
  };
}

/** Read the current month's rows for a set of series dates (used only to skip
 *  redundant upserts — the unique index is the real guarantee). */
async function existingDates(
  kind: RecurringKind,
  seriesId: number,
  dates: string[]
): Promise<Set<string>> {
  if (!dates.length) return new Set();
  const { data, error } = await supabase
    .from(tableFor(kind))
    .select("date")
    .eq("householdId", getHouseholdId())
    .eq("recurringId", seriesId)
    .in("date", dates);
  if (error) throw error;
  return new Set(((data ?? []) as { date: string }[]).map((r) => r.date));
}

async function writeOccurrences(kind: RecurringKind, rows: Occurrence[]): Promise<void> {
  if (!rows.length) return;
  const hid = getHouseholdId();
  const payload = rows.map((r) => ({ ...r, householdId: hid }));
  const { error } = await supabase
    .from(tableFor(kind))
    .upsert(payload as never, {
      onConflict: "recurringId,date",
      ignoreDuplicates: true,
    });
  if (error) throw error;
  touch();
}

/** Write every missing month of one series up to `through`, then advance the
 *  series marker. Safe to call on every launch. */
async function generateSeries(series: RecurringEntry, through: string): Promise<void> {
  if (series.id == null) return;
  const dates = occurrencesBetween(series.startDate, series.generatedThrough, through);
  if (!dates.length) return;

  const present = await existingDates(series.kind, series.id, dates);
  await writeOccurrences(
    series.kind,
    dates.filter((d) => !present.has(d)).map((date) => occurrenceRow(series, date))
  );

  await db.recurringEntries.put({
    ...series,
    generatedThrough: dates[dates.length - 1],
  });
}

/** Top every active series up to the rolling horizon. Called when the app
 *  opens (and whenever the household changes); failures stay in the console so
 *  a flaky connection doesn't nag on every launch. */
export async function ensureRecurring(today = todayISO()): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  try {
    const series = await db.recurringEntries.toArray();
    for (const s of series ?? []) {
      const through = generationThrough(s.startDate, today, RECURRING_HORIZON_MONTHS);
      if (s.generatedThrough && s.generatedThrough >= through) continue;
      await generateSeries(s, through);
    }
  } catch (e) {
    console.error("ensureRecurring:", e);
  }
}

/** Create a monthly income series and its first batch of rows. */
export async function addRecurringIncome(
  input: RecurringIncomeInput,
  today = todayISO()
): Promise<number> {
  assertOnline();
  const series: Omit<RecurringEntry, "id"> = {
    kind: "income",
    startDate: input.date,
    value: input.value,
    category: input.category,
    person: input.person,
    ...(input.description ? { description: input.description } : {}),
  };
  try {
    const id = await db.recurringEntries.add(series);
    await generateSeries(
      { ...series, id },
      generationThrough(input.date, today, RECURRING_HORIZON_MONTHS)
    );
    return id;
  } catch (e) {
    pushToast(toMessage(e), "error");
    throw e;
  }
}

/** Create a monthly bill series and its first batch of rows. */
export async function addRecurringBill(
  input: RecurringBillInput,
  today = todayISO()
): Promise<number> {
  assertOnline();
  const series: Omit<RecurringEntry, "id"> = {
    kind: "bill",
    startDate: input.date,
    value: input.value,
    category: input.category,
    scope: input.scope,
    paidBy: input.paidBy,
    ...(input.description ? { description: input.description } : {}),
  };
  try {
    const id = await db.recurringEntries.add(series);
    await generateSeries(
      { ...series, id },
      generationThrough(input.date, today, RECURRING_HORIZON_MONTHS)
    );
    return id;
  } catch (e) {
    pushToast(toMessage(e), "error");
    throw e;
  }
}

/** Fields a series and its future rows share. Date is intentionally not here:
 *  a date change applies to the edited month only. */
function seriesFields(kind: RecurringKind, changes: EntryChanges) {
  const common = {
    value: changes.value,
    category: changes.category,
    description: changes.description ?? "",
  };
  return kind === "income"
    ? { ...common, person: changes.person }
    : { ...common, scope: changes.scope, paidBy: changes.paidBy };
}

/** Update one occurrence. When `apply` is "future", the series template and
 *  every occurrence from this month onward change too; earlier months keep the
 *  old amount. Date changes only ever apply to the edited row. */
export async function saveRecurringOccurrence(
  kind: RecurringKind,
  row: Occurrence,
  changes: EntryChanges,
  apply: "one" | "future"
): Promise<void> {
  assertOnline();

  if (apply === "one" || row.recurringId == null) {
    if (kind === "income") {
      await db.income.put({
        ...(row as IncomeEntry),
        date: changes.date,
        value: changes.value,
        category: changes.category,
        description: changes.description ?? "",
        person: changes.person ?? (row as IncomeEntry).person,
      });
    } else {
      await db.bills.put({
        ...(row as Bill),
        date: changes.date,
        value: changes.value,
        category: changes.category,
        description: changes.description ?? "",
        scope: changes.scope ?? (row as Bill).scope,
        paidBy: changes.paidBy ?? (row as Bill).paidBy,
      });
    }
    return;
  }

  const fields = seriesFields(kind, changes);
  try {
    const series = await db.recurringEntries.get({ id: row.recurringId });
    if (series?.id != null) {
      await db.recurringEntries.put({ ...series, ...fields } as RecurringEntry);
    }
    const { error } = await supabase
      .from(tableFor(kind))
      .update(fields as never)
      .eq("householdId", getHouseholdId())
      .eq("recurringId", row.recurringId)
      .gte("date", row.date);
    if (error) throw error;
    touch();
  } catch (e) {
    pushToast(toMessage(e), "error");
    throw e;
  }
}

/** Stop a series from this occurrence onward: delete this and all later
 *  months, then the series itself. Earlier rows stay as plain history. */
export async function stopRecurringFrom(
  kind: RecurringKind,
  row: Occurrence
): Promise<void> {
  assertOnline();
  if (row.recurringId == null) return;
  try {
    const { error } = await supabase
      .from(tableFor(kind))
      .delete()
      .eq("householdId", getHouseholdId())
      .eq("recurringId", row.recurringId)
      .gte("date", row.date);
    if (error) throw error;
    await db.recurringEntries.delete(row.recurringId);
    touch();
  } catch (e) {
    pushToast(toMessage(e), "error");
    throw e;
  }
}
