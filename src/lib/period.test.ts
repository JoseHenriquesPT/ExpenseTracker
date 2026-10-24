import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPeriodStore,
  dateForPeriod,
  defaultPeriod,
  normalizePeriod,
  PERIOD_STORAGE_KEY,
  periodWindow,
  readStoredPeriod,
  writeStoredPeriod,
  type PeriodSelection,
} from "./period";

const NOW = new Date(2026, 9, 24); // 24 October 2026, local time

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("defaultPeriod", () => {
  it("starts on the current month, monthly", () => {
    expect(defaultPeriod(NOW)).toEqual({ mode: "monthly", month: 10, year: 2026 });
  });
});

describe("normalizePeriod", () => {
  it("keeps a valid stored selection", () => {
    expect(normalizePeriod({ mode: "annual", month: 2, year: 2024 }, NOW)).toEqual({
      mode: "annual",
      month: 2,
      year: 2024,
    });
  });

  it("falls back field by field for junk values", () => {
    expect(normalizePeriod({ mode: "weekly", month: 13, year: "2024" }, NOW)).toEqual(
      defaultPeriod(NOW)
    );
    expect(normalizePeriod({ mode: "all", month: 0, year: 0 }, NOW)).toEqual({
      mode: "all",
      month: 10,
      year: 2026,
    });
  });

  it("falls back completely for missing or non-object values", () => {
    expect(normalizePeriod(null, NOW)).toEqual(defaultPeriod(NOW));
    expect(normalizePeriod("monthly", NOW)).toEqual(defaultPeriod(NOW));
    expect(normalizePeriod(undefined, NOW)).toEqual(defaultPeriod(NOW));
  });
});

describe("periodWindow", () => {
  const base: PeriodSelection = { mode: "monthly", month: 2, year: 2024 };

  it("covers the whole selected month", () => {
    expect(periodWindow(base)).toEqual(["2024-02-01", "2024-02-29"]);
  });

  it("covers the whole selected year in annual mode", () => {
    expect(periodWindow({ ...base, mode: "annual" })).toEqual([
      "2024-01-01",
      "2024-12-31",
    ]);
  });

  it("means no window for all time", () => {
    expect(periodWindow({ ...base, mode: "all" })).toBeNull();
  });
});

describe("dateForPeriod", () => {
  it("uses the same day in the selected month", () => {
    expect(dateForPeriod({ mode: "monthly", month: 2, year: 2024 }, NOW)).toBe("2024-02-24");
  });

  it("clamps to the last day of a shorter month", () => {
    const endOfJanuary = new Date(2026, 0, 31);
    expect(dateForPeriod({ mode: "monthly", month: 2, year: 2026 }, endOfJanuary)).toBe(
      "2026-02-28"
    );
    expect(
      dateForPeriod({ mode: "monthly", month: 2, year: 2024 }, endOfJanuary)
    ).toBe("2024-02-29");
  });

  it("keeps the current month and day in annual mode", () => {
    expect(dateForPeriod({ mode: "annual", month: 1, year: 2024 }, NOW)).toBe("2024-10-24");
  });

  it("uses today for all time", () => {
    expect(dateForPeriod({ mode: "all", month: 1, year: 2024 }, NOW)).toBe("2026-10-24");
  });
});

describe("period storage", () => {
  it("reads a saved selection", () => {
    const storage = fakeStorage();
    storage.setItem(
      PERIOD_STORAGE_KEY,
      JSON.stringify({ mode: "annual", month: 5, year: 2025 })
    );
    vi.stubGlobal("localStorage", storage);

    expect(readStoredPeriod(NOW)).toEqual({ mode: "annual", month: 5, year: 2025 });
  });

  it("falls back when nothing or junk is saved", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    expect(readStoredPeriod(NOW)).toEqual(defaultPeriod(NOW));

    storage.setItem(PERIOD_STORAGE_KEY, "{not json");
    expect(readStoredPeriod(NOW)).toEqual(defaultPeriod(NOW));
  });

  it("writes a selection as JSON", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);

    writeStoredPeriod({ mode: "monthly", month: 8, year: 2027 });
    expect(JSON.parse(storage.getItem(PERIOD_STORAGE_KEY)!)).toEqual({
      mode: "monthly",
      month: 8,
      year: 2027,
    });
  });
});

describe("createPeriodStore", () => {
  it("shares changes and notifies only on real changes", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const store = createPeriodStore({ mode: "monthly", month: 10, year: 2026 });
    const seen: PeriodSelection[] = [];
    const unsubscribe = store.subscribe(() => seen.push(store.get()));

    store.set({ month: 2 });
    store.set({ month: 2 });
    store.set({ mode: "annual" });

    expect(seen).toEqual([
      { mode: "monthly", month: 2, year: 2026 },
      { mode: "annual", month: 2, year: 2026 },
    ]);
    expect(JSON.parse(storage.getItem(PERIOD_STORAGE_KEY)!)).toEqual({
      mode: "annual",
      month: 2,
      year: 2026,
    });

    unsubscribe();
    store.set({ year: 2025 });
    expect(seen).toHaveLength(2);
  });

  it("rejects invalid patches and keeps the previous selection", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const store = createPeriodStore({ mode: "monthly", month: 10, year: 2026 });

    store.set({ month: 13 });
    expect(store.get()).toEqual({ mode: "monthly", month: 10, year: 2026 });
  });
});
