import { monthEnd, toISO } from "./finance";

/** How many months of occurrences a recurring series keeps materialized ahead
 *  of today. The app tops every active series up to this horizon on launch, so
 *  a household that has been away for a while finds the gap filled next time. */
export const RECURRING_HORIZON_MONTHS = 24;

/** Add whole months to an ISO date. The day of month is kept when the target
 *  month has it, and clamped to the month's last day otherwise — so a bill on
 *  the 31st falls on the 28th (or 29th) in February and returns to the 31st in
 *  March. Anchor-based (always from the series start date), so a clamped
 *  February occurrence never drags the rest of the series to the 28th. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const first = new Date(y, m - 1 + months, 1);
  const ty = first.getFullYear();
  const tm = first.getMonth();
  const lastDay = new Date(ty, tm + 1, 0).getDate();
  return toISO(new Date(ty, tm, Math.min(d, lastDay)));
}

/** Add whole days to an ISO date (used to step a day before a series starts). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toISO(new Date(y, m - 1, d + days));
}

/** Monthly occurrences in (after, through], starting at `startDate`. Pass an
 *  empty `after` to include the start date itself. Returns [] when the series
 *  starts after the cutoff. */
export function occurrencesBetween(
  startDate: string,
  after: string | undefined,
  through: string
): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12000; i++) {
    const occurrence = addMonths(startDate, i);
    if (occurrence > through) break;
    if (!after || occurrence > after) out.push(occurrence);
  }
  return out;
}

/** The latest occurrence on or before `through`, or null when the series has
 *  not started yet. Used to end a series just before the month being removed. */
export function occurrenceOnOrBefore(
  startDate: string,
  through: string
): string | null {
  let latest: string | null = null;
  for (let i = 0; i < 12000; i++) {
    const occurrence = addMonths(startDate, i);
    if (occurrence > through) break;
    latest = occurrence;
  }
  return latest;
}

/** Last day of the month N months after `today`'s month. */
export function recurringHorizon(
  today: string,
  months = RECURRING_HORIZON_MONTHS
): string {
  const [y, m] = today.split("-").map(Number);
  const target = new Date(y, m - 1 + months, 1);
  return monthEnd(target.getFullYear(), target.getMonth() + 1);
}

/** Where generation should stop: the rolling horizon, or the series' own first
 *  occurrence when that is further ahead (a future-dated series still gets its
 *  first row immediately). */
export function generationThrough(
  startDate: string,
  today: string,
  months = RECURRING_HORIZON_MONTHS
): string {
  const horizon = recurringHorizon(today, months);
  return startDate > horizon ? startDate : horizon;
}
