import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useLiveQuery } from "../db/live";
import { db } from "../db/db";
import type { InvestmentAction, Investment, Scope } from "../db/types";
import { filterByWindow, summarizeInvestments, investmentUnits } from "../lib/finance";
import { fmtMoney, fmtDate, fmtNum } from "../lib/format";
import { dateForPeriod } from "../lib/period";
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

export default function InvestmentsPage() {
  const { t } = useTranslation();
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

  // The transaction list and the new-trade date follow the shared period.
  const filter = usePeriodFilter();

  const [date, setDate] = useState(() => dateForPeriod(filter));
  const [action, setAction] = useState<InvestmentAction>("Invested");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>("Common");
  const [value, setValue] = useState("");
  const [price, setPrice] = useState("");
  const [units, setUnits] = useState("");
  const [description, setDescription] = useState("");
  // The two trade fields the user last touched drive the third (derived) one.
  const [drivers, setDrivers] = useState<TradeField[]>(["units", "price"]);

  useEffect(() => {
    setDate(dateForPeriod(filter));
  }, [filter.mode, filter.month, filter.year]);

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
      title: t("investments.deleteTitle"),
      message: t("investments.deleteMessage", {
        action: r.action,
        category: r.category,
        amount: fmtMoney(r.value),
      }),
      confirmLabel: t("common.delete"),
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
  const filtered = useMemo(
    () => filterByWindow(rows ?? [], filter.window),
    [rows, filter.window]
  );

  const netInvested = filtered.reduce(
    (acc, r) => acc + (r.action === "Withdraw" ? -r.value : r.value),
    0
  );

  return (
    <div>
      <BackHome />
      <h2>{t("investments.title")}</h2>
      <p className="subtitle">{t("investments.subtitle")}</p>

      {/* ---------------- Add a transaction ---------------- */}
      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>{t("investments.addTitle")}</h3>
        <div className="field-row">
          <div className="field">
            <label>{t("common.table.date")}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>{t("common.table.action")}</label>
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
            <label>{t("common.table.name")}</label>
            <select value={name} onChange={(e) => setName(e.target.value)}>
              <option value="">{t("investments.namePlaceholder")}</option>
              {names.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t("common.table.scope")}</label>
            <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              {SCOPES.map((s) => (
                <option key={s} value={s}>{scopeLabel(s)}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="field-row" style={{ marginTop: 12 }}>
          <div className="field">
            <label>{t("common.table.unitPrice")}</label>
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
            <label>{t("common.table.units")}</label>
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
            <label>{t("common.table.value")}</label>
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
            <label>{t("common.table.description")}</label>
            <input
              placeholder={t("common.optional")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <button className="primary" onClick={() => run(add)} disabled={!online || busy}>
            {t("common.add")}
          </button>
          <span className="subtitle" style={{ margin: 0 }}>{t("investments.hint")}</span>
        </div>
      </div>

      {/* ---------------- Holdings summary (all-time) ---------------- */}
      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>{t("investments.holdings")}</h3>
        <table className="cards-on-mobile">
          <thead>
            <tr>
              <th>{t("common.table.name")}</th>
              <th>{t("common.table.scope")}</th>
              <th className="num">{t("investments.unitsHeld")}</th>
              <th className="num">{t("investments.avgCost")}</th>
              <th className="num">{t("investments.invested")}</th>
              <th className="num">{t("investments.withdrawn")}</th>
              <th className="num">{t("investments.realizedPl")}</th>
            </tr>
          </thead>
          <tbody>
            {active.map((h) => (
              <tr key={`${h.scope}-${h.name}`}>
                <td data-label={t("common.table.name")}>{h.name}</td>
                <td data-label={t("common.table.scope")}>
                  <span className="pill">{scopeLabel(h.scope)}</span>
                </td>
                <td className="num" data-label={t("investments.unitsHeld")}>{fmtNum(h.units)}</td>
                <td className="num" data-label={t("investments.avgCost")}>
                  {h.units > 0 ? fmtMoney(h.avgCost) : "—"}
                </td>
                <td className="num" data-label={t("investments.invested")}>{fmtMoney(h.invested)}</td>
                <td className="num" data-label={t("investments.withdrawn")}>{fmtMoney(h.withdrawn)}</td>
                <td
                  className={"num " + (h.realized > 0 ? "pos" : h.realized < 0 ? "neg" : "")}
                  data-label={t("investments.realizedPl")}
                >
                  {h.realized > 0 ? "+" : ""}{fmtMoney(h.realized)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {active.length === 0 && (
          <div className="empty">{t("investments.emptyHoldings")}</div>
        )}
      </div>

      {/* ---------------- Registered transactions (filterable) ---------------- */}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>{t("investments.transactionsTitle")}</h3>
        <PeriodFilter state={filter} />
        <p className="subtitle">
          <Trans
            i18nKey="investments.total"
            values={{ amount: fmtMoney(netInvested) }}
            components={{ strong: <strong /> }}
          />
          {" · "}
          {t("investments.count", { count: filtered.length })}
        </p>
        <table className="cards-on-mobile">
          <thead>
            <tr>
              <th>{t("common.table.date")}</th>
              <th>{t("common.table.action")}</th>
              <th>{t("common.table.name")}</th>
              <th>{t("common.table.scope")}</th>
              <th className="num">{t("common.table.units")}</th>
              <th className="num">{t("common.table.unitPrice")}</th>
              <th className="num">{t("common.table.value")}</th>
              <th className="num">{t("investments.pl")}</th>
              <th>{t("common.table.description")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const u = investmentUnits(r);
              const profit = r.id != null ? summary.profitByRow.get(r.id) : undefined;
              return (
                <tr key={r.id}>
                  <td data-label={t("common.table.date")}>{fmtDate(r.date)}</td>
                  <td data-label={t("common.table.action")}>
                    <span className="pill">{r.action}</span>
                  </td>
                  <td data-label={t("common.table.name")}>{r.category}</td>
                  <td data-label={t("common.table.scope")}>
                    <span className="pill">{scopeLabel(r.scope)}</span>
                  </td>
                  <td className="num" data-label={t("common.table.units")}>
                    {u != null ? fmtNum(u) : "—"}
                  </td>
                  <td className="num" data-label={t("common.table.unitPrice")}>
                    {r.pricePoint != null ? fmtNum(r.pricePoint) : "—"}
                  </td>
                  <td
                    className={"num " + (r.action === "Withdraw" ? "neg" : "")}
                    data-label={t("common.table.value")}
                  >
                    {fmtMoney(r.value)}
                  </td>
                  <td
                    className={
                      "num " +
                      (profit == null ? "" : profit > 0 ? "pos" : profit < 0 ? "neg" : "")
                    }
                    data-label={t("investments.pl")}
                  >
                    {profit == null ? "—" : `${profit > 0 ? "+" : ""}${fmtMoney(profit)}`}
                  </td>
                  <td data-label={t("common.table.description")}>{r.description}</td>
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
            {rows?.length === 0 ? t("investments.emptyNone") : t("investments.emptyPeriod")}
          </div>
        )}
      </div>
    </div>
  );
}
