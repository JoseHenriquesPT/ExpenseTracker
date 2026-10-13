import type {
  Bill, Config, ExpenseEntry, IncomeEntry, Investment, InvestmentAction,
  Person, PersonalExpenseEntry, PlannedExpense, Scope, SettlementRecord,
} from "../db/types";

/** A backup row as stored in the exported JSON (ids are ignored on import). */
export type BackupRow<T extends { id?: number }> = Omit<T, "id">;

export interface BackupData {
  version: 1;
  exportedAt?: string;
  expenses: BackupRow<ExpenseEntry>[];
  income: BackupRow<IncomeEntry>[];
  personalExpenses: BackupRow<PersonalExpenseEntry>[];
  investments: BackupRow<Investment>[];
  bills: BackupRow<Bill>[];
  plannedExpenses: BackupRow<PlannedExpense>[];
  settlements: BackupRow<SettlementRecord>[];
  config: BackupRow<Config>[];
}

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupValidationError";
  }
}

const PEOPLE = ["P1", "P2"] as const;
const SCOPES = ["P1", "P2", "Common"] as const;
const ACTIONS = ["Invested", "Withdraw"] as const;

type Row = Record<string, unknown>;

function fail(where: string, why: string): never {
  throw new BackupValidationError(`Backup ${where}: ${why}`);
}

function isRecord(v: unknown): v is Row {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isISODate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function dateField(row: Row, key: string, where: string): string {
  const v = row[key];
  if (!isISODate(v)) fail(where, `"${key}" must be a valid YYYY-MM-DD date`);
  return v;
}

function numField(row: Row, key: string, where: string): number {
  const v = row[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    fail(where, `"${key}" must be a number`);
  }
  return v;
}

function stringField(row: Row, key: string, where: string): string {
  const v = row[key];
  if (typeof v !== "string") fail(where, `"${key}" must be a string`);
  return v;
}

function optionalString(row: Row, key: string, where: string): string | undefined {
  const v = row[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") fail(where, `"${key}" must be a string`);
  return v;
}

/** Keeps a positive number, drops null/zero/negative junk silently. */
function optionalPositive(row: Row, key: string, where: string): number | undefined {
  const v = row[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    fail(where, `"${key}" must be a number`);
  }
  return v > 0 ? v : undefined;
}

function enumField<T extends string>(
  row: Row, key: string, allowed: readonly T[], where: string
): T {
  const v = row[key];
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    fail(where, `"${key}" must be one of ${allowed.map((a) => `"${a}"`).join(", ")}`);
  }
  return v as T;
}

function stringList(row: Row, key: string, where: string): string[] {
  const v = row[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    fail(where, `"${key}" must be an array of strings`);
  }
  return v as string[];
}

/** A boolean that may be absent (older exports, hand-made files): absent/null
 *  means false, anything that isn't a boolean is an error. */
function boolField(row: Row, key: string, where: string): boolean {
  const v = row[key];
  if (v === undefined || v === null) return false;
  if (typeof v !== "boolean") fail(where, `"${key}" must be true or false`);
  return v;
}

/** The links list on a planned expense: each row needs both a text and a URL. */
function plannedLinks(row: Row, where: string): PlannedExpense["links"] {
  const v = row.links;
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail(where, `"links" must be an array`);
  return v.map((item, j) => {
    const at = `${where}.links[${j}]`;
    if (!isRecord(item)) fail(at, "must be an object");
    return { text: stringField(item, "text", at), url: stringField(item, "url", at) };
  });
}

/** Shared Entry fields; null optionals are dropped so they restore as empty. */
function entryFields(row: Row, where: string) {
  const description = optionalString(row, "description", where);
  const category = stringField(row, "category", where);
  if (!category) fail(where, `"category" must not be empty`);
  return {
    date: dateField(row, "date", where),
    value: numField(row, "value", where),
    category,
    ...(description !== undefined ? { description } : {}),
  };
}

function tableRows(input: Row, table: string): Row[] {
  const v = input[table];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail(`"${table}"`, "must be an array");
  return v.map((row, i) => {
    if (!isRecord(row)) fail(`${table}[${i}]`, "must be an object");
    return row;
  });
}

/**
 * Validate and sanitize a parsed backup. Throws {@link BackupValidationError}
 * with the offending table/row so the UI can explain what's wrong, instead of
 * clearing the database first and failing halfway.
 */
export function validateBackup(input: unknown): BackupData {
  if (!isRecord(input)) fail("file", "is not a JSON object");
  if (input.version !== 1) {
    fail("file", `has unsupported version "${String(input.version)}" (expected 1)`);
  }

  const expenses = tableRows(input, "expenses").map((row, i) => {
    const where = `expenses[${i}]`;
    const saved = boolField(row, "saved", where);
    return {
      ...entryFields(row, where),
      paidBy: enumField(row, "paidBy", PEOPLE, where) as Person,
      ...(saved ? { saved: true } : {}),
    };
  });

  const income = tableRows(input, "income").map((row, i) => {
    const where = `income[${i}]`;
    return { ...entryFields(row, where), person: enumField(row, "person", PEOPLE, where) as Person };
  });

  const personalExpenses = tableRows(input, "personalExpenses").map((row, i) => {
    const where = `personalExpenses[${i}]`;
    const saved = boolField(row, "saved", where);
    return {
      ...entryFields(row, where),
      person: enumField(row, "person", PEOPLE, where) as Person,
      ...(saved ? { saved: true } : {}),
    };
  });

  const investments = tableRows(input, "investments").map((row, i) => {
    const where = `investments[${i}]`;
    const pricePoint = optionalPositive(row, "pricePoint", where);
    const units = optionalPositive(row, "units", where);
    return {
      ...entryFields(row, where),
      action: enumField(row, "action", ACTIONS, where) as InvestmentAction,
      scope: enumField(row, "scope", SCOPES, where) as Scope,
      ...(pricePoint !== undefined ? { pricePoint } : {}),
      ...(units !== undefined ? { units } : {}),
    };
  });

  const bills = tableRows(input, "bills").map((row, i) => {
    const where = `bills[${i}]`;
    return {
      ...entryFields(row, where),
      scope: enumField(row, "scope", SCOPES, where) as Scope,
      paidBy: enumField(row, "paidBy", PEOPLE, where) as Person,
    };
  });

  const plannedExpenses = tableRows(input, "plannedExpenses").map((row, i) => {
    const where = `plannedExpenses[${i}]`;
    const name = stringField(row, "name", where);
    const notes = optionalString(row, "notes", where);
    const links = plannedLinks(row, where);
    const tags = stringList(row, "tags", where);
    const purchased = boolField(row, "purchased", where);
    const draft = {
      name,
      links,
      tags,
      purchased,
      ...(notes !== undefined ? { notes } : {}),
    };
    // Purchase details only exist on bought items; on a draft plan they're
    // dropped, so junk can't sneak into the restore.
    if (!purchased) return draft;
    const scope = enumField(row, "scope", SCOPES, where) as Scope;
    return {
      ...draft,
      purchasedDate: dateField(row, "purchasedDate", where),
      finalValue: numField(row, "finalValue", where),
      scope,
      ...(scope === "Common"
        ? { paidBy: enumField(row, "paidBy", PEOPLE, where) as Person }
        : {}),
    };
  });

  const settlements = tableRows(input, "settlements").map((row, i) => {
    const where = `settlements[${i}]`;
    return {
      date: dateField(row, "date", where),
      periodStart: dateField(row, "periodStart", where),
      periodEnd: dateField(row, "periodEnd", where),
      from: enumField(row, "from", PEOPLE, where) as Person,
      to: enumField(row, "to", PEOPLE, where) as Person,
      amount: numField(row, "amount", where),
    };
  });

  const config = tableRows(input, "config").map((row, i) => {
    const where = `config[${i}]`;
    const actions = stringList(row, "actions", where).filter(
      (a): a is InvestmentAction => (ACTIONS as readonly string[]).includes(a)
    );
    return {
      key: "config",
      p1Name: stringField(row, "p1Name", where),
      p2Name: stringField(row, "p2Name", where),
      incomeCategories: stringList(row, "incomeCategories", where),
      expenseCategories: stringList(row, "expenseCategories", where),
      billCategories: stringList(row, "billCategories", where),
      investmentCategories: stringList(row, "investmentCategories", where),
      plannedTags: stringList(row, "plannedTags", where),
      actions: actions.length ? actions : [...ACTIONS],
    };
  });

  const exportedAt =
    input.exportedAt === undefined ? undefined : stringField(input, "exportedAt", "file");

  return {
    version: 1,
    ...(exportedAt !== undefined ? { exportedAt } : {}),
    expenses, income, personalExpenses, investments, bills, plannedExpenses,
    settlements, config,
  };
}

/** One-line summary of what a backup contains, for the confirmation dialog. */
export function describeBackup(data: BackupData): string {
  return [
    `${data.expenses.length} common expenses`,
    `${data.income.length} income entries`,
    `${data.personalExpenses.length} individual expenses`,
    `${data.investments.length} investments`,
    `${data.bills.length} bills`,
    `${data.plannedExpenses.length} planned expenses`,
    `${data.settlements.length} settlements`,
  ].join(", ");
}
