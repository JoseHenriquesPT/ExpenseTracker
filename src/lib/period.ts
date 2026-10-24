import {
  monthEnd,
  monthStart,
  toISO,
  yearEnd,
  yearStart,
  type DateWindow,
} from "./finance";

// The period picked in one page follows the user across the app: every page
// with a PeriodFilter reads the same selection and it survives a reload. Kept
// in localStorage (no household data) so it is a per-device viewing preference.

export type PeriodMode = "monthly" | "annual" | "all";

export interface PeriodSelection {
  mode: PeriodMode;
  month: number; // 1-12
  year: number;
}

export const PERIOD_STORAGE_KEY = "expense-tracker.period";

export function defaultPeriod(now = new Date()): PeriodSelection {
  return { mode: "monthly", month: now.getMonth() + 1, year: now.getFullYear() };
}

function isMode(value: unknown): value is PeriodMode {
  return value === "monthly" || value === "annual" || value === "all";
}

function isMonth(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12;
}

function isYear(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 9999;
}

/** Keep every valid field of a stored/patch selection, replacing the rest with
 *  `fallback` (current month by default). */
export function normalizePeriod(
  value: unknown,
  now = new Date(),
  fallback = defaultPeriod(now)
): PeriodSelection {
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Record<string, unknown>;
  return {
    mode: isMode(raw.mode) ? raw.mode : fallback.mode,
    month: isMonth(raw.month) ? raw.month : fallback.month,
    year: isYear(raw.year) ? raw.year : fallback.year,
  };
}

export function readStoredPeriod(now = new Date()): PeriodSelection {
  try {
    const raw = globalThis.localStorage?.getItem(PERIOD_STORAGE_KEY);
    return raw ? normalizePeriod(JSON.parse(raw), now) : defaultPeriod(now);
  } catch {
    return defaultPeriod(now);
  }
}

export function writeStoredPeriod(period: PeriodSelection): void {
  try {
    globalThis.localStorage?.setItem(PERIOD_STORAGE_KEY, JSON.stringify(period));
  } catch {
    // storage disabled — the selection still applies for this session
  }
}

/** The inclusive date window a selection resolves to; null means all time. */
export function periodWindow(period: PeriodSelection): DateWindow {
  if (period.mode === "all") return null;
  return period.mode === "monthly"
    ? [monthStart(period.year, period.month), monthEnd(period.year, period.month)]
    : [yearStart(period.year), yearEnd(period.year)];
}

/** A sensible date for a new entry in the selected period: the same day as
 *  today, moved into the selected month/year (clamped for shorter months). */
export function dateForPeriod(period: PeriodSelection, now = new Date()): string {
  if (period.mode === "all") return toISO(now);
  const month = period.mode === "monthly" ? period.month : now.getMonth() + 1;
  const lastDay = new Date(period.year, month, 0).getDate();
  const day = Math.min(now.getDate(), lastDay);
  return toISO(new Date(period.year, month - 1, day));
}

export interface PeriodStore {
  get: () => PeriodSelection;
  set: (patch: Partial<PeriodSelection>) => void;
  subscribe: (listener: () => void) => () => void;
}

/** Tiny shared store; `get` is stable between changes so it can back
 *  useSyncExternalStore. Writes persist to localStorage. */
export function createPeriodStore(initial?: PeriodSelection): PeriodStore {
  let current = initial ?? readStoredPeriod();
  const listeners = new Set<() => void>();

  return {
    get: () => current,
    set: (patch) => {
      const next = normalizePeriod({ ...current, ...patch }, new Date(), current);
      if (
        next.mode === current.mode &&
        next.month === current.month &&
        next.year === current.year
      ) {
        return;
      }
      current = next;
      writeStoredPeriod(current);
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const periodStore = createPeriodStore();
