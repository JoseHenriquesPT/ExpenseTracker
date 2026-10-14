import { useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useLiveQuery, useSingleMode } from "../db/live";
import { db } from "../db/db";
import type { Person, Scope } from "../db/types";
import { filterByWindow } from "../lib/finance";
import { fmtMoney, fmtDate } from "../lib/format";
import { modeText, monthName, personName, scopeName } from "../lib/labels";
import PeriodFilter, { usePeriodFilter } from "../components/PeriodFilter";
import BackHome from "../components/BackHome";

type Kind = "common" | "personal" | "savings" | "bill";
type KindFilter = "all" | Kind;

const KIND_KEYS = {
  personal: "history.kind.personal",
  savings: "history.kind.savings",
  bill: "history.kind.bill",
} as const;

interface Row {
  id?: number;
  date: string;
  value: number;
  category: string;
  kind: Kind;
  scope: Scope;
  paidBy: Person;
  description?: string;
}

/** Every expense-side entry in one list: common/individual spending, savings
 *  and bills — savings included because they're where investments now live. */
export default function HistoryPage() {
  const { t } = useTranslation();
  const single = useSingleMode();
  const labels = modeText(single);
  const config = useLiveQuery(() => db.config.get({ key: "config" }), []);
  const expenses = useLiveQuery(() => db.expenses.toArray(), []);
  const personal = useLiveQuery(() => db.personalExpenses.toArray(), []);
  const bills = useLiveQuery(() => db.bills.toArray(), []);

  const names = { p1: config?.p1Name ?? "P1", p2: config?.p2Name ?? "P2" };
  const filter = usePeriodFilter();
  const [kind, setKind] = useState<KindFilter>("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");

  const all = useMemo<Row[]>(() => {
    if (!expenses || !personal || !bills) return [];
    const rows: Row[] = [
      ...expenses.map((r) => ({
        ...r,
        kind: (r.saved ? "savings" : "common") as Kind,
        scope: "Common" as Scope,
        paidBy: r.paidBy,
      })),
      ...personal.map((r) => ({
        ...r,
        kind: (r.saved ? "savings" : "personal") as Kind,
        scope: r.person as Scope,
        paidBy: r.person,
      })),
      ...bills.map((r) => ({ ...r, kind: "bill" as Kind, paidBy: r.paidBy })),
    ];
    return rows.sort((a, b) =>
      a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b.id ?? 0) - (a.id ?? 0)
    );
  }, [expenses, personal, bills]);

  const categories = useMemo(
    () => [...new Set(all.map((r) => r.category))].sort((a, b) => a.localeCompare(b)),
    [all]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return filterByWindow(all, filter.window).filter((r) => {
      if (kind !== "all" && r.kind !== kind) return false;
      if (category !== "all" && r.category !== category) return false;
      if (q && !`${r.category} ${r.description ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, filter.window, kind, category, query]);

  // Newest first — the sort above makes map insertion order month-descending.
  const months = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of filtered) {
      const key = r.date.slice(0, 7);
      const list = map.get(key);
      if (list) list.push(r);
      else map.set(key, [r]);
    }
    return [...map.entries()];
  }, [filtered]);

  const total = filtered.reduce((a, r) => a + r.value, 0);

  return (
    <div>
      <BackHome />
      <h2>{t("history.title")}</h2>
      <p className="subtitle">{t("history.subtitle")}</p>

      <PeriodFilter state={filter} />

      <div className="toolbar">
        <select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
          <option value="all">{t("history.allTypes")}</option>
          <option value="common">{labels.expenses}</option>
          {!single && <option value="personal">{t("history.individualOption")}</option>}
          <option value="savings">{t("history.savingsOption")}</option>
          <option value="bill">{t("history.billsOption")}</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">{t("history.allCategories")}</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input
          placeholder={t("history.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ minWidth: 200 }}
        />
        <span className="subtitle" style={{ margin: 0 }}>
          <Trans
            i18nKey="history.total"
            values={{ amount: fmtMoney(total) }}
            components={{ strong: <strong /> }}
          />
          {" · "}
          {t("history.count", { count: filtered.length })}
        </span>
      </div>

      {months.length === 0 ? (
        <div className="empty">
          {all.length === 0 ? t("history.emptyNone") : t("history.emptyFiltered")}
        </div>
      ) : (
        months.map(([key, rows]) => {
          const [y, m] = key.split("-").map(Number);
          const monthTotal = rows.reduce((a, r) => a + r.value, 0);
          return (
            <section key={key} className="history-month">
              <div className="history-month-head">
                <h3>{monthName(m)} {y}</h3>
                <span className="history-month-total">
                  {fmtMoney(monthTotal)} · {t("history.count", { count: rows.length })}
                </span>
              </div>
              <table className="cards-on-mobile">
                <thead>
                  <tr>
                    <th>{t("common.table.date")}</th>
                    <th>{t("common.table.type")}</th>
                    <th>{t("common.table.category")}</th>
                    {!single && <th>{t("common.table.scope")}</th>}
                    {!single && <th>{t("common.table.paidBy")}</th>}
                    <th className="num">{t("common.table.value")}</th>
                    <th>{t("common.table.description")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.kind}-${r.id}`}>
                      <td data-label={t("common.table.date")}>{fmtDate(r.date)}</td>
                      <td data-label={t("common.table.type")}>
                        <span className={r.kind === "savings" ? "pill savings" : "pill"}>
                          {r.kind === "common" ? labels.expenseKind : t(KIND_KEYS[r.kind])}
                        </span>
                      </td>
                      <td data-label={t("common.table.category")}>{r.category}</td>
                      {!single && (
                        <>
                          <td data-label={t("common.table.scope")}>
                            <span className="pill">{scopeName(r.scope, names)}</span>
                          </td>
                          <td data-label={t("common.table.paidBy")}>
                            <span className="pill">{personName(r.paidBy, names)}</span>
                          </td>
                        </>
                      )}
                      <td className="num" data-label={t("common.table.value")}>{fmtMoney(r.value)}</td>
                      <td data-label={t("common.table.description")}>{r.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })
      )}
    </div>
  );
}
