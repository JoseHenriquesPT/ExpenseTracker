import { useState } from "react";
import { useLiveQuery } from "../db/live";
import { db } from "../db/db";
import type { Recurrency, BillStatus, BillScope, Person } from "../db/types";
import { toISO, nextDueDate } from "../lib/finance";
import { fmtMoney, fmtDate } from "../lib/format";
import { useOnline } from "../lib/useOnline";
import { confirm } from "../lib/confirm";

const SCOPES: BillScope[] = ["P1", "P2", "Common"];

export default function BillsPage() {
  const online = useOnline();
  const config = useLiveQuery(() => db.config.get({ key: "config" }), []);
  const bills = useLiveQuery(() => db.bills.orderBy("startDate").toArray(), []);
  const payments = useLiveQuery(
    () => db.billPayments.orderBy("date").reverse().toArray(),
    []
  );

  const p1 = config?.p1Name ?? "P1";
  const p2 = config?.p2Name ?? "P2";
  const scopeLabel = (s: BillScope) => (s === "P1" ? p1 : s === "P2" ? p2 : "Common");
  const personLabel = (p: Person) => (p === "P1" ? p1 : p2);

  // --- new bill form ---
  const [startDate, setStartDate] = useState(toISO(new Date()));
  const [recurrency, setRecurrency] = useState<Recurrency>("Monthly");
  const [bValue, setBValue] = useState("");
  const [bCategory, setBCategory] = useState("");
  const [status, setStatus] = useState<BillStatus>("Active");
  const [bScope, setBScope] = useState<BillScope>("Common");
  const [bDesc, setBDesc] = useState("");

  // --- new payment form ---
  const [pDate, setPDate] = useState(toISO(new Date()));
  const [pValue, setPValue] = useState("");
  const [pCategory, setPCategory] = useState("");
  const [pScope, setPScope] = useState<BillScope>("Common");
  const [pPaidBy, setPPaidBy] = useState<Person>("P1");

  const billCats = config?.billCategories ?? [];

  async function addBill() {
    const num = parseFloat(bValue);
    if (!startDate || isNaN(num) || !bCategory) return;
    await db.bills.add({
      startDate, recurrency, value: num, category: bCategory,
      status, scope: bScope, description: bDesc,
    });
    setBValue("");
    setBDesc("");
  }

  async function addPayment() {
    const num = parseFloat(pValue);
    if (!pDate || isNaN(num) || !pCategory) return;
    // For a personal bill the payer is implicitly that person.
    const paidBy: Person = pScope === "Common" ? pPaidBy : pScope;
    await db.billPayments.add({ date: pDate, value: num, category: pCategory, scope: pScope, paidBy });
    setPValue("");
  }

  /** Convenience: register today's payment straight from a bill row. */
  async function payNow(value: number, category: string, scope: BillScope) {
    const paidBy: Person = scope === "Common" ? "P1" : scope;
    await db.billPayments.add({ date: toISO(new Date()), value, category, scope, paidBy });
  }

  async function deleteBill(id: number | undefined, category: string, value: number) {
    if (id == null) return;
    const ok = await confirm({
      title: "Delete bill",
      message: `Remove the ${category} bill (${fmtMoney(value)}) from the schedule? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await db.bills.delete(id);
  }

  async function deletePayment(id: number | undefined, category: string, value: number) {
    if (id == null) return;
    const ok = await confirm({
      title: "Delete payment",
      message: `Remove the ${fmtMoney(value)} ${category} payment from the register? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await db.billPayments.delete(id);
  }

  return (
    <div>
      <h2>Bills</h2>
      <p className="subtitle">
        Recurring schedules and the manual payment register (Bills Regist).
        Bills tagged <strong>Common</strong> are split in the monthly settlement; {p1}/{p2}
        bills are personal.
      </p>

      {/* ---------------- Schedule ---------------- */}
      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Schedule</h3>
        <table className="cards-on-mobile">
          <thead>
            <tr>
              <th>Start Date</th>
              <th>Recurrency</th>
              <th>Next Due</th>
              <th className="num">Value</th>
              <th>Category</th>
              <th>Scope</th>
              <th>Status</th>
              <th>Description</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr className="row-form">
              <td data-label="Start Date">
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </td>
              <td data-label="Recurrency">
                <select value={recurrency} onChange={(e) => setRecurrency(e.target.value as Recurrency)}>
                  {config?.recurrencies.map((r) => <option key={r}>{r}</option>)}
                </select>
              </td>
              <td data-label="Next Due">{fmtDate(nextDueDate(startDate, recurrency))}</td>
              <td className="num" data-label="Value">
                <input
                  type="number" step="0.01" placeholder="0.00"
                  value={bValue} onChange={(e) => setBValue(e.target.value)}
                  style={{ width: 100, textAlign: "right" }}
                />
              </td>
              <td data-label="Category">
                <select value={bCategory} onChange={(e) => setBCategory(e.target.value)}>
                  <option value="">— category —</option>
                  {billCats.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </td>
              <td data-label="Scope">
                <select value={bScope} onChange={(e) => setBScope(e.target.value as BillScope)}>
                  {SCOPES.map((s) => <option key={s} value={s}>{scopeLabel(s)}</option>)}
                </select>
              </td>
              <td data-label="Status">
                <select value={status} onChange={(e) => setStatus(e.target.value as BillStatus)}>
                  {config?.statuses.map((s) => <option key={s}>{s}</option>)}
                </select>
              </td>
              <td data-label="Description">
                <input placeholder="optional" value={bDesc} onChange={(e) => setBDesc(e.target.value)} />
              </td>
              <td className="row-form-actions"><button className="primary" onClick={addBill} disabled={!online}>Add</button></td>
            </tr>

            {bills?.map((b) => (
              <tr key={b.id}>
                <td data-label="Start Date">{fmtDate(b.startDate)}</td>
                <td data-label="Recurrency">{b.recurrency}</td>
                <td data-label="Next Due">{b.status === "Active" ? fmtDate(nextDueDate(b.startDate, b.recurrency)) : "—"}</td>
                <td className="num" data-label="Value">{fmtMoney(b.value)}</td>
                <td data-label="Category">{b.category}</td>
                <td data-label="Scope"><span className="pill">{scopeLabel(b.scope)}</span></td>
                <td data-label="Status"><span className="pill">{b.status}</span></td>
                <td data-label="Description">{b.description}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="ghost" title="Register a payment today" onClick={() => payNow(b.value, b.category, b.scope)} disabled={!online}>Pay</button>
                  <button className="ghost danger" onClick={() => deleteBill(b.id, b.category, b.value)} disabled={!online}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {bills?.length === 0 && <div className="empty">No bills scheduled yet.</div>}
      </div>

      {/* ---------------- Payment register ---------------- */}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Payment register</h3>
        <p className="subtitle" style={{ marginTop: 0 }}>
          This is what the dashboards count as “Bills”. Common payments also feed the settlement.
        </p>
        <table className="cards-on-mobile">
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">Value</th>
              <th>Category</th>
              <th>Scope</th>
              <th>Paid by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr className="row-form">
              <td data-label="Date"><input type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} /></td>
              <td className="num" data-label="Value">
                <input
                  type="number" step="0.01" placeholder="0.00"
                  value={pValue} onChange={(e) => setPValue(e.target.value)}
                  style={{ width: 100, textAlign: "right" }}
                />
              </td>
              <td data-label="Category">
                <select value={pCategory} onChange={(e) => setPCategory(e.target.value)}>
                  <option value="">— category —</option>
                  {billCats.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </td>
              <td data-label="Scope">
                <select value={pScope} onChange={(e) => setPScope(e.target.value as BillScope)}>
                  {SCOPES.map((s) => <option key={s} value={s}>{scopeLabel(s)}</option>)}
                </select>
              </td>
              <td data-label="Paid by">
                {pScope === "Common" ? (
                  <select value={pPaidBy} onChange={(e) => setPPaidBy(e.target.value as Person)}>
                    <option value="P1">{p1}</option>
                    <option value="P2">{p2}</option>
                  </select>
                ) : (
                  <span className="pill">{scopeLabel(pScope)}</span>
                )}
              </td>
              <td className="row-form-actions"><button className="primary" onClick={addPayment} disabled={!online}>Add</button></td>
            </tr>
            {payments?.map((p) => (
              <tr key={p.id}>
                <td data-label="Date">{fmtDate(p.date)}</td>
                <td className="num" data-label="Value">{fmtMoney(p.value)}</td>
                <td data-label="Category">{p.category}</td>
                <td data-label="Scope"><span className="pill">{scopeLabel(p.scope)}</span></td>
                <td data-label="Paid by"><span className="pill">{personLabel(p.paidBy)}</span></td>
                <td><button className="ghost danger" onClick={() => deletePayment(p.id, p.category, p.value)} disabled={!online}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {payments?.length === 0 && <div className="empty">No payments registered yet.</div>}
      </div>
    </div>
  );
}
