// Domain types — mirror the original Template.xlsx sheets, extended for two people.
// Dates are stored as ISO "YYYY-MM-DD" strings so they sort lexicographically
// and compare cleanly against month/year windows.

export type Recurrency = "Weekly" | "Monthly" | "Yearly";
export type BillStatus = "Active" | "Stopped" | "Canceled";
export type InvestmentAction = "Invested" | "Withdraw";

/** The two people the tracker distinguishes between. */
export type Person = "P1" | "P2";
/** Whose responsibility a bill is: one person, or shared. */
export type BillScope = "P1" | "P2" | "Common";

/** Common fields for any dated money row. */
export interface Entry {
  id?: number;
  date: string; // ISO YYYY-MM-DD
  value: number;
  category: string;
  description?: string;
}

/** Common Expenses sheet — shared cost, but fronted out-of-pocket by one person. */
export interface ExpenseEntry extends Entry {
  paidBy: Person;
}

/** Income sheet — attributed to one person (fixes their fair-share %). */
export interface IncomeEntry extends Entry {
  person: Person;
}

/** Investments sheet — adds an Action (Invested / Withdraw). */
export interface Investment extends Entry {
  action: InvestmentAction;
}

/** Bills sheet — a recurring-bill *definition* (schedule, not a payment). */
export interface Bill {
  id?: number;
  startDate: string;
  recurrency: Recurrency;
  value: number;
  category: string;
  status: BillStatus;
  scope: BillScope;
  description?: string;
}

/** Bills Regist sheet — a *paid* bill instance (added manually).
 *  `scope` = whose responsibility; `paidBy` = who actually fronted it. */
export interface BillPayment {
  id?: number;
  date: string;
  value: number;
  category: string;
  scope: BillScope;
  paidBy: Person;
}

/** Data Config sheet — editable category & option master lists + person names. */
export interface Config {
  id?: number;
  key: string; // singleton row, key = "config"
  p1Name: string;
  p2Name: string;
  incomeCategories: string[];
  expenseCategories: string[];
  billCategories: string[];
  investmentCategories: string[];
  actions: InvestmentAction[];
  recurrencies: Recurrency[];
  statuses: BillStatus[];
}
