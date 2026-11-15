import { uiLocale } from "../i18n";
import { currentCurrency, isCurrencyCode } from "./currency";

// Display helpers. The currency starts at VITE_CURRENCY (EUR when unset) and
// can be switched in Settings — either to an ISO code or to a custom symbol;
// the number locale follows the selected language.

/** Just enough of Intl.NumberFormat for fmtMoney (codes and custom symbols). */
interface MoneyFormatter {
  format(value: number): string;
}

const money = new Map<string, MoneyFormatter>();

/** Format with the user's symbol in the locale's usual currency slot. */
function customFormatter(locale: string, symbol: string): MoneyFormatter {
  const base = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  return {
    format(value: number): string {
      return base
        .formatToParts(value)
        .map((part) => (part.type === "currency" ? symbol : part.value))
        .join("");
    },
  };
}

function formatter(): MoneyFormatter {
  const locale = uiLocale();
  const currency = currentCurrency();
  const key = `${locale}:${currency}`;
  let cached = money.get(key);
  if (!cached) {
    cached = isCurrencyCode(currency)
      ? new Intl.NumberFormat(locale, { style: "currency", currency })
      : customFormatter(locale, currency);
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
