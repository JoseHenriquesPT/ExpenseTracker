// Domain types — mirror the original Template.xlsx sheets, extended for two people.
// Dates are stored as ISO "YYYY-MM-DD" strings so they sort lexicographically
// and compare cleanly against month/year windows.

export type InvestmentAction = "Invested" | "Withdraw";

/** The two people the tracker distinguishes between. */
export type Person = "P1" | "P2";
/** Whose money an item is: one person's (individual), or shared (Common).
 *  Used by bills and investments to route them to the right Dashboard tab. */
export type Scope = "P1" | "P2" | "Common";
/** @deprecated Alias kept for existing bill code — use {@link Scope}. */
export type BillScope = Scope;

/** Common fields for any dated money row. */
export interface Entry {
  id?: number;
  date: string; // ISO YYYY-MM-DD
  value: number;
  category: string;
  description?: string;
}

/** Common Expenses sheet — shared cost, but fronted out-of-pocket by one person.
 *  `saved` marks money moved into investments instead of spent: it registers
 *  like an expense but is reported under the Savings category and is NOT part
 *  of the settlement pool. */
export interface ExpenseEntry extends Entry {
  paidBy: Person;
  saved?: boolean;
}

/** Income sheet — attributed to one person (fixes their fair-share %). */
export interface IncomeEntry extends Entry {
  person: Person;
}

/** Individual Expenses — personal spending attributed to one person.
 *  Unlike Common Expenses these are NOT split, so they never enter the
 *  settlement; they only reduce that person's "saved" on the Dashboard.
 *  `saved` marks money moved into investments instead of spent. */
export interface PersonalExpenseEntry extends Entry {
  person: Person;
  saved?: boolean;
}

/** Investments sheet. `category` holds the investment's NAME (e.g. a ticker or
 *  fund). Each transaction records an Action plus the trade's economics:
 *  `value` = money moved, `pricePoint` = price per unit, `units` = quantity.
 *  These satisfy value ≈ pricePoint × units; the form derives whichever one is
 *  left blank. Invested rows add units to the holding, Withdraw rows remove
 *  them. `scope` routes the row to the Both (Common) or a person's Dashboard tab.
 *  pricePoint/units are optional so legacy rows (value-only) still load. */
export interface Investment extends Entry {
  action: InvestmentAction;
  scope: Scope;
  pricePoint?: number;
  units?: number;
}

/** Bills — a paid bill. Registering one is assumed to mean it was paid, so a
 *  bill is just a dated money row plus who's responsible (`scope`) and who
 *  actually fronted it (`paidBy`). Common-scoped bills feed the settlement. */
export interface Bill extends Entry {
  scope: BillScope;
  paidBy: Person;
}

/** One link attached to a planned expense: where to find it, plus the text
 *  shown for it (a note, a store name, why it's shortlisted, …). */
export interface PlannedLink {
  text: string;
  url: string;
}

/** Planned Expenses — a wishlist of things to buy, kept as boxes. Each box has
 *  a name, optional free-text notes and a list of links; it starts unpurchased.
 *  Marking it purchased writes the final price into the shared or an individual
 *  expense ledger and stamps the purchase details here, so the box stays as a
 *  record. */
export interface PlannedExpense {
  id?: number;
  name: string;
  /** Free-text draft/notes about the item — hidden in the UI when empty. */
  notes?: string;
  links: PlannedLink[];
  purchased: boolean;
  /** ISO date the item was bought — set when purchased. */
  purchasedDate?: string;
  /** Price actually paid — set when purchased. */
  finalValue?: number;
  /** Where the expense landed: "Common" or a person — set when purchased. */
  scope?: Scope;
  /** Who fronted a Common purchase — set only when scope is "Common". */
  paidBy?: Person;
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
