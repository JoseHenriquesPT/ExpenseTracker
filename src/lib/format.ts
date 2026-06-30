// Display helpers. Currency is EUR to match the original tracker's context;
// change `CURRENCY` here if you use another.
const CURRENCY = "EUR";
const LOCALE = "pt-PT";

const money = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
});

export function fmtMoney(n: number): string {
  return money.format(n || 0);
}

export function fmtDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
