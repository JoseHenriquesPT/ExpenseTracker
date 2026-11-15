import { useSyncExternalStore } from "react";

// Display-currency preference. Amounts are stored as plain numbers, so
// switching currency changes the symbol and formatting — it never converts
// values. The preference is either a three-letter code formatted by Intl or a
// short custom symbol shown as typed. The build default comes from
// VITE_CURRENCY (EUR when unset).

/** An ISO 4217-style code, or a custom symbol such as "R$" or "Kč". */
export type Currency = string;

/** Currency buttons always offered in Settings. */
export const CURRENCY_CHOICES = ["EUR", "PLN"] as const;

export const STORAGE_KEY = "expense-tracker.currency";

/** Longest custom symbol accepted — enough for "US$", "Kč" or "CHF". */
export const CUSTOM_MAX_LENGTH = 6;

const FALLBACK: Currency = "EUR";

/** A well-formed three-letter code Intl can format (unknown codes print as-is). */
export function isCurrencyCode(value: string | null | undefined): boolean {
  if (!value) return false;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

/** True when the preference is a custom symbol rather than a currency code. */
export function isCustomCurrency(value: string): boolean {
  return !isCurrencyCode(value);
}

/** Uppercase a valid three-letter code, or null. */
function normalizeCode(value: string | null | undefined): Currency | null {
  if (!value || !isCurrencyCode(value)) return null;
  return value.trim().toUpperCase();
}

/** A short display symbol as typed, or null when empty/too long. */
function normalizeSymbol(value: string | null | undefined): Currency | null {
  if (!value) return null;
  const symbol = value.trim().replace(/\s+/g, " ");
  if (!symbol || symbol.length > CUSTOM_MAX_LENGTH) return null;
  return /[\u0000-\u001f\u007f]/.test(symbol) ? null : symbol;
}

/** Normalize a stored or typed preference: code, custom symbol, or null. */
export function normalizeCurrency(
  value: string | null | undefined
): Currency | null {
  return normalizeCode(value) ?? normalizeSymbol(value);
}

/** The currency a fresh device starts with. */
const BUILD_DEFAULT =
  normalizeCode(import.meta.env.VITE_CURRENCY as string | undefined) ?? FALLBACK;

let cached: Currency | null = null;
const listeners = new Set<() => void>();

/** The currency saved on this device, if any. */
export function readStored(): Currency | null {
  try {
    return normalizeCurrency(globalThis.localStorage?.getItem(STORAGE_KEY));
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
  const next = normalizeCurrency(currency);
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

/** EUR and PLN, plus the build/stored currency when it is a code (e.g. USD). */
export function currencyChoices(): Currency[] {
  const choices: Currency[] = [...CURRENCY_CHOICES];
  for (const code of [BUILD_DEFAULT, currentCurrency()]) {
    if (isCurrencyCode(code) && !choices.includes(code)) choices.unshift(code);
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
