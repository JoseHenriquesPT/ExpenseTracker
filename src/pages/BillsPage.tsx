import { useMemo, useState } from "react";
import { useLiveQuery } from "../db/live";
import { db } from "../db/db";
import type { BillScope, Person } from "../db/types";
import { toISO } from "../lib/finance";
import { fmtMoney, fmtDate } from "../lib/format";
import { personName, scopeName } from "../lib/labels";
import { useOnline } from "../lib/useOnline";
import { confirm } from "../lib/confirm";
import { useBusy } from "../lib/useBusy";
import PeriodFilter, { usePeriodFilter } from "../components/PeriodFilter";
import BackHome from "../components/BackHome";

const SCOPES: BillScope[] = ["P1", "P2", "Common"];

export default function BillsPage() {
  const online = useOnline();
  const { busy, run } = useBusy();
  const config = useLiveQuery(() => db.config.get({ key: "config" }), []);
  const bills = useLiveQuery(() => db.bills.orderBy("date").reverse().toArray(), []);

  const names = { p1: config?.p1Name ?? "P1", p2: config?.p2Name ?? "P2" };
  const scopeLabel = (s: BillScope) => scopeName(s, names);
  const personLabel = (p: Person) => personName(p, names);

  // --- new bill form (registering a bill counts as paying it) ---
  const [date, setDate] = useState(toISO(new Date()));
  const [value, setValue] = useState("");
  const [category, setCategory] = useState("");
  const [scope, setScope] = useState<BillScope>("Common");
  const [paidBy, setPaidBy] = useState<Person>("P1");
  const [description, setDescription] = useState("");

  const billCats = config?.billCategories ?? [];

  // The list filters by period, like the ledger tabs / Dashboard.
  const filter = usePeriodFilter();
  const filtered = useMemo(() => {
    const all = bills ?? [];
    if (!filter.window) return all;
    const [start, end] = filter.window;
    return all.filter((b) => b.date >= start && b.date <= end);
  }, [bills, filter.window]);
  const total = filtered.reduce((a, b) => a + b.value, 0);

  async function addBill() {
    const num = parseFloat(value);
    if (!date || isNaN(num) || !category) return;
    // For a personal bill the payer is implicitly that person.
    const who: Person = scope === "Common" ? paidBy : scope;
    await db.bills.add({ date, value: num, category, scope, paidBy: who, description });
    setValue("");
    setDescription("");
  }

  async function deleteBill(id: number | undefined, category: string, value: number) {
    if (id == null) return;
    const ok = await confirm({
      title: "Delete bill",
      message: `Remove the ${fmtMoney(value)} ${category} bill? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await db.bills.delete(id);
  }

  const head = (
    <thead>
      <tr>
        <th>Date</th>
        <th className="num">Value</th>
        <th>Category</th>
        <th>Scope</th>
        <th>Paid by</th>
        <th>Description</th>
        <th></th>
      </tr>
    </thead>
  );

  return (
    <div>
      <BackHome />
      <h2>Bills</h2>
      <p className="subtitle">
        Registering a bill counts it as paid. Bills tagged <strong>Common</strong> are
        split in the monthly settlement; {names.p1}/{names.p2} bills are personal. This is what the
        dashboards count as “Bills”.
      </p>

      {/* ---------------- Add a bill ---------------- */}
      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Add bill</h3>
        <table className="cards-on-mobile">
          {head}
          <tbody>
            <tr className="row-form">
              <td data-label="Date">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </td>
              <td className="num" data-label="Value">
                <input
                  type="number" step="0.01" placeholder="0.00"
                  value={value} onChange={(e) => setValue(e.target.value)}
                  style={{ width: 100, textAlign: "right" }}
                />
              </td>
              <td data-label="Category">
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">— category —</option>
                  {billCats.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </td>
              <td data-label="Scope">
                <select value={scope} onChange={(e) => setScope(e.target.value as BillScope)}>
                  {SCOPES.map((s) => <option key={s} value={s}>{scopeLabel(s)}</option>)}
                </select>
              </td>
              <td data-label="Paid by">
                {scope === "Common" ? (
                  <select value={paidBy} onChange={(e) => setPaidBy(e.target.value as Person)}>
                    <option value="P1">{names.p1}</option>
                    <option value="P2">{names.p2}</option>
                  </select>
                ) : (
                  <span className="pill">{scopeLabel(scope)}</span>
                )}
              </td>
              <td data-label="Description">
                <input placeholder="optional" value={description} onChange={(e) => setDescription(e.target.value)} />
              </td>
              <td className="row-form-actions">
                <button className="primary" onClick={() => run(addBill)} disabled={!online || busy}>Add</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ---------------- Registered bills (filterable) ---------------- */}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Registered bills</h3>
        <PeriodFilter state={filter} />
        <p className="subtitle">
          Total for this period: <strong>{fmtMoney(total)}</strong> · {filtered.length} bills
        </p>
        <table className="cards-on-mobile">
          {head}
          <tbody>
            {filtered.map((b) => (
              <tr key={b.id}>
                <td data-label="Date">{fmtDate(b.date)}</td>
                <td className="num" data-label="Value">{fmtMoney(b.value)}</td>
                <td data-label="Category">{b.category}</td>
                <td data-label="Scope"><span className="pill">{scopeLabel(b.scope)}</span></td>
                <td data-label="Paid by"><span className="pill">{personLabel(b.paidBy)}</span></td>
                <td data-label="Description">{b.description}</td>
                <td>
                  <button className="ghost danger" onClick={() => deleteBill(b.id, b.category, b.value)} disabled={!online}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="empty">
            {bills?.length === 0
              ? "No bills registered yet — add one above."
              : "No bills for this period."}
          </div>
        )}
      </div>
    </div>
  );
}
