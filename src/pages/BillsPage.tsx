import { useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useLiveQuery, useSingleMode } from "../db/live";
import { db } from "../db/db";
import { addRecurringBill, stopRecurringFrom } from "../db/recurring";
import type { Bill, BillScope, Person } from "../db/types";
import { filterByWindow, toISO } from "../lib/finance";
import { fmtMoney, fmtDate } from "../lib/format";
import { personName, scopeName } from "../lib/labels";
import { useOnline } from "../lib/useOnline";
import { confirm } from "../lib/confirm";
import { useBusy } from "../lib/useBusy";
import PeriodFilter, { usePeriodFilter } from "../components/PeriodFilter";
import BackHome from "../components/BackHome";
import EntryEditDialog from "../components/EntryEditDialog";
import RecurringDeleteDialog from "../components/RecurringDeleteDialog";

const SCOPES: BillScope[] = ["P1", "P2", "Common"];

export default function BillsPage() {
  const { t } = useTranslation();
  const online = useOnline();
  const single = useSingleMode();
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
  const [recurring, setRecurring] = useState(false);
  const [editing, setEditing] = useState<Bill | null>(null);
  const [deleting, setDeleting] = useState<Bill | null>(null);

  const billCats = config?.billCategories ?? [];

  // The list filters by period, like the ledger tabs / Dashboard.
  const filter = usePeriodFilter();
  const filtered = useMemo(
    () => filterByWindow(bills ?? [], filter.window),
    [bills, filter.window]
  );
  const total = filtered.reduce((a, b) => a + b.value, 0);

  async function addBill() {
    const num = parseFloat(value);
    if (!date || isNaN(num) || !category) return;
    // For a personal bill the payer is implicitly that person. Single mode has
    // just one person, so every bill is theirs.
    const who: Person = single ? "P1" : scope === "Common" ? paidBy : scope;
    if (recurring) {
      await addRecurringBill({
        date, value: num, category,
        scope: single ? "Common" : scope, paidBy: who, description,
      });
    } else {
      await db.bills.add({
        date, value: num, category,
        scope: single ? "Common" : scope, paidBy: who, description,
      });
    }
    setValue("");
    setDescription("");
    setRecurring(false);
  }

  async function deleteBill(bill: Bill) {
    if (bill.id == null) return;
    if (bill.recurringId != null) {
      setDeleting(bill);
      return;
    }
    const ok = await confirm({
      title: t("bills.deleteTitle"),
      message: t("bills.deleteMessage", {
        amount: fmtMoney(bill.value),
        category: bill.category,
      }),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (ok) await db.bills.delete(bill.id);
  }

  const head = (
    <thead>
      <tr>
        <th>{t("common.table.date")}</th>
        <th className="num">{t("common.table.value")}</th>
        <th>{t("common.table.category")}</th>
        {!single && <th>{t("common.table.scope")}</th>}
        {!single && <th>{t("common.table.paidBy")}</th>}
        <th>{t("common.table.description")}</th>
        <th></th>
      </tr>
    </thead>
  );

  return (
    <div>
      <BackHome />
      <h2>{t("bills.title")}</h2>
      <p className="subtitle">
        {single ? (
          t("bills.subtitleSingle")
        ) : (
          <Trans
            i18nKey="bills.subtitleCouple"
            values={{ p1: names.p1, p2: names.p2 }}
            components={{ strong: <strong /> }}
          />
        )}
      </p>

      {/* ---------------- Add a bill ---------------- */}
      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>{t("bills.addTitle")}</h3>
        <table className="cards-on-mobile">
          {head}
          <tbody>
            <tr className="row-form">
              <td data-label={t("common.table.date")}>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </td>
              <td className="num" data-label={t("common.table.value")}>
                <input
                  type="number" step="0.01" placeholder="0.00"
                  value={value} onChange={(e) => setValue(e.target.value)}
                  style={{ width: 100, textAlign: "right" }}
                />
              </td>
              <td data-label={t("common.table.category")}>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">{t("bills.categoryPlaceholder")}</option>
                  {billCats.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </td>
              {!single && (
                <>
                  <td data-label={t("common.table.scope")}>
                    <select value={scope} onChange={(e) => setScope(e.target.value as BillScope)}>
                      {SCOPES.map((s) => <option key={s} value={s}>{scopeLabel(s)}</option>)}
                    </select>
                  </td>
                  <td data-label={t("common.table.paidBy")}>
                    {scope === "Common" ? (
                      <select value={paidBy} onChange={(e) => setPaidBy(e.target.value as Person)}>
                        <option value="P1">{names.p1}</option>
                        <option value="P2">{names.p2}</option>
                      </select>
                    ) : (
                      <span className="pill">{scopeLabel(scope)}</span>
                    )}
                  </td>
                </>
              )}
              <td data-label={t("common.table.description")}>
                <input
                  placeholder={t("common.optional")}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </td>
              <td className="row-form-actions">
                <button className="primary" onClick={() => run(addBill)} disabled={!online || busy}>
                  {t("common.add")}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <label className="settle-check" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            checked={recurring}
            onChange={(e) => setRecurring(e.target.checked)}
          />
          {t("recurring.repeatMonthly")}
        </label>
        <p className="subtitle" style={{ margin: "2px 0 0" }}>
          {t("recurring.repeatHint")}
        </p>
      </div>

      {/* ---------------- Registered bills (filterable) ---------------- */}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>{t("bills.registeredTitle")}</h3>
        <PeriodFilter state={filter} />
        <p className="subtitle">
          <Trans
            i18nKey="bills.total"
            values={{ amount: fmtMoney(total) }}
            components={{ strong: <strong /> }}
          />
          {" · "}
          {t("bills.count", { count: filtered.length })}
        </p>
        <table className="cards-on-mobile">
          {head}
          <tbody>
            {filtered.map((b) => (
              <tr key={b.id}>
                <td data-label={t("common.table.date")}>{fmtDate(b.date)}</td>
                <td className="num" data-label={t("common.table.value")}>{fmtMoney(b.value)}</td>
                <td data-label={t("common.table.category")}>
                  {b.category}
                  {b.recurringId != null && (
                    <> <span className="pill recurring">{t("recurring.monthlyBadge")}</span></>
                  )}
                </td>
                {!single && (
                  <>
                    <td data-label={t("common.table.scope")}>
                      <span className="pill">{scopeLabel(b.scope)}</span>
                    </td>
                    <td data-label={t("common.table.paidBy")}>
                      <span className="pill">{personLabel(b.paidBy)}</span>
                    </td>
                  </>
                )}
                <td data-label={t("common.table.description")}>{b.description}</td>
                <td>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      className="ghost"
                      title={t("common.edit")}
                      aria-label={t("common.edit")}
                      onClick={() => setEditing(b)}
                      disabled={!online}
                    >
                      ✎
                    </button>
                    <button
                      className="ghost danger"
                      onClick={() => deleteBill(b)}
                      disabled={!online}
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="empty">
            {bills?.length === 0 ? t("bills.emptyNone") : t("bills.emptyPeriod")}
          </div>
        )}
      </div>

      {editing && (
        <EntryEditDialog
          kind="bill"
          row={editing}
          categories={billCats}
          p1Name={names.p1}
          p2Name={names.p2}
          single={single}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}

      {deleting && (
        <RecurringDeleteDialog
          amount={deleting.value}
          category={deleting.category}
          date={deleting.date}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onThisMonth={() =>
            run(async () => {
              if (deleting.id != null) await db.bills.delete(deleting.id);
              setDeleting(null);
            })
          }
          onFuture={() =>
            run(async () => {
              await stopRecurringFrom("bill", deleting);
              setDeleting(null);
            })
          }
        />
      )}
    </div>
  );
}
