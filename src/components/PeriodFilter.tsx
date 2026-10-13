import { useMemo, useState } from "react";
import { monthStart, monthEnd, yearStart, yearEnd } from "../lib/finance";
import type { DateWindow } from "../lib/finance";
import { MONTHS, yearOptions } from "../lib/labels";

// Month/year period filter, mirroring the Dashboard's toolbar. Shared by the
// ledger tabs so their registered-entry lists filter the same way the
// Dashboard does. "All time" is an extra option the Dashboard doesn't have,
// so a list can still show every entry.
export type PeriodMode = "monthly" | "annual" | "all";

export interface PeriodFilterState {
  mode: PeriodMode;
  month: number; // 1-12
  year: number;
  /** [start, end] ISO window (inclusive), or null for "all time". */
  window: DateWindow;
  setMode: (m: PeriodMode) => void;
  setMonth: (m: number) => void;
  setYear: (y: number) => void;
}

/** Filter state + the ISO window it resolves to. Defaults to the current month. */
export function usePeriodFilter(): PeriodFilterState {
  const now = new Date();
  const [mode, setMode] = useState<PeriodMode>("monthly");
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const window = useMemo<DateWindow>(() => {
    if (mode === "all") return null;
    return mode === "monthly"
      ? [monthStart(year, month), monthEnd(year, month)]
      : [yearStart(year), yearEnd(year)];
  }, [mode, month, year]);

  return { mode, month, year, window, setMode, setMonth, setYear };
}

export default function PeriodFilter({ state }: { state: PeriodFilterState }) {
  const { mode, month, year, setMode, setMonth, setYear } = state;
  const years = useMemo(() => yearOptions(), []);

  return (
    <div className="toolbar">
      <select value={mode} onChange={(e) => setMode(e.target.value as PeriodMode)}>
        <option value="monthly">Monthly</option>
        <option value="annual">Annual</option>
        <option value="all">All time</option>
      </select>
      {mode === "monthly" && (
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      )}
      {mode !== "all" && (
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      )}
    </div>
  );
}
