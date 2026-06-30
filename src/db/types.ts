// Domain types — mirror the original Template.xlsx sheets, extended for two people.
// Dates are stored as ISO "YYYY-MM-DD" strings so they sort lexicographically
// and compare cleanly against month/year windows.

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

/** Individual Expenses — personal spending attributed to one person.
 *  Unlike Common Expenses these are NOT split, so they never enter the
 *  settlement; they only reduce that person's "saved" on the Dashboard. */
export interface PersonalExpenseEntry extends Entry {
  person: Person;
}

/** Investments sheet — adds an Action (Invested / Withdraw). */
export interface Investment extends Entry {
  action: InvestmentAction;
}

/** Bills — a paid bill. Registering one is assumed to mean it was paid, so a
 *  bill is just a dated money row plus who's responsible (`scope`) and who
 *  actually fronted it (`paidBy`). Common-scoped bills feed the settlement. */
export interface Bill extends Entry {
  scope: BillScope;
  paidBy: Person;
}

/** A recorded settlement transfer that balances a period's shared pool.
 *  Tied to the exact date window it settles, so the Dashboard can subtract it
 *  from that period's computed balance (and undo by deleting the row). */
export interface SettlementRecord {
  id?: number;
  date: string;        // ISO date the settlement was recorded
  periodStart: string; // ISO window start it settles (inclusive)
  periodEnd: string;   // ISO window end it settles (inclusive)
  from: Person;        // who paid
  to: Person;          // who received
  amount: number;
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
}
