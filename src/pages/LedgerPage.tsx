import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "../db/live";
import { db, type SupaTable } from "../db/db";
import type { Entry, ExpenseEntry, IncomeEntry, Person } from "../db/types";
import { monthEnd, monthStart, SAVINGS_CATEGORY, toISO } from "../lib/finance";
import { monthName, personName } from "../lib/labels";
import { fmtMoney, fmtDate } from "../lib/format";
import { useOnline } from "../lib/useOnline";
import { confirm } from "../lib/confirm";
import { useBusy } from "../lib/useBusy";
import PeriodFilter, { usePeriodFilter } from "../components/PeriodFilter";
import BackHome from "../components/BackHome";

type Kind = "expenses" | "income" | "personalExpenses";
type EntryMode = "expense" | "savings";

const TITLES: Record<Kind, string> = {
  expenses: "Common Expenses",
  income: "Income",
  personalExpenses: "Individual Expenses",
};

// Short labels for the subtab switcher (when a page groups several kinds).
const SUBTAB_LABELS: Record<Kind, string> = {
  expenses: "Common",
  income: "Income",
  personalExpenses: "Individual",
};

const NOTES: Record<Kind, string> = {
  expenses:
    "Shared cost — settled monthly on the Dashboard. “Saved into investments” is money moved to investments, not spending.",
  income: "Attributed to a person — sets their settlement share.",
  personalExpenses:
    "Personal spending — not shared, not settled. “Saved into investments” is money moved to investments, not spending.",
};

type Row = Entry &
  Partial<Pick<ExpenseEntry, "paidBy" | "saved">> &
  Partial<Pick<IncomeEntry, "person">>;

export default function LedgerPage({ tabs }: { tabs: Kind[] }) {
  // The active subtab drives everything; defaults to the first tab (Common for
  // the merged Expenses page). A single-tab page just hides the switcher.
  const [kind, setKind] = useState<Kind>(tabs[0]);
  const [entryMode, setEntryMode] = useState<EntryMode>("expense");
  const pageTitle = tabs.length > 1 ? "Expenses & Savings" : TITLES[kind];

  const isExpense = kind === "expenses";
  const isIncome = kind === "income";
  const isPersonal = kind === "personalExpenses";
  const canSave = isExpense || isPersonal;
  const isSavings = canSave && entryMode === "savings";
  const online = useOnline();
  const { busy, run } = useBusy();

  const config = useLiveQuery(() => db.config.get({ key: "config" }), []);
  const rows = useLiveQuery(
    () => (db[kind] as SupaTable<Row>).orderBy("date").reverse().toArray(),
    [kind]
  );

  const categories = !config
    ? []
    : isIncome
    ? config.incomeCategories
    : config.expenseCategories;

  // P1/P2 dropdown options labelled with the configured names.
  const names = { p1: config?.p1Name ?? "P1", p2: config?.p2Name ?? "P2" };
  const people: { id: Person; name: string }[] = [
    { id: "P1", name: names.p1 },
    { id: "P2", name: names.p2 },
  ];
  const personLabel = (p?: Person) => (p ? personName(p, names) : "");

  const [date, setDate] = useState(toISO(new Date()));
  const [value, setValue] = useState("");
  const [category, setCategory] = useState("");
  const [person, setPerson] = useState<Person | null>(null);
  const [description, setDescription] = useState("");

  async function add() {
    const num = parseFloat(value);
    if (!date || isNaN(num)) return;
    if (isExpense) {
      if (!person) return;
      if (isSavings) {
        await db.expenses.add({
          date, value: num, category: SAVINGS_CATEGORY, paidBy: person, description, saved: true,
        });
      } else {
        if (!category) return;
        await db.expenses.add({ date, value: num, category, paidBy: person, description });
      }
    } else if (isPersonal) {
      if (!person) return;
      if (isSavings) {
        await db.personalExpenses.add({
          date, value: num, category: SAVINGS_CATEGORY, person, description, saved: true,
        });
      } else {
        if (!category) return;
        await db.personalExpenses.add({ date, value: num, category, person, description });
      }
    } else {
      if (!category) return;
      await db.income.add({ date, value: num, category, person: person ?? "P1", description });
    }
    setValue("");
    setDescription("");
  }

  async function remove(r: Row) {
    if (r.id == null) return;
    const label = r.saved ? `Savings — ${fmtMoney(r.value)}` : `${r.category} — ${fmtMoney(r.value)}`;
    const ok = await confirm({
      title: "Delete entry",
      message: `Remove ${label}${
        r.description ? ` (${r.description})` : ""
      }? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await db[kind].delete(r.id);
  }

  // The registered-entries list filters by period, just like the Dashboard.
  const filter = usePeriodFilter();
  const filtered = useMemo(() => {
    const all = rows ?? [];
    if (!filter.window) return all;
    const [start, end] = filter.window;
    return all.filter((r) => r.date >= start && r.date <= end);
  }, [rows, filter.window]);

  const total = filtered.reduce((acc, r) => acc + r.value, 0);

  // Expenses/Savings show a short "latest this month" list; the History page
  // is where the full record lives.
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const monthWindow: [string, string] = [
    monthStart(currentYear, currentMonth),
    monthEnd(currentYear, currentMonth),
  ];
  const recent = useMemo(() => {
    if (!canSave) return [];
    const [start, end] = monthWindow;
    return (rows ?? [])
      .filter((r) => r.date >= start && r.date <= end)
      .sort((a, b) =>
        a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b.id ?? 0) - (a.id ?? 0)
      )
      .slice(0, 5);
  }, [rows, canSave, monthWindow[0], monthWindow[1]]);

  // Income, Common Expenses and Individual Expenses all attribute to a person.
  const personColTitle = isExpense ? "Paid by" : "Person";

  // Column headers — shared by the "Add" form table and the list table.
  const head = (
    <thead>
      <tr>
        <th>Date</th>
        <th className="num">Value</th>
        <th>Category</th>
        <th>{personColTitle}</th>
        <th>Description</th>
        <th></th>
      </tr>
    </thead>
  );

  return (
    <div>
      <BackHome />
      <h2>{pageTitle}</h2>
      {tabs.length > 1 && (
        <div className="segmented" style={{ marginBottom: 12 }}>
          {tabs.map((t) => (
            <button
              key={t}
              className={kind === t ? "seg active" : "seg"}
              onClick={() => {
                setKind(t);
                setEntryMode("expense");
              }}
            >
              {SUBTAB_LABELS[t]}
            </button>
          ))}
        </div>
      )}
      <p className="subtitle">{NOTES[kind]}</p>

      {/* ---------------- Add a new entry ---------------- */}
      <div className="panel" style={{ marginBottom: 24 }}>
        <div className="form-head">
          <h3 style={{ margin: 0 }}>Add entry</h3>
          {canSave && (
            <div className="segmented">
              {([["expense", "Expense"], ["savings", "Saved into investments"]] as
                [EntryMode, string][]).map(([id, label]) => (
                <button
                  key={id}
                  className={entryMode === id ? "seg active" : "seg"}
                  onClick={() => setEntryMode(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <table className="cards-on-mobile">
          {head}
          <tbody>
            <tr className="row-form">
              <td data-label="Date">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </td>
              <td className="num" data-label="Value">
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  style={{ width: 100, textAlign: "right" }}
                />
              </td>
              <td data-label="Category">
                {isSavings ? (
                  <span className="pill savings">Savings</span>
                ) : (
                  <select value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">— category —</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}
              </td>
              <td data-label={personColTitle}>
                {isIncome ? (
                  <select
                    value={person ?? "P1"}
                    onChange={(e) => setPerson(e.target.value as Person)}
                  >
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                ) : (
                  <div className="radio-row">
                    {people.map((p) => (
                      <label key={p.id} className="radio">
                        <input
                          type="radio"
                          name={`person-${kind}`}
                          checked={person === p.id}
                          onChange={() => setPerson(p.id)}
                        />
                        {p.name}
                      </label>
                    ))}
                  </div>
                )}
              </td>
              <td data-label="Description">
                <input
                  placeholder="optional"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </td>
              <td className="row-form-actions">
                <button className="primary" onClick={() => run(add)} disabled={!online || busy}>Add</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ---------------- Registered entries ---------------- */}
      {isIncome ? (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Registered entries</h3>
          <PeriodFilter state={filter} />
          <p className="subtitle">
            Total for this period: <strong>{fmtMoney(total)}</strong> · {filtered.length} entries
          </p>
          <table className="cards-on-mobile">
            {head}
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td data-label="Date">{fmtDate(r.date)}</td>
                  <td className="num" data-label="Value">{fmtMoney(r.value)}</td>
                  <td data-label="Category">{r.category}</td>
                  <td data-label={personColTitle}>
                    <span className="pill">{personLabel(r.paidBy ?? r.person)}</span>
                  </td>
                  <td data-label="Description">{r.description}</td>
                  <td>
                    <button className="ghost danger" onClick={() => remove(r)} disabled={!online}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="empty">
              {rows?.length === 0
                ? "No entries yet — add one above."
                : "No entries for this period."}
            </div>
          )}
        </div>
      ) : (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Latest this month</h3>
          <p className="subtitle">
            The 5 most recent entries of {monthName(currentMonth)} {currentYear}.{" "}
            <Link to="/history" className="link-more">View full history →</Link>
          </p>
          <table className="cards-on-mobile">
            {head}
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td data-label="Date">{fmtDate(r.date)}</td>
                  <td className="num" data-label="Value">{fmtMoney(r.value)}</td>
                  <td data-label="Category">
                    {r.saved ? <span className="pill savings">Savings</span> : r.category}
                  </td>
                  <td data-label={personColTitle}>
                    <span className="pill">{personLabel(r.paidBy ?? r.person)}</span>
                  </td>
                  <td data-label="Description">{r.description}</td>
                  <td>
                    <button className="ghost danger" onClick={() => remove(r)} disabled={!online}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {recent.length === 0 && (
            <div className="empty">
              {(rows ?? []).length === 0
                ? "No entries yet — add one above."
                : `No entries in ${monthName(currentMonth)} yet — see the full history for older ones.`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
