import { useMemo, useState } from "react";
import { useLiveQuery } from "../db/live";
import { db, type SupaTable } from "../db/db";
import type { Entry, ExpenseEntry, IncomeEntry, Person } from "../db/types";
import { toISO } from "../lib/finance";
import { fmtMoney, fmtDate } from "../lib/format";
import { useOnline } from "../lib/useOnline";
import { confirm } from "../lib/confirm";
import PeriodFilter, { usePeriodFilter } from "../components/PeriodFilter";

type Kind = "expenses" | "income" | "personalExpenses";

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
  expenses: "Shared cost — settled monthly on the Dashboard.",
  income: "Attributed to a person — sets their settlement share.",
  personalExpenses: "Personal spending — not shared, not settled.",
};

type Row = Entry &
  Partial<Pick<ExpenseEntry, "paidBy">> &
  Partial<Pick<IncomeEntry, "person">>;

export default function LedgerPage({ tabs }: { tabs: Kind[] }) {
  // The active subtab drives everything; defaults to the first tab (Common for
  // the merged Expenses page). A single-tab page just hides the switcher.
  const [kind, setKind] = useState<Kind>(tabs[0]);
  const pageTitle = tabs.length > 1 ? "Expenses" : TITLES[kind];

  const isExpense = kind === "expenses";
  const isIncome = kind === "income";
  const isPersonal = kind === "personalExpenses";
  const online = useOnline();

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
  const people: { id: Person; name: string }[] = [
    { id: "P1", name: config?.p1Name ?? "P1" },
    { id: "P2", name: config?.p2Name ?? "P2" },
  ];
  const personLabel = (p?: Person) =>
    p === "P2" ? people[1].name : p === "P1" ? people[0].name : "";

  const [date, setDate] = useState(toISO(new Date()));
  const [value, setValue] = useState("");
  const [category, setCategory] = useState("");
  const [person, setPerson] = useState<Person>("P1");
  const [description, setDescription] = useState("");

  async function add() {
    const num = parseFloat(value);
    if (!date || isNaN(num) || !category) return;
    if (isExpense) {
      await db.expenses.add({ date, value: num, category, paidBy: person, description });
    } else if (isPersonal) {
      await db.personalExpenses.add({ date, value: num, category, person, description });
    } else {
      await db.income.add({ date, value: num, category, person, description });
    }
    setValue("");
    setDescription("");
  }

  async function remove(r: Row) {
    if (r.id == null) return;
    const ok = await confirm({
      title: "Delete entry",
      message: `Remove ${r.category} — ${fmtMoney(r.value)}${
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
      <h2>{pageTitle}</h2>
      {tabs.length > 1 && (
        <div className="segmented" style={{ marginBottom: 12 }}>
          {tabs.map((t) => (
            <button
              key={t}
              className={kind === t ? "seg active" : "seg"}
              onClick={() => setKind(t)}
            >
              {SUBTAB_LABELS[t]}
            </button>
          ))}
        </div>
      )}
      <p className="subtitle">{NOTES[kind]}</p>

      {/* ---------------- Add a new entry ---------------- */}
      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Add entry</h3>
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
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">— category —</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </td>
              <td data-label={personColTitle}>
                <select value={person} onChange={(e) => setPerson(e.target.value as Person)}>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </td>
              <td data-label="Description">
                <input
                  placeholder="optional"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </td>
              <td className="row-form-actions">
                <button className="primary" onClick={add} disabled={!online}>Add</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ---------------- Registered entries (filterable) ---------------- */}
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
    </div>
  );
}
