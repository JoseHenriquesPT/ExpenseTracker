import { uiLocale } from "../i18n";

// Display helpers. Currency is EUR to match the original tracker's context;
// change `CURRENCY` here if you use another. The number locale follows the
// selected language (en-GB / pt-PT).
const CURRENCY = "EUR";

const money = new Map<string, Intl.NumberFormat>();

function formatter(): Intl.NumberFormat {
  const locale = uiLocale();
  let cached = money.get(locale);
  if (!cached) {
    cached = new Intl.NumberFormat(locale, { style: "currency", currency: CURRENCY });
    money.set(locale, cached);
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
