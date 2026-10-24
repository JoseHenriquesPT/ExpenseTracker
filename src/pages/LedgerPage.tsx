import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { useLiveQuery, useSingleMode } from "../db/live";
import { db, type SupaTable } from "../db/db";
import { addRecurringIncome, stopRecurringFrom } from "../db/recurring";
import type { Entry, ExpenseEntry, IncomeEntry, Person } from "../db/types";
import { filterByWindow, SAVINGS_CATEGORY } from "../lib/finance";
import { modeText, monthName, personName } from "../lib/labels";
import { fmtMoney, fmtDate } from "../lib/format";
import { dateForPeriod } from "../lib/period";
import { useOnline } from "../lib/useOnline";
import { confirm } from "../lib/confirm";
import { useBusy } from "../lib/useBusy";
import PeriodFilter, { usePeriodFilter } from "../components/PeriodFilter";
import BackHome from "../components/BackHome";
import EntryEditDialog from "../components/EntryEditDialog";
import RecurringDeleteDialog from "../components/RecurringDeleteDialog";

type Kind = "expenses" | "income" | "personalExpenses";
type EntryMode = "expense" | "savings";

// Short labels for the subtab switcher (when a page groups several kinds).
const SUBTAB_KEYS = {
  expenses: "ledger.subtab.common",
  income: "ledger.subtab.income",
  personalExpenses: "ledger.subtab.individual",
} as const;

const NOTE_KEYS = {
  expenses: "ledger.noteExpenses",
  income: "ledger.noteIncome",
  personalExpenses: "ledger.notePersonal",
} as const;

/** Single-mode overrides: there is no "Common" counterpart to distinguish. */
const SINGLE_NOTE_KEYS = {
  ...NOTE_KEYS,
  expenses: "ledger.noteSingleExpenses",
  income: "ledger.noteSingleIncome",
} as const;

type Row = Entry &
  Partial<Pick<ExpenseEntry, "paidBy" | "saved">> &
  Partial<Pick<IncomeEntry, "person" | "recurringId">>;

export default function LedgerPage({ tabs }: { tabs: Kind[] }) {
  const { t } = useTranslation();
  // The active subtab drives everything; defaults to the first tab (Common for
  // the merged Expenses page). A single-tab page just hides the switcher.
  const [kind, setKind] = useState<Kind>(tabs[0]);
  const [entryMode, setEntryMode] = useState<EntryMode>("expense");
  const single = useSingleMode();
  const labels = modeText(single);
  // A one-person household has no Individual ledger: that subtab disappears.
  // `kind` starts at tabs[0] and is only ever set from the visible buttons, so
  // it always names a visible ledger.
  const visibleTabs = single
    ? tabs.filter((tab) => tab !== "personalExpenses")
    : tabs;

  const isExpense = kind === "expenses";
  const isIncome = kind === "income";
  const isPersonal = kind === "personalExpenses";
  const canSave = isExpense || isPersonal;
  const isSavings = canSave && entryMode === "savings";
  const pageTitle = visibleTabs.length > 1
    ? t("ledger.titleCombined")
    : isIncome
    ? t("ledger.titleIncome")
    : isPersonal
    ? t("ledger.titleIndividual")
    : labels.expenses;
  const online = useOnline();
  const { busy, run } = useBusy();
  // The month selected anywhere in the app also seeds new entries, so a past
  // month can be filled in without changing the date by hand each time.
  const filter = usePeriodFilter();

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

  const [date, setDate] = useState(() => dateForPeriod(filter));
  const [value, setValue] = useState("");
  const [category, setCategory] = useState("");
  const [person, setPerson] = useState<Person | null>(null);
  const [description, setDescription] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);

  useEffect(() => {
    setDate(dateForPeriod(filter));
  }, [filter.mode, filter.month, filter.year]);

  async function add() {
    const num = parseFloat(value);
    if (!date || isNaN(num)) return;
    // In single mode everything belongs to the one person, no picker needed.
    // With Paid By dropped there is no choice to make either — default to P1.
    const who: Person | null = single || dropPaidBy ? "P1" : person;
    if (isExpense) {
      if (!who) return;
      if (isSavings) {
        await db.expenses.add({
          date, value: num, category: SAVINGS_CATEGORY, paidBy: who, description, saved: true,
        });
      } else {
        if (!category) return;
        await db.expenses.add({ date, value: num, category, paidBy: who, description });
      }
    } else if (isPersonal) {
      if (!who) return;
      if (isSavings) {
        await db.personalExpenses.add({
          date, value: num, category: SAVINGS_CATEGORY, person: who, description, saved: true,
        });
      } else {
        if (!category) return;
        await db.personalExpenses.add({ date, value: num, category, person: who, description });
      }
    } else {
      if (!category) return;
      const incomePerson = single ? "P1" : who ?? "P1";
      if (recurring) {
        await addRecurringIncome({
          date, value: num, category, person: incomePerson, description,
        });
      } else {
        await db.income.add({
          date, value: num, category, person: incomePerson, description,
        });
      }
    }
    setValue("");
    setDescription("");
    setRecurring(false);
  }

  async function remove(r: Row) {
    if (r.id == null) return;
    if (isIncome && r.recurringId != null) {
      setDeleting(r);
      return;
    }
    const label = r.saved
      ? t("ledger.savingsLabel", { amount: fmtMoney(r.value) })
      : `${r.category} — ${fmtMoney(r.value)}`;
    const ok = await confirm({
      title: t("ledger.deleteTitle"),
      message: r.description
        ? t("ledger.deleteMessageDesc", { label, desc: r.description })
        : t("ledger.deleteMessage", { label }),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (ok) await db[kind].delete(r.id);
  }

  // The registered-entries list filters by period, just like the Dashboard.
  const filtered = useMemo(
    () => filterByWindow(rows ?? [], filter.window),
    [rows, filter.window]
  );

  const total = filtered.reduce((acc, r) => acc + r.value, 0);

  // Expenses/Savings show a short latest list for the selected period; the
  // History page is where the full record lives.
  const recent = useMemo(() => {
    if (!canSave) return [];
    return filterByWindow(rows ?? [], filter.window)
      .sort((a, b) =>
        a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b.id ?? 0) - (a.id ?? 0)
      )
      .slice(0, 5);
  }, [rows, canSave, filter.window]);

  // Income, Common Expenses and Individual Expenses all attribute to a person.
  const personColTitle = isExpense ? t("common.table.paidBy") : t("common.table.person");
  // "Remove Paid By from expenses" (Settings, under No settlement): the picker
  // and its column vanish from the common-expense ledger; new rows go to P1.
  const dropPaidBy = isExpense && !single && (config?.hidePaidBy ?? false);
  const showPersonCol = !single && !dropPaidBy;

  // Column headers — shared by the "Add" form table and the list table.
  const head = (
    <thead>
      <tr>
        <th>{t("common.table.date")}</th>
        <th className="num">{t("common.table.value")}</th>
        <th>{t("common.table.category")}</th>
        {showPersonCol && <th>{personColTitle}</th>}
        <th>{t("common.table.description")}</th>
        <th></th>
      </tr>
    </thead>
  );

  return (
    <div>
      <BackHome />
      <h2>{pageTitle}</h2>
      {visibleTabs.length > 1 && (
        <div className="segmented" style={{ marginBottom: 12 }}>
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              className={kind === tab ? "seg active" : "seg"}
              onClick={() => {
                setKind(tab);
                setEntryMode("expense");
              }}
            >
              {t(SUBTAB_KEYS[tab])}
            </button>
          ))}
        </div>
      )}
      <p className="subtitle">{t((single ? SINGLE_NOTE_KEYS : NOTE_KEYS)[kind])}</p>

      {/* ---------------- Add a new entry ---------------- */}
      <div className="panel" style={{ marginBottom: 24 }}>
        <div className="form-head">
          <h3 style={{ margin: 0 }}>{t("ledger.addTitle")}</h3>
          {canSave && (
            <div className="segmented">
              {([["expense", t("ledger.modeExpense")], ["savings", t("ledger.modeSavings")]] as
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
              <td data-label={t("common.table.date")}>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </td>
              <td className="num" data-label={t("common.table.value")}>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  style={{ width: 100, textAlign: "right" }}
                />
              </td>
              <td data-label={t("common.table.category")}>
                {isSavings ? (
                  <span className="pill savings">{t("ledger.savingsPill")}</span>
                ) : (
                  <select value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">{t("ledger.categoryPlaceholder")}</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}
              </td>
              {showPersonCol && (
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
                    <div className="choice-row" role="group" aria-label={personColTitle}>
                      {people.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={person === p.id ? "choice active" : "choice"}
                          aria-pressed={person === p.id}
                          onClick={() => setPerson(p.id)}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </td>
              )}
              <td data-label={t("common.table.description")}>
                <input
                  placeholder={t("common.optional")}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </td>
              <td className="row-form-actions">
                <button className="primary" onClick={() => run(add)} disabled={!online || busy}>
                  {t("common.add")}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        {isIncome && (
          <>
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
          </>
        )}
      </div>

      {/* ---------------- Registered entries ---------------- */}
      {isIncome ? (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>{t("ledger.registeredTitle")}</h3>
          <PeriodFilter state={filter} />
          <p className="subtitle">
            <Trans
              i18nKey="ledger.total"
              values={{ amount: fmtMoney(total) }}
              components={{ strong: <strong /> }}
            />
            {" · "}
            {t("ledger.count", { count: filtered.length })}
          </p>
          <table className="cards-on-mobile">
            {head}
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td data-label={t("common.table.date")}>{fmtDate(r.date)}</td>
                  <td className="num" data-label={t("common.table.value")}>{fmtMoney(r.value)}</td>
                  <td data-label={t("common.table.category")}>
                    {r.category}
                    {r.recurringId != null && (
                      <> <span className="pill recurring">{t("recurring.monthlyBadge")}</span></>
                    )}
                  </td>
                  {showPersonCol && (
                    <td data-label={personColTitle}>
                      <span className="pill">{personLabel(r.paidBy ?? r.person)}</span>
                    </td>
                  )}
                  <td data-label={t("common.table.description")}>{r.description}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="ghost"
                        title={t("common.edit")}
                        aria-label={t("common.edit")}
                        onClick={() => setEditing(r)}
                        disabled={!online}
                      >
                        ✎
                      </button>
                      <button className="ghost danger" onClick={() => remove(r)} disabled={!online}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="empty">
              {rows?.length === 0 ? t("ledger.emptyNone") : t("ledger.emptyPeriod")}
            </div>
          )}
        </div>
      ) : (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>{t("ledger.latestTitle")}</h3>
          <p className="subtitle">
            {filter.mode === "monthly" ? (
              <Trans
                i18nKey="ledger.latestNote"
                values={{ month: monthName(filter.month), year: filter.year }}
                components={{ history: <Link to="/history" className="link-more" /> }}
              />
            ) : filter.mode === "annual" ? (
              <Trans
                i18nKey="ledger.latestNoteYear"
                values={{ year: filter.year }}
                components={{ history: <Link to="/history" className="link-more" /> }}
              />
            ) : (
              <Trans
                i18nKey="ledger.latestNoteAll"
                components={{ history: <Link to="/history" className="link-more" /> }}
              />
            )}
          </p>
          <table className="cards-on-mobile">
            {head}
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td data-label={t("common.table.date")}>{fmtDate(r.date)}</td>
                  <td className="num" data-label={t("common.table.value")}>{fmtMoney(r.value)}</td>
                  <td data-label={t("common.table.category")}>
                    {r.saved ? <span className="pill savings">{t("ledger.savingsPill")}</span> : r.category}
                  </td>
                  {showPersonCol && (
                    <td data-label={personColTitle}>
                      <span className="pill">{personLabel(r.paidBy ?? r.person)}</span>
                    </td>
                  )}
                  <td data-label={t("common.table.description")}>{r.description}</td>
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
                ? t("ledger.emptyNone")
                : t("ledger.emptyPeriod")}
            </div>
          )}
        </div>
      )}

      {editing && isIncome && (
        <EntryEditDialog
          kind="income"
          row={editing}
          categories={categories}
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
              if (deleting.id != null) await db.income.delete(deleting.id);
              setDeleting(null);
            })
          }
          onFuture={() =>
            run(async () => {
              await stopRecurringFrom("income", {
                ...deleting,
                person: deleting.person ?? "P1",
              } as IncomeEntry);
              setDeleting(null);
            })
          }
        />
      )}
    </div>
  );
}
