import type {
  Entry, ExpenseEntry, IncomeEntry, Investment, BillPayment,
  SettlementRecord, Recurrency, Person,
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

export function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
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
// Next due date — port of the Bills!D LET/IFS formula (analysis §4)
// ---------------------------------------------------------------------------

/** Add `n` whole months to a date, clamping the day to the month's length
 *  (mirrors Excel EDATE semantics). */
function addMonths(date: Date, n: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth() + n, 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(date.getDate(), lastDay));
  return d;
}

/** Add `n` whole calendar days, DST-safe (new Date normalizes the day field). */
function addDays(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

/** Whole calendar-day difference b − a, DST-safe (compares UTC of y/m/d only). */
function daysBetween(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / 86_400_000);
}

/**
 * Next occurrence >= today for a recurring bill.
 * Returns ISO date string, or "" if inputs are incomplete.
 *
 * Note: improves on the original spreadsheet, which for a *future* start date
 * could return a Monthly/Yearly due date earlier than the start. Here the first
 * occurrence of a not-yet-started bill is simply its start date.
 */
export function nextDueDate(
  startISO: string,
  recurrency: Recurrency,
  today: Date = new Date()
): string {
  if (!startISO || !recurrency) return "";
  const start = parseISO(startISO);
  const hoje = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // A bill that hasn't started yet: first occurrence is the start date itself.
  if (start > hoje) return toISO(start);

  if (recurrency === "Weekly") {
    const weeks = Math.ceil(Math.max(0, daysBetween(start, hoje)) / 7);
    let prox = addDays(start, weeks * 7);
    if (prox < hoje) prox = addDays(prox, 7);
    return toISO(prox);
  }

  if (recurrency === "Monthly") {
    const months =
      (hoje.getFullYear() - start.getFullYear()) * 12 +
      (hoje.getMonth() - start.getMonth());
    let prox = addMonths(start, months);
    if (prox < hoje) prox = addMonths(start, months + 1);
    return toISO(prox);
  }

  // Yearly
  const years = hoje.getFullYear() - start.getFullYear();
  let prox = addMonths(start, years * 12);
  if (prox < hoje) prox = addMonths(prox, 12);
  return toISO(prox);
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
  billPayments: BillPayment[];
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
  const bills = sumByCategory(inp.billPayments, inp.billCategories, start, end);
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
  billPayments: BillPayment[];
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
  const billPaidP1 = sumBy(inp.billPayments, (r) => r.scope === "Common" && r.paidBy === "P1");
  const billPaidP2 = sumBy(inp.billPayments, (r) => r.scope === "Common" && r.paidBy === "P2");

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
