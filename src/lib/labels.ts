import type { Person, Scope } from "../db/types";
import i18n from "../i18n";

const MONTH_KEYS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
] as const;

/** Month names in the current language (for <select> options). */
export const months = (): string[] =>
  MONTH_KEYS.map((key) => i18n.t(`labels.months.${key}`));

export const monthName = (month: number): string => {
  const key = MONTH_KEYS[month - 1];
  return key ? i18n.t(`labels.months.${key}`) : "";
};

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
  return scope === "Common" ? i18n.t("labels.common") : personName(scope, names);
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
  /** Income-split pie slice for the fair share of shared spending:
   *  "Expenses" | "Common". */
  splitCommon: string;
  /** Top-card label for a person's individual spending:
   *  "Individual Expenses" | "Ana's Individual". */
  individual: (name: string) => string;
}

export function modeText(single: boolean): ModeText {
  return single
    ? {
        expenses: i18n.t("labels.mode.single.expenses"),
        bills: i18n.t("labels.mode.single.bills"),
        expensesShort: i18n.t("labels.mode.single.expensesShort"),
        billsShort: i18n.t("labels.mode.single.billsShort"),
        expenseKind: i18n.t("labels.mode.single.expenseKind"),
        totalsTitle: () => i18n.t("labels.mode.single.totalsTitle"),
        splitCommon: i18n.t("labels.mode.single.splitCommon"),
        individual: () => i18n.t("labels.mode.single.individual"),
      }
    : {
        expenses: i18n.t("labels.mode.couple.expenses"),
        bills: i18n.t("labels.mode.couple.bills"),
        expensesShort: i18n.t("labels.mode.couple.expensesShort"),
        billsShort: i18n.t("labels.mode.couple.billsShort"),
        expenseKind: i18n.t("labels.mode.couple.expenseKind"),
        totalsTitle: (name) => i18n.t("labels.mode.couple.totalsTitle", { name }),
        splitCommon: i18n.t("labels.mode.couple.splitCommon"),
        individual: (name) => i18n.t("labels.mode.couple.individual", { name }),
      };
}
