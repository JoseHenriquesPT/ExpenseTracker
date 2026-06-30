import { useState } from "react";
import { useLiveQuery } from "../db/live";
import { db, type SupaTable } from "../db/db";
import type {
  Entry, ExpenseEntry, IncomeEntry, Investment, InvestmentAction, Person,
} from "../db/types";
import { toISO } from "../lib/finance";
import { fmtMoney, fmtDate } from "../lib/format";
import { useOnline } from "../lib/useOnline";

type Kind = "expenses" | "income" | "investments";

const TITLES: Record<Kind, string> = {
  expenses: "Common Expenses",
  income: "Income",
  investments: "Investments",
};

type Row = Entry &
  Partial<Pick<Investment, "action">> &
  Partial<Pick<ExpenseEntry, "paidBy">> &
  Partial<Pick<IncomeEntry, "person">>;

export default function LedgerPage({ kind }: { kind: Kind }) {
  const isInvestment = kind === "investments";
  const isExpense = kind === "expenses";
  const isIncome = kind === "income";
  const online = useOnline();

  const config = useLiveQuery(() => db.config.get({ key: "config" }), []);
  const rows = useLiveQuery(
    () => (db[kind] as SupaTable<Row>).orderBy("date").reverse().toArray(),
    [kind]
  );

  const categories = !config
    ? []
    : isExpense
    ? config.expenseCategories
    : isIncome
    ? config.incomeCategories
    : config.investmentCategories;

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
  const [action, setAction] = useState<InvestmentAction>("Invested");
  const [person, setPerson] = useState<Person>("P1");
  const [description, setDescription] = useState("");

  async function add() {
    const num = parseFloat(value);
    if (!date || isNaN(num) || !category) return;
    if (isInvestment) {
      await db.investments.add({ date, value: num, category, action, description });
    } else if (isExpense) {
      await db.expenses.add({ date, value: num, category, paidBy: person, description });
    } else {
      await db.income.add({ date, value: num, category, person, description });
    }
    setValue("");
    setDescription("");
  }

  async function remove(id?: number) {
    if (id != null) await db[kind].delete(id);
  }

  const total = (rows ?? []).reduce(
    (acc, r) =>
      acc + (isInvestment && r.action === "Withdraw" ? -r.value : r.value),
    0
  );

  const personColTitle = isExpense ? "Paid by" : "Person";

  return (
    <div>
      <h2>{TITLES[kind]}</h2>
      <p className="subtitle">
        {isInvestment ? "Net" : "Total"} recorded:{" "}
        <strong>{fmtMoney(total)}</strong> · {rows?.length ?? 0} entries
        {isExpense && " · shared cost, settled monthly on the Dashboard"}
      </p>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">Value</th>
              <th>Category</th>
              {isInvestment && <th>Action</th>}
              {(isExpense || isIncome) && <th>{personColTitle}</th>}
              <th>Description</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr className="row-form">
              <td>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </td>
              <td className="num">
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  style={{ width: 100, textAlign: "right" }}
                />
              </td>
              <td>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">— category —</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </td>
              {isInvestment && (
                <td>
                  <select
                    value={action}
                    onChange={(e) => setAction(e.target.value as InvestmentAction)}
                  >
                    {config?.actions.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </td>
              )}
              {(isExpense || isIncome) && (
                <td>
                  <select value={person} onChange={(e) => setPerson(e.target.value as Person)}>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </td>
              )}
              <td>
                <input
                  placeholder="optional"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </td>
              <td>
                <button className="primary" onClick={add} disabled={!online}>Add</button>
              </td>
            </tr>

            {rows?.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.date)}</td>
                <td
                  className={
                    "num " + (isInvestment && r.action === "Withdraw" ? "neg" : "")
                  }
                >
                  {fmtMoney(r.value)}
                </td>
                <td>{r.category}</td>
                {isInvestment && (
                  <td><span className="pill">{r.action}</span></td>
                )}
                {(isExpense || isIncome) && (
                  <td><span className="pill">{personLabel(r.paidBy ?? r.person)}</span></td>
                )}
                <td>{r.description}</td>
                <td>
                  <button className="ghost danger" onClick={() => remove(r.id)} disabled={!online}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows?.length === 0 && <div className="empty">No entries yet — add one above.</div>}
      </div>
    </div>
  );
}
