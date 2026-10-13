import { useMemo, useState } from "react";
import { useLiveQuery } from "../db/live";
import { db } from "../db/db";
import type { Person, Scope } from "../db/types";
import { filterByWindow } from "../lib/finance";
import { fmtMoney, fmtDate } from "../lib/format";
import { monthName, personName, scopeName } from "../lib/labels";
import PeriodFilter, { usePeriodFilter } from "../components/PeriodFilter";
import BackHome from "../components/BackHome";

type Kind = "common" | "personal" | "savings" | "bill";
type KindFilter = "all" | Kind;

const KIND_LABELS: Record<Kind, string> = {
  common: "Common",
  personal: "Individual",
  savings: "Savings",
  bill: "Bill",
};

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
      <h2>History of Expenses &amp; Investments</h2>
      <p className="subtitle">
        Every registered entry in one place — spending, savings and bills — grouped by month,
        newest first.
      </p>

      <PeriodFilter state={filter} />

      <div className="toolbar">
        <select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
          <option value="all">All types</option>
          <option value="common">Common expenses</option>
          <option value="personal">Individual expenses</option>
          <option value="savings">Savings</option>
          <option value="bill">Bills</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input
          placeholder="Search description…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ minWidth: 200 }}
        />
        <span className="subtitle" style={{ margin: 0 }}>
          Total: <strong>{fmtMoney(total)}</strong> · {filtered.length} entries
        </span>
      </div>

      {months.length === 0 ? (
        <div className="empty">
          {all.length === 0
            ? "No entries yet — register expenses, savings or bills first."
            : "No entries match these filters."}
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
                  {fmtMoney(monthTotal)} · {rows.length} entries
                </span>
              </div>
              <table className="cards-on-mobile">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Category</th>
                    <th>Scope</th>
                    <th>Paid by</th>
                    <th className="num">Value</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.kind}-${r.id}`}>
                      <td data-label="Date">{fmtDate(r.date)}</td>
                      <td data-label="Type">
                        <span className={r.kind === "savings" ? "pill savings" : "pill"}>
                          {KIND_LABELS[r.kind]}
                        </span>
                      </td>
                      <td data-label="Category">{r.category}</td>
                      <td data-label="Scope">
                        <span className="pill">{scopeName(r.scope, names)}</span>
                      </td>
                      <td data-label="Paid by">
                        <span className="pill">{personName(r.paidBy, names)}</span>
                      </td>
                      <td className="num" data-label="Value">{fmtMoney(r.value)}</td>
                      <td data-label="Description">{r.description}</td>
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
