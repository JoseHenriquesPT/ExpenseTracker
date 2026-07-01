import type {
  Entry, ExpenseEntry, IncomeEntry, Investment, Bill,
  SettlementRecord, Person,
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
  return categories.map((category) => {
    const value = rows
      .filter((r) => r.category === category && inWindow(r.date, start, end))
      .reduce((acc, r) => acc + r.value, 0);
    return { category, value };
  });
}

/** Net investments by category = Invested − Withdraw within window. */
export function netInvestmentByCategory(
  rows: Investment[],
  categories: string[],
  start: string,
  end: string
): CategoryTotal[] {
  return categories.map((category) => {
    const value = rows
      .filter((r) => r.category === category && inWindow(r.date, start, end))
      .reduce(
        (acc, r) => acc + (r.action === "Invested" ? r.value : -r.value),
        0
      );
    return { category, value };
  });
}

export interface OverviewData {
  income: CategoryTotal[];
  expenses: CategoryTotal[];
  personal: CategoryTotal[];
  bills: CategoryTotal[];
  investments: CategoryTotal[];
  totalIncome: number;
  totalExpenses: number;
  totalPersonal: number;
  totalBills: number;
  totalInvestments: number;
  totalSaved: number;
}

export interface OverviewInputs {
  income: Entry[];
  expenses: Entry[];
  /** Individual (personal) expenses — categorised with the expense list. */
  personalExpenses: Entry[];
  bills: Bill[];
  investments: Investment[];
  incomeCategories: string[];
  expenseCategories: string[];
  billCategories: string[];
  investmentCategories: string[];
}

const sum = (xs: CategoryTotal[]) => xs.reduce((a, x) => a + x.value, 0);

/** Build a full overview for a date window — used by both Monthly and Annual. */
export function buildOverview(
  inp: OverviewInputs,
  start: string,
  end: string
): OverviewData {
  const income = sumByCategory(inp.income, inp.incomeCategories, start, end);
  const expenses = sumByCategory(inp.expenses, inp.expenseCategories, start, end);
  const personal = sumByCategory(inp.personalExpenses, inp.expenseCategories, start, end);
  const bills = sumByCategory(inp.bills, inp.billCategories, start, end);
  const investments = netInvestmentByCategory(
    inp.investments,
    inp.investmentCategories,
    start,
    end
  );

  const totalIncome = sum(income);
  const totalExpenses = sum(expenses);
  const totalPersonal = sum(personal);
  const totalBills = sum(bills);
  const totalInvestments = sum(investments);

  return {
    income,
    expenses,
    personal,
    bills,
    investments,
    totalIncome,
    totalExpenses,
    totalPersonal,
    totalBills,
    totalInvestments,
    // Total Saved = Income − (Expenses + Individual + Bills + Investments)
    totalSaved:
      totalIncome - (totalExpenses + totalPersonal + totalBills + totalInvestments),
  };
}

// ---------------------------------------------------------------------------
// Investment holdings & realized profit (average-cost basis)
// ---------------------------------------------------------------------------

/** Units implied by a row: the stored quantity, else value / pricePoint, else
 *  null when neither is known (legacy value-only rows). */
export function investmentUnits(r: Investment): number | null {
  if (r.units != null) return r.units;
  if (r.pricePoint != null && r.pricePoint > 0) return r.value / r.pricePoint;
  return null;
}

export interface InvestmentHolding {
  name: string;
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
 * Walk every investment transaction in date order, per name, keeping a running
 * average-cost holding. A Withdraw books realized profit = proceeds − (units ×
 * average cost); Invested rows just grow the holding. This is order-sensitive,
 * so it always processes the full history (never a period slice).
 */
export function summarizeInvestments(rows: Investment[]): InvestmentSummary {
  const byName = new Map<string, Investment[]>();
  for (const r of rows) {
    const list = byName.get(r.category);
    if (list) list.push(r);
    else byName.set(r.category, [r]);
  }

  const profitByRow = new Map<number, number | null>();
  const holdings: InvestmentHolding[] = [];

  for (const [name, list] of byName) {
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
          const costOfSold = avg * Math.min(u, units);
          const profit = r.value - costOfSold;
          if (r.id != null) profitByRow.set(r.id, profit);
          realized += profit;
          units = Math.max(0, units - u);
          cost = units <= 1e-9 ? 0 : cost - costOfSold;
        } else if (r.id != null) {
          profitByRow.set(r.id, null);
        }
      }
    }
    if (units <= 1e-9) { units = 0; cost = 0; }
    holdings.push({
      name, units, costBasis: cost,
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

  // Out-of-pocket on shared items, per person.
  const expPaidP1 = sumBy(inp.expenses, (r) => r.paidBy === "P1");
  const expPaidP2 = sumBy(inp.expenses, (r) => r.paidBy === "P2");
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
