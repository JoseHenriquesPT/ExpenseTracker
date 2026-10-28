import { useSyncExternalStore } from "react";

// Display-currency preference. Amounts are stored as plain numbers, so
// switching currency changes the symbol and formatting — it never converts
// values. The build default comes from VITE_CURRENCY (EUR when unset).

/** An ISO 4217 code that Intl can format. */
export type Currency = string;

/** Currency buttons always offered in Settings. */
export const CURRENCY_CHOICES = ["EUR", "PLN"] as const;

export const STORAGE_KEY = "expense-tracker.currency";

const FALLBACK: Currency = "EUR";

/** Uppercase a valid ISO 4217 code, or null when Intl rejects it. */
function normalize(value: string | null | undefined): Currency | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return code;
  } catch {
    return null;
  }
}

/** The currency a fresh device starts with. */
const BUILD_DEFAULT =
  normalize(import.meta.env.VITE_CURRENCY as string | undefined) ?? FALLBACK;

let cached: Currency | null = null;
const listeners = new Set<() => void>();

/** The currency saved on this device, if any. */
export function readStored(): Currency | null {
  try {
    return normalize(globalThis.localStorage?.getItem(STORAGE_KEY));
  } catch {
    return null; // storage disabled (private mode, blocked cookies, …)
  }
}

/** The currency in effect: the device choice, else the build default. */
export function currentCurrency(): Currency {
  if (cached === null) cached = readStored() ?? BUILD_DEFAULT;
  return cached;
}

export function setCurrency(currency: Currency): void {
  const next = normalize(currency);
  if (!next) return;
  cached = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // storage disabled — the currency still applies for this session
  }
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** EUR and PLN, plus the build/stored currency (e.g. USD) so it stays selectable. */
export function currencyChoices(): Currency[] {
  const choices: Currency[] = [...CURRENCY_CHOICES];
  for (const code of [BUILD_DEFAULT, currentCurrency()]) {
    if (!choices.includes(code)) choices.unshift(code);
  }
  return choices;
}

/** The active currency, re-rendering the caller when it changes. */
export function useCurrency(): Currency {
  return useSyncExternalStore(
    subscribe,
    currentCurrency,
    () => BUILD_DEFAULT // server/SSR fallback (unused here, but required)
  );
}
