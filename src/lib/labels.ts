import type { Person, Scope } from "../db/types";

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const monthName = (month: number): string => MONTHS[month - 1] ?? "";

export interface PersonNames {
  p1: string;
  p2: string;
}

/** Display name for P1/P2 from the configured names. */
export function personName(person: Person, names: PersonNames): string {
  return person === "P1" ? names.p1 : names.p2;
}

/** Display name for a bill/investment scope. */
export function scopeName(scope: Scope, names: PersonNames): string {
  return scope === "Common" ? "Common" : personName(scope, names);
}

/** The year dropdown window: four before this year, four after. */
export function yearOptions(count = 8): number[] {
  const base = new Date().getFullYear();
  return Array.from({ length: count }, (_, i) => base - 4 + i);
}

/** The wording that changes when a household tracks one person instead of a
 *  couple: shared streams stop being "Common" and the lone person's pie stops
 *  being someone's. Pages read these values instead of branching per string. */
export interface ModeText {
  /** "Expenses" | "Common Expenses" — the shared spending stream. */
  expenses: string;
  /** "Bills" | "Common Bills" — the shared bills stream. */
  bills: string;
  /** Compact chart bars for the same two streams. */
  expensesShort: string;
  billsShort: string;
  /** A common-expense row's kind chip: "Expense" | "Common". */
  expenseKind: string;
  /** Income-split pie title: "Your Totals" | "Ana's Totals". */
  totalsTitle: (name: string) => string;
}

export function modeText(single: boolean): ModeText {
  return single
    ? {
        expenses: "Expenses",
        bills: "Bills",
        expensesShort: "Expenses",
        billsShort: "Bills",
        expenseKind: "Expense",
        totalsTitle: () => "Your Totals",
      }
    : {
        expenses: "Common Expenses",
        bills: "Common Bills",
        expensesShort: "Common Exp.",
        billsShort: "Common Bills",
        expenseKind: "Common",
        totalsTitle: (name) => `${name}'s Totals`,
      };
}
