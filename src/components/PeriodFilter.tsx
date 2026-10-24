import { useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { DateWindow } from "../lib/finance";
import { months, yearOptions } from "../lib/labels";
import {
  periodStore,
  periodWindow,
  type PeriodMode,
} from "../lib/period";

// Month/year period filter, mirroring the Dashboard's toolbar. Every page that
// shows a period filter reads the same saved selection, so the month picked in
// one place follows the user across the app (and across reloads). "All time" is
// an extra option the Dashboard doesn't have, so a list can still show every
// entry.
export type { PeriodMode } from "../lib/period";

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
  const period = useSyncExternalStore(
    periodStore.subscribe,
    periodStore.get,
    periodStore.get
  );

  const window = useMemo(() => periodWindow(period), [period]);

  return {
    ...period,
    window,
    setMode: (mode) => periodStore.set({ mode }),
    setMonth: (month) => periodStore.set({ month }),
    setYear: (year) => periodStore.set({ year }),
  };
}

export default function PeriodFilter({ state }: { state: PeriodFilterState }) {
  const { t } = useTranslation();
  const { mode, month, year, setMode, setMonth, setYear } = state;
  const years = useMemo(() => {
    const options = yearOptions();
    return options.includes(year)
      ? options
      : [...options, year].sort((a, b) => a - b);
  }, [year]);

  return (
    <div className="toolbar">
      <select value={mode} onChange={(e) => setMode(e.target.value as PeriodMode)}>
        <option value="monthly">{t("common.monthly")}</option>
        <option value="annual">{t("common.annual")}</option>
        <option value="all">{t("common.allTime")}</option>
      </select>
      {mode === "monthly" && (
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {months().map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
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
