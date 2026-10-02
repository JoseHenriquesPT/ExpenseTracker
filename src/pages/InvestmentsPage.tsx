import { useMemo, useState } from "react";
import { useLiveQuery } from "../db/live";
import { db } from "../db/db";
import type { InvestmentAction, Investment, Scope } from "../db/types";
import { toISO, summarizeInvestments, investmentUnits } from "../lib/finance";
import { fmtMoney, fmtDate } from "../lib/format";
import { scopeName } from "../lib/labels";
import { useOnline } from "../lib/useOnline";
import { confirm } from "../lib/confirm";
import { useBusy } from "../lib/useBusy";
import PeriodFilter, { usePeriodFilter } from "../components/PeriodFilter";
import BackHome from "../components/BackHome";

const SCOPES: Scope[] = ["Common", "P1", "P2"];
type TradeField = "value" | "price" | "units";

// Trim a computed number to a stable short string (avoids float noise / loops).
const short = (n: number) => (isFinite(n) ? String(Math.round(n * 1e6) / 1e6) : "");
// Plain locale number for units / unit price (money totals use fmtMoney).
const num = (n: number) => n.toLocaleString("pt-PT", { maximumFractionDigits: 6 });

export default function InvestmentsPage() {
  const online = useOnline();
  const { busy, run } = useBusy();
  const config = useLiveQuery(() => db.config.get({ key: "config" }), []);
  const rows = useLiveQuery(
    () => db.investments.orderBy("date").reverse().toArray(),
    []
  );

  const names = config?.investmentCategories ?? [];
  const personNames = { p1: config?.p1Name ?? "P1", p2: config?.p2Name ?? "P2" };
  const scopeLabel = (s: Scope) => scopeName(s, personNames);

  const [date, setDate] = useState(toISO(new Date()));
  const [action, setAction] = useState<InvestmentAction>("Invested");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>("Common");
  const [value, setValue] = useState("");
  const [price, setPrice] = useState("");
  const [units, setUnits] = useState("");
  const [description, setDescription] = useState("");
  // The two trade fields the user last touched drive the third (derived) one.
  const [drivers, setDrivers] = useState<TradeField[]>(["units", "price"]);

  // Edit one of value/price/units; recompute whichever field the user hasn't
  // touched most recently, from value = price × units.
  function editTrade(field: TradeField, raw: string) {
    const next: Record<TradeField, string> = { value, price, units, [field]: raw };
    const nextDrivers = [field, ...drivers.filter((f) => f !== field)].slice(
      0,
      2
    ) as TradeField[];
    const derived = (["value", "price", "units"] as TradeField[]).find(
      (f) => !nextDrivers.includes(f)
    )!;
    const v = parseFloat(next.value);
    const p = parseFloat(next.price);
    const u = parseFloat(next.units);
    if (derived === "value" && isFinite(p) && isFinite(u)) next.value = short(p * u);
    else if (derived === "price" && isFinite(v) && isFinite(u) && u !== 0)
      next.price = short(v / u);
    else if (derived === "units" && isFinite(v) && isFinite(p) && p !== 0)
      next.units = short(v / p);
    setValue(next.value);
    setPrice(next.price);
    setUnits(next.units);
    setDrivers(nextDrivers);
  }

  async function add() {
    const v = parseFloat(value);
    if (!date || !name || isNaN(v)) return;
    const p = parseFloat(price);
    const u = parseFloat(units);
    await db.investments.add({
      date,
      value: v,
      category: name,
      action,
      scope,
      // Only positive quantities are stored: 0/negative would corrupt the
      // average-cost math on withdrawals.
      pricePoint: isFinite(p) && p > 0 ? p : undefined,
      units: isFinite(u) && u > 0 ? u : undefined,
      description,
    });
    setValue("");
    setPrice("");
    setUnits("");
    setDescription("");
  }

  async function remove(r: Investment) {
    if (r.id == null) return;
    const ok = await confirm({
      title: "Delete investment",
      message: `Remove ${r.action} · ${r.category} — ${fmtMoney(r.value)}? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await db.investments.delete(r.id);
  }

  // Holdings + realized profit are order-sensitive, so they use the full history.
  const summary = useMemo(() => summarizeInvestments(rows ?? []), [rows]);
  const active = summary.holdings.filter(
    (h) => h.units > 1e-9 || h.invested > 0 || h.withdrawn > 0
  );

  // The transactions list is period-filtered, like every other ledger.
  const filter = usePeriodFilter();
  const filtered = useMemo(() => {
    const all = rows ?? [];
    if (!filter.window) return all;
    const [start, end] = filter.window;
    return all.filter((r) => r.date >= start && r.date <= end);
  }, [rows, filter.window]);

  const netInvested = filtered.reduce(
    (acc, r) => acc + (r.action === "Withdraw" ? -r.value : r.value),
    0
  );

  return (
    <div>
      <BackHome />
      <h2>Investments (archived)</h2>
      <p className="subtitle">
        This tab is archived — new money moved into investments is registered as
        “Saved into investments” under Expenses &amp; Savings. Existing rows remain here.
      </p>

      {/* ---------------- Add a transaction ---------------- */}
      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Add investment</h3>
        <div className="field-row">
          <div className="field">
            <label>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Action</label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as InvestmentAction)}
            >
              {(config?.actions ?? ["Invested", "Withdraw"]).map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Name</label>
            <select value={name} onChange={(e) => setName(e.target.value)}>
              <option value="">— name —</option>
              {names.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Scope</label>
            <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              {SCOPES.map((s) => (
                <option key={s} value={s}>{scopeLabel(s)}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="field-row" style={{ marginTop: 12 }}>
          <div className="field">
            <label>Unit price</label>
            <input
              type="number"
              step="any"
              min="0"
              placeholder="0.00"
              value={price}
              onChange={(e) => editTrade("price", e.target.value)}
              style={{ width: 120 }}
            />
          </div>
          <div className="field">
            <label>Units</label>
            <input
              type="number"
              step="any"
              min="0"
              placeholder="0"
              value={units}
              onChange={(e) => editTrade("units", e.target.value)}
              style={{ width: 120 }}
            />
          </div>
          <div className="field">
            <label>Value</label>
            <input
              type="number"
              step="any"
              placeholder="0.00"
              value={value}
              onChange={(e) => editTrade("value", e.target.value)}
              style={{ width: 120 }}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label>Description</label>
            <input
              placeholder="optional"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <button className="primary" onClick={() => run(add)} disabled={!online || busy}>Add</button>
          <span className="subtitle" style={{ margin: 0 }}>
            Enter any two of unit price / units / value — the third fills in.
          </span>
        </div>
      </div>

      {/* ---------------- Holdings summary (all-time) ---------------- */}
      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Holdings</h3>
        <table className="cards-on-mobile">
          <thead>
            <tr>
              <th>Name</th>
              <th>Scope</th>
              <th className="num">Units held</th>
              <th className="num">Avg cost</th>
              <th className="num">Invested</th>
              <th className="num">Withdrawn</th>
              <th className="num">Realized P/L</th>
            </tr>
          </thead>
          <tbody>
            {active.map((h) => (
              <tr key={`${h.scope}-${h.name}`}>
                <td data-label="Name">{h.name}</td>
                <td data-label="Scope"><span className="pill">{scopeLabel(h.scope)}</span></td>
                <td className="num" data-label="Units held">{num(h.units)}</td>
                <td className="num" data-label="Avg cost">
                  {h.units > 0 ? fmtMoney(h.avgCost) : "—"}
                </td>
                <td className="num" data-label="Invested">{fmtMoney(h.invested)}</td>
                <td className="num" data-label="Withdrawn">{fmtMoney(h.withdrawn)}</td>
                <td
                  className={"num " + (h.realized > 0 ? "pos" : h.realized < 0 ? "neg" : "")}
                  data-label="Realized P/L"
                >
                  {h.realized > 0 ? "+" : ""}{fmtMoney(h.realized)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {active.length === 0 && (
          <div className="empty">No holdings yet — add an investment above.</div>
        )}
      </div>

      {/* ---------------- Registered transactions (filterable) ---------------- */}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Registered transactions</h3>
        <PeriodFilter state={filter} />
        <p className="subtitle">
          Net invested this period: <strong>{fmtMoney(netInvested)}</strong> ·{" "}
          {filtered.length} transactions
        </p>
        <table className="cards-on-mobile">
          <thead>
            <tr>
              <th>Date</th>
              <th>Action</th>
              <th>Name</th>
              <th>Scope</th>
              <th className="num">Units</th>
              <th className="num">Unit price</th>
              <th className="num">Value</th>
              <th className="num">P/L</th>
              <th>Description</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const u = investmentUnits(r);
              const profit = r.id != null ? summary.profitByRow.get(r.id) : undefined;
              return (
                <tr key={r.id}>
                  <td data-label="Date">{fmtDate(r.date)}</td>
                  <td data-label="Action"><span className="pill">{r.action}</span></td>
                  <td data-label="Name">{r.category}</td>
                  <td data-label="Scope"><span className="pill">{scopeLabel(r.scope)}</span></td>
                  <td className="num" data-label="Units">{u != null ? num(u) : "—"}</td>
                  <td className="num" data-label="Unit price">
                    {r.pricePoint != null ? num(r.pricePoint) : "—"}
                  </td>
                  <td
                    className={"num " + (r.action === "Withdraw" ? "neg" : "")}
                    data-label="Value"
                  >
                    {fmtMoney(r.value)}
                  </td>
                  <td
                    className={
                      "num " +
                      (profit == null ? "" : profit > 0 ? "pos" : profit < 0 ? "neg" : "")
                    }
                    data-label="P/L"
                  >
                    {profit == null ? "—" : `${profit > 0 ? "+" : ""}${fmtMoney(profit)}`}
                  </td>
                  <td data-label="Description">{r.description}</td>
                  <td>
                    <button
                      className="ghost danger"
                      onClick={() => remove(r)}
                      disabled={!online}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="empty">
            {rows?.length === 0
              ? "No transactions yet — add one above."
              : "No transactions for this period."}
          </div>
        )}
      </div>
    </div>
  );
}
