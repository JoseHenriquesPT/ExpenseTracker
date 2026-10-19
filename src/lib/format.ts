import { uiLocale } from "../i18n";

// Display helpers. Set VITE_CURRENCY to an ISO 4217 code to change the display
// currency; the fallback is EUR. The number locale follows the selected language.
function currencyCode(): string {
  const configured = (import.meta.env.VITE_CURRENCY as string | undefined)?.trim().toUpperCase();
  if (!configured) return "EUR";
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: configured });
    return configured;
  } catch {
    return "EUR";
  }
}

const CURRENCY = currencyCode();

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
