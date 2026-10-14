import type {
  Entry, ExpenseEntry, IncomeEntry, Investment, Bill,
  PersonalExpenseEntry, SettlementRecord, Person, Scope,
} from "../db/types";

// ---------------------------------------------------------------------------
// Date helpers (work on ISO "YYYY-MM-DD" strings, local-time safe)
// ---------------------------------------------------------------------------

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** First day of a given year/month (month is 1-12). */
export function monthStart(year: number, month: number): string {
  return toISO(new Date(year, month - 1, 1));
}

/** Last day of a given year/month — equivalent to Excel EOMONTH(start, 0). */
export function monthEnd(year: number, month: number): string {
  return toISO(new Date(year, month, 0));
}

export function yearStart(year: number): string {
  return toISO(new Date(year, 0, 1));
}
export function yearEnd(year: number): string {
  return toISO(new Date(year, 11, 31));
}

/** Inclusive [start, end] ISO window; null means "no window" (keep all rows). */
export type DateWindow = [string, string] | null;

/** Keep rows whose date falls inside the window (boundaries inclusive).
 *  A null window keeps every row — the period filter's "All time". */
export function filterByWindow<T extends { date: string }>(
  rows: T[],
  window: DateWindow
): T[] {
  if (!window) return rows;
  const [start, end] = window;
  return rows.filter((r) => inWindow(r.date, start, end));
}

// ---------------------------------------------------------------------------
// Aggregation — port of the Overview SUMIFS grids (analysis §5)
// ---------------------------------------------------------------------------

export interface CategoryTotal {
  category: string;
  value: number;
}

function inWindow(dateISO: string, start: string, end: string): boolean {
  return dateISO >= start && dateISO <= end;
}

/** Sum entries by category within [start, end]. Categories with 0 are kept
 *  only if `keepZero` (the overview hides zeros; charts drop them). */
export function sumByCategory(
  rows: Entry[],
  categories: string[],
  start: string,
  end: string
): CategoryTotal[] {
  const out = categories.map((category) => {
    const value = rows
      .filter((r) => r.category === category && inWindow(r.date, start, end))
      .reduce((acc, r) => acc + r.value, 0);
    return { category, value };
  });

  // Rows whose category was removed from Settings still count: otherwise their
  // money would silently disappear from the Dashboard while staying visible in
  // the ledger. Leftovers are grouped by name, alphabetical for a stable order.
  const known = new Set(categories);
  const extra = new Map<string, number>();
  for (const r of rows) {
    if (known.has(r.category) || !inWindow(r.date, start, end)) continue;
    extra.set(r.category, (extra.get(r.category) ?? 0) + r.value);
  }
  for (const category of [...extra.keys()].sort()) {
    out.push({ category, value: extra.get(category)! });
  }
  return out;
}

/** Net investments by category = Invested − Withdraw within window. */
export function netInvestmentByCategory(
  rows: Investment[],
  categories: string[],
  start: string,
  end: string
): CategoryTotal[] {
  const out = categories.map((category) => {
    const value = rows
      .filter((r) => r.category === category && inWindow(r.date, start, end))
      .reduce(
        (acc, r) => acc + (r.action === "Invested" ? r.value : -r.value),
        0
      );
    return { category, value };
  });

  const known = new Set(categories);
  const extra = new Map<string, number>();
  for (const r of rows) {
    if (known.has(r.category) || !inWindow(r.date, start, end)) continue;
    const signed = r.action === "Invested" ? r.value : -r.value;
    extra.set(r.category, (extra.get(r.category) ?? 0) + signed);
  }
  for (const category of [...extra.keys()].sort()) {
    out.push({ category, value: extra.get(category)! });
  }
  return out;
}

export interface OverviewData {
  income: CategoryTotal[];
  /** Spending only — saved-into-investments rows are excluded. */
  expenses: CategoryTotal[];
  /** Individual spending only — saved rows are excluded. */
  personal: CategoryTotal[];
  bills: CategoryTotal[];
  /** Money moved into investments, always under the Savings category. */
  savings: CategoryTotal[];
  totalIncome: number;
  totalExpenses: number;
  totalPersonal: number;
  totalBills: number;
  totalSavings: number;
  totalSaved: number;
}

export interface OverviewInputs {
  income: Entry[];
  expenses: ExpenseEntry[];
  /** Individual (personal) expenses — categorised with the expense list. */
  personalExpenses: PersonalExpenseEntry[];
  bills: Bill[];
  incomeCategories: string[];
  expenseCategories: string[];
  billCategories: string[];
}

const sum = (xs: CategoryTotal[]) => xs.reduce((a, x) => a + x.value, 0);

/** Money moved into investments is registered as an expense but reported as
 *  its own Savings category, so it never looks like spending. */
export const SAVINGS_CATEGORY = "Savings";

/** Build a full overview for a date window — used by both Monthly and Annual. */
export function buildOverview(
  inp: OverviewInputs,
  start: string,
  end: string
): OverviewData {
  const income = sumByCategory(inp.income, inp.incomeCategories, start, end);
  const expenses = sumByCategory(
    inp.expenses.filter((r) => !r.saved),
    inp.expenseCategories,
    start,
    end
  );
  const personal = sumByCategory(
    inp.personalExpenses.filter((r) => !r.saved),
    inp.expenseCategories,
    start,
    end
  );
  const bills = sumByCategory(inp.bills, inp.billCategories, start, end);
  const savings = sumByCategory(
    [
      ...inp.expenses.filter((r) => r.saved),
      ...inp.personalExpenses.filter((r) => r.saved),
    ],
    [SAVINGS_CATEGORY],
    start,
    end
  );

  const totalIncome = sum(income);
  const totalExpenses = sum(expenses);
  const totalPersonal = sum(personal);
  const totalBills = sum(bills);
  const totalSavings = sum(savings);

  return {
    income,
    expenses,
    personal,
    bills,
    savings,
    totalIncome,
    totalExpenses,
    totalPersonal,
    totalBills,
    totalSavings,
    // Total Saved = Income − (Expenses + Individual + Bills + Investments)
    totalSaved:
      totalIncome - (totalExpenses + totalPersonal + totalBills + totalSavings),
  };
}

// ---------------------------------------------------------------------------
// Investment holdings & realized profit (average-cost basis)
// ---------------------------------------------------------------------------

/** Units implied by a row: the stored quantity when it's positive, else
 *  value / pricePoint, else null when neither is known (legacy value-only
 *  rows). Zero/negative stored units are treated as unknown data, never as a
 *  real quantity — otherwise a withdrawal can book all proceeds as profit or
 *  even grow the holding. */
export function investmentUnits(r: Investment): number | null {
  if (r.units != null && r.units > 0) return r.units;
  if (r.pricePoint != null && r.pricePoint > 0) return r.value / r.pricePoint;
  return null;
}

export interface InvestmentHolding {
  name: string;
  /** Whose position this is; equal names in different scopes stay separate. */
  scope: Scope;
  units: number;      // quantity still held
  costBasis: number;  // cost of the units still held
  avgCost: number;    // costBasis / units (0 when nothing held)
  invested: number;   // gross money put in (sum of Invested values)
  withdrawn: number;  // gross money taken out (sum of Withdraw values)
  realized: number;   // realized profit booked on withdrawals so far
}

export interface InvestmentSummary {
  /** Realized profit per Withdraw row id; null when it can't be computed
   *  (no unit data, or nothing was held to sell against). */
  profitByRow: Map<number, number | null>;
  holdings: InvestmentHolding[];
}

/**
 * Walk every investment transaction in date order, per (scope, name), keeping a
 * running average-cost holding. A Withdraw books realized profit = the proceeds
 * for the units actually sold − (units × average cost); Invested rows just grow
 * the holding. This is order-sensitive, so it always processes the full history
 * (never a period slice).
 */
export function summarizeInvestments(rows: Investment[]): InvestmentSummary {
  // A position is (scope, name): the same name held by P1, P2 or both must not
  // be pooled, or one person's sale would move the other's average cost.
  const positions = new Map<string, { scope: Scope; name: string; rows: Investment[] }>();
  for (const r of rows) {
    const key = `${r.scope}\u0000${r.category}`;
    const position = positions.get(key);
    if (position) position.rows.push(r);
    else positions.set(key, { scope: r.scope, name: r.category, rows: [r] });
  }

  const profitByRow = new Map<number, number | null>();
  const holdings: InvestmentHolding[] = [];

  for (const { scope, name, rows: list } of positions.values()) {
    const sorted = [...list].sort((a, b) =>
      a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.id ?? 0) - (b.id ?? 0)
    );

    let units = 0, cost = 0, invested = 0, withdrawn = 0, realized = 0;
    for (const r of sorted) {
      const u = investmentUnits(r);
      if (r.action === "Invested") {
        invested += r.value;
        if (u != null) { units += u; cost += r.value; }
      } else {
        withdrawn += r.value;
        const avg = units > 0 ? cost / units : 0;
        if (u != null && units > 0) {
          // Never sell more than is held, and only count the proceeds for the
          // units actually sold. Otherwise an over-withdrawal turns units that
          // were never bought into profit.
          const sold = Math.min(u, units);
          const proceeds = r.value * (sold / u);
          const costOfSold = avg * sold;
          const profit = proceeds - costOfSold;
          if (r.id != null) profitByRow.set(r.id, profit);
          realized += profit;
          units -= sold;
          cost = units <= 1e-9 ? 0 : cost - costOfSold;
        } else if (r.id != null) {
          profitByRow.set(r.id, null);
        }
      }
    }
    if (units <= 1e-9) { units = 0; cost = 0; }
    holdings.push({
      name, scope, units, costBasis: cost,
      avgCost: units > 0 ? cost / units : 0,
      invested, withdrawn, realized,
    });
  }

  return { profitByRow, holdings };
}

// ---------------------------------------------------------------------------
// Two-person settlement (income-proportional fair share)
// ---------------------------------------------------------------------------

export interface Settlement {
  incomeP1: number;
  incomeP2: number;
  totalIncome: number;
  /** Fair-share fraction in [0,1]; 50/50 fallback when total income is 0. */
  shareP1: number;
  shareP2: number;
  usedFallbackShare: boolean;
  /** Shared pool = common expenses + Common-scoped bill payments. */
  pool: number;
  paidP1: number;
  paidP2: number;
  fairP1: number;
  fairP2: number;
  /** paidP1 − fairP1; >0 means P1 overpaid and is owed. (P2's is the mirror.)
   *  This is the raw spending imbalance, *before* recorded settlements. */
  balanceP1: number;
  /** Net amount P1 has already received via recorded settlements this period
   *  (transfers to P1 − transfers from P1). */
  settledNetP1: number;
  /** Who still needs to pay whom, and how much, *after* recorded settlements.
   *  null/0 when nothing is left to transfer. */
  from: Person | null;
  to: Person | null;
  amount: number;
}

export interface SettlementInputs {
  income: IncomeEntry[];
  expenses: ExpenseEntry[];
  bills: Bill[];
  /** Already-recorded settlement transfers (all periods; filtered to the
   *  window by exact [periodStart, periodEnd] match). */
  settlements?: SettlementRecord[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Settle the shared pool for a date window.
 *
 * Each person's income fixes their fair-share %; their fair share is
 * share% × pool. The pool is everything shared (common expenses + bills tagged
 * "Common"). Whoever paid more than their fair share is owed the difference;
 * the other transfers exactly that amount — a single transfer always settles it.
 */
export function computeSettlement(
  inp: SettlementInputs,
  start: string,
  end: string
): Settlement {
  const win = (d: string) => inWindow(d, start, end);
  const sumBy = <T extends Entry>(rows: T[], pred: (r: T) => boolean) =>
    rows.filter((r) => win(r.date) && pred(r)).reduce((a, r) => a + r.value, 0);

  const incomeP1 = sumBy(inp.income, (r) => r.person === "P1");
  const incomeP2 = sumBy(inp.income, (r) => r.person === "P2");
  const totalIncome = incomeP1 + incomeP2;

  // Out-of-pocket on shared items, per person. Saved-into-investments rows are
  // deliberately excluded: they're a transfer, not household spending.
  const expPaidP1 = sumBy(inp.expenses, (r) => !r.saved && r.paidBy === "P1");
  const expPaidP2 = sumBy(inp.expenses, (r) => !r.saved && r.paidBy === "P2");
  const billPaidP1 = sumBy(inp.bills, (r) => r.scope === "Common" && r.paidBy === "P1");
  const billPaidP2 = sumBy(inp.bills, (r) => r.scope === "Common" && r.paidBy === "P2");

  const paidP1 = expPaidP1 + billPaidP1;
  const paidP2 = expPaidP2 + billPaidP2;
  const pool = paidP1 + paidP2;

  const usedFallbackShare = totalIncome <= 0;
  const shareP1 = usedFallbackShare ? 0.5 : incomeP1 / totalIncome;
  const shareP2 = 1 - shareP1;

  const fairP1 = shareP1 * pool;
  const fairP2 = shareP2 * pool;
  const balanceP1 = paidP1 - fairP1;

  // Subtract transfers already recorded for *this exact* window. A transfer to
  // P1 reduces what P1 is still owed; a transfer from P1 increases it.
  const settledNetP1 = (inp.settlements ?? [])
    .filter((r) => r.periodStart === start && r.periodEnd === end)
    .reduce(
      (a, r) => a + (r.to === "P1" ? r.amount : 0) - (r.from === "P1" ? r.amount : 0),
      0
    );

  let from: Person | null = null;
  let to: Person | null = null;
  let amount = 0;
  const remaining = round2(balanceP1 - settledNetP1);
  if (remaining > 0) {
    from = "P2"; to = "P1"; amount = remaining; // P1 still owed -> P2 reimburses P1
  } else if (remaining < 0) {
    from = "P1"; to = "P2"; amount = -remaining;
  }

  return {
    incomeP1, incomeP2, totalIncome,
    shareP1, shareP2, usedFallbackShare,
    pool,
    paidP1, paidP2,
    fairP1: round2(fairP1), fairP2: round2(fairP2),
    balanceP1: round2(balanceP1),
    settledNetP1: round2(settledNetP1),
    from, to, amount,
  };
}

// ---------------------------------------------------------------------------
// Per-person income split (the two Dashboard pies)
// ---------------------------------------------------------------------------

export interface IncomeSplit {
  /** The person's own income for the window. */
  income: number;
  /** Their fair share of the shared spending: income % of common expenses
   *  and Common-scoped bills. Excludes anything individual. */
  expenses: number;
  /** Their own individual spending: personal expenses plus bills scoped to
   *  them — never split, so it stays separate from {@link expenses}. */
  individual: number;
  /** Money moved into investments: their own savings plus their income % of
   *  the household's common savings. */
  invested: number;
  /** income − expenses − individual − invested; negative means they overspent. */
  saved: number;
}

export interface IncomeSplitInputs {
  income: IncomeEntry[];
  expenses: ExpenseEntry[];
  personalExpenses: PersonalExpenseEntry[];
  bills: Bill[];
}

/**
 * Split each person's income into what they consumed (their fair share of the
 * shared spending, kept separate from their own individual spending), what
 * they put into investments, and what's left as savings.
 * Common spending uses the same income-proportional share as the settlement
 * (50/50 fallback with no income), so the two views agree.
 */
export function buildIncomeSplits(
  inp: IncomeSplitInputs,
  start: string,
  end: string
): { p1: IncomeSplit; p2: IncomeSplit } {
  const win = (d: string) => inWindow(d, start, end);
  const total = <T extends Entry>(rows: T[], pred: (r: T) => boolean) =>
    rows.filter((r) => win(r.date) && pred(r)).reduce((a, r) => a + r.value, 0);

  const incomeP1 = total(inp.income, (r) => r.person === "P1");
  const incomeP2 = total(inp.income, (r) => r.person === "P2");
  const totalIncome = incomeP1 + incomeP2;
  const shareP1 = totalIncome > 0 ? incomeP1 / totalIncome : 0.5;
  const shareP2 = 1 - shareP1;

  const commonExpenses = total(inp.expenses, (r) => !r.saved);
  const commonSavings = total(inp.expenses, (r) => !!r.saved);
  const commonBills = total(inp.bills, (r) => r.scope === "Common");

  const splitFor = (person: Person, share: number): IncomeSplit => {
    const income = person === "P1" ? incomeP1 : incomeP2;
    const personalExpenses = total(
      inp.personalExpenses,
      (r) => r.person === person && !r.saved
    );
    const personalSavings = total(
      inp.personalExpenses,
      (r) => r.person === person && !!r.saved
    );
    const personalBills = total(inp.bills, (r) => r.scope === person);
    const expenses = (commonExpenses + commonBills) * share;
    const individual = personalExpenses + personalBills;
    const invested = commonSavings * share + personalSavings;
    return {
      income,
      expenses,
      individual,
      invested,
      saved: income - expenses - individual - invested,
    };
  };

  return { p1: splitFor("P1", shareP1), p2: splitFor("P2", shareP2) };
}
