import { uiLocale } from "../i18n";
import { currentCurrency } from "./currency";

// Display helpers. The currency starts at VITE_CURRENCY (EUR when unset) and
// can be switched in Settings; the number locale follows the selected language.

const money = new Map<string, Intl.NumberFormat>();

function formatter(): Intl.NumberFormat {
  const locale = uiLocale();
  const currency = currentCurrency();
  const key = `${locale}:${currency}`;
  let cached = money.get(key);
  if (!cached) {
    cached = new Intl.NumberFormat(locale, { style: "currency", currency });
    money.set(key, cached);
  }
  return cached;
}

export function fmtMoney(n: number): string {
  return formatter().format(n || 0);
}

/** Plain locale number (units / unit price); money totals use fmtMoney. */
export function fmtNum(n: number): string {
  return n.toLocaleString(uiLocale(), { maximumFractionDigits: 6 });
}

/** Day-first date, identical in both supported locales. */
export function fmtDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
