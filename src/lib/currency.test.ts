import { afterEach, describe, expect, it, vi } from "vitest";

const CURRENCY_KEY = "expense-tracker.currency";

/** In-memory localStorage so preference tests don't touch the real one. */
function stubStorage(entries: Record<string, string> = {}): Map<string, string> {
  const store = new Map(Object.entries(entries));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
  return store;
}

/** Fresh modules per test: the currency is cached at module level. */
async function load() {
  const currency = await import("./currency");
  const { fmtMoney } = await import("./format");
  return { currency, fmtMoney };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("currency preference", () => {
  it("defaults to EUR", async () => {
    stubStorage();
    const { currency, fmtMoney } = await load();

    expect(currency.currentCurrency()).toBe("EUR");
    expect(fmtMoney(10)).toMatch(/€10\.00/);
  });

  it("uses VITE_CURRENCY as the initial default", async () => {
    vi.stubEnv("VITE_CURRENCY", "PLN");
    stubStorage();
    const { currency, fmtMoney } = await load();

    expect(currency.currentCurrency()).toBe("PLN");
    expect(fmtMoney(10)).toContain("PLN");
    expect(fmtMoney(10)).not.toContain("€");
  });

  it("lets a stored choice override the build default", async () => {
    vi.stubEnv("VITE_CURRENCY", "PLN");
    stubStorage({ [CURRENCY_KEY]: "EUR" });
    const { currency } = await load();

    expect(currency.currentCurrency()).toBe("EUR");
  });

  it("switches, persists and notifies subscribers", async () => {
    const store = stubStorage();
    const { currency, fmtMoney } = await load();
    const listener = vi.fn();
    const unsubscribe = currency.subscribe(listener);

    currency.setCurrency("PLN");

    expect(currency.currentCurrency()).toBe("PLN");
    expect(store.get(CURRENCY_KEY)).toBe("PLN");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fmtMoney(10)).toContain("PLN");

    currency.setCurrency("EUR");

    expect(currency.currentCurrency()).toBe("EUR");
    expect(store.get(CURRENCY_KEY)).toBe("EUR");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(fmtMoney(10)).toMatch(/€10\.00/);

    unsubscribe();
    currency.setCurrency("PLN");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("ignores unsupported stored values and invalid choices", async () => {
    stubStorage({ [CURRENCY_KEY]: "not-a-currency" });
    const { currency } = await load();

    expect(currency.currentCurrency()).toBe("EUR");

    currency.setCurrency("not-a-currency");
    expect(currency.currentCurrency()).toBe("EUR");
  });

  it("offers EUR and PLN, keeping a build-default currency selectable", async () => {
    vi.stubEnv("VITE_CURRENCY", "USD");
    stubStorage();
    const { currency } = await load();

    expect(currency.currencyChoices()).toEqual(["USD", "EUR", "PLN"]);
  });
});
