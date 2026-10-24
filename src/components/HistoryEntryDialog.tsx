import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  Bill,
  ExpenseEntry,
  PersonalExpenseEntry,
  Person,
  Scope,
} from "../db/types";
import { db } from "../db/db";
import {
  saveRecurringOccurrence,
  type EntryChanges,
} from "../db/recurring";
import { SAVINGS_CATEGORY } from "../lib/finance";
import { useOnline } from "../lib/useOnline";
import { useBusy } from "../lib/useBusy";

export type HistoryKind = "common" | "personal" | "savings" | "bill";

/** A History row plus where it actually lives, so edits go back to the right
 *  table without leaking the display-only fields into a database write.
 *  `date` mirrors `entry.date` so the row works with the generic window filter. */
interface HistoryRowBase {
  date: string;
  kind: HistoryKind;
  scope: Scope;
  paidBy: Person;
}

export type HistoryRow =
  | (HistoryRowBase & { source: "expenses"; entry: ExpenseEntry })
  | (HistoryRowBase & { source: "personalExpenses"; entry: PersonalExpenseEntry })
  | (HistoryRowBase & { source: "bills"; entry: Bill });

const SCOPES: Scope[] = ["P1", "P2", "Common"];

/** Edit one History row in place. Bills that belong to a recurring series keep
 *  the one-month / this-and-future choice; all other rows are plain updates. */
export default function HistoryEntryDialog({
  row, categories, p1Name, p2Name, single, hidePaidBy, onClose, onSaved,
}: {
  row: HistoryRow;
  categories: string[];
  p1Name: string;
  p2Name: string;
  single: boolean;
  hidePaidBy: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const { busy, run } = useBusy();

  const isSavings = row.source !== "bills" && !!row.entry.saved;
  const recurring = row.source === "bills" && row.entry.recurringId != null;

  const [date, setDate] = useState(row.entry.date);
  const [value, setValue] = useState(String(row.entry.value));
  const [category, setCategory] = useState(row.entry.category);
  const [description, setDescription] = useState(row.entry.description ?? "");
  const [scope, setScope] = useState<Scope>(
    row.source === "bills" ? row.entry.scope : "Common"
  );
  const [paidBy, setPaidBy] = useState<Person>(row.paidBy);
  const [apply, setApply] = useState<"one" | "future">("one");

  const names = { p1: p1Name, p2: p2Name };
  const scopeLabel = (s: Scope) =>
    s === "Common" ? t("labels.common") : s === "P1" ? p1Name : p2Name;
  const options = categories.includes(row.entry.category)
    ? categories
    : [row.entry.category, ...categories];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function save() {
    const num = parseFloat(value);
    if (!date || isNaN(num) || (!isSavings && !category)) return;

    if (row.source === "expenses") {
      await db.expenses.put({
        ...row.entry,
        date,
        value: num,
        category: isSavings ? SAVINGS_CATEGORY : category,
        description,
        paidBy: single || hidePaidBy ? row.entry.paidBy : paidBy,
      });
    } else if (row.source === "personalExpenses") {
      await db.personalExpenses.put({
        ...row.entry,
        date,
        value: num,
        category: isSavings ? SAVINGS_CATEGORY : category,
        description,
        person: single ? "P1" : paidBy,
      });
    } else {
      const billScope: Scope = single ? "Common" : scope;
      const billPaidBy: Person = single
        ? "P1"
        : billScope === "Common"
        ? paidBy
        : billScope;
      const changes: EntryChanges = {
        date,
        value: num,
        category,
        description,
        scope: billScope,
        paidBy: billPaidBy,
      };
      if (row.entry.recurringId != null) {
        await saveRecurringOccurrence("bill", row.entry, changes, apply);
      } else {
        await db.bills.put({
          ...row.entry,
          date: changes.date,
          value: changes.value,
          category: changes.category,
          description: changes.description,
          scope: changes.scope ?? row.entry.scope,
          paidBy: changes.paidBy ?? row.entry.paidBy,
        });
      }
    }
    onSaved();
  }

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal-title">{t("history.editTitle")}</h3>

        <div className="field-row">
          <div className="field">
            <label>{t("common.table.date")}</label>
            <input
              type="date"
              value={date}
              disabled={busy || (recurring && apply === "future")}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label>{t("common.table.value")}</label>
            <input
              type="number"
              step="0.01"
              value={value}
              disabled={busy}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
        </div>

        <div className="field" style={{ marginTop: 10 }}>
          <label>{t("common.table.category")}</label>
          {isSavings ? (
            <select value={row.entry.category} disabled>
              <option value={row.entry.category}>{row.entry.category}</option>
            </select>
          ) : (
            <select value={category} disabled={busy} onChange={(e) => setCategory(e.target.value)}>
              {options.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>

        {!single && row.source === "expenses" && !hidePaidBy && (
          <div className="field" style={{ marginTop: 10 }}>
            <label>{t("common.table.paidBy")}</label>
            <select
              value={paidBy}
              disabled={busy}
              onChange={(e) => setPaidBy(e.target.value as Person)}
            >
              <option value="P1">{names.p1}</option>
              <option value="P2">{names.p2}</option>
            </select>
          </div>
        )}

        {!single && row.source === "personalExpenses" && (
          <div className="field" style={{ marginTop: 10 }}>
            <label>{t("common.table.person")}</label>
            <select
              value={paidBy}
              disabled={busy}
              onChange={(e) => setPaidBy(e.target.value as Person)}
            >
              <option value="P1">{names.p1}</option>
              <option value="P2">{names.p2}</option>
            </select>
          </div>
        )}

        {!single && row.source === "bills" && (
          <div className="field-row" style={{ marginTop: 10 }}>
            <div className="field">
              <label>{t("common.table.scope")}</label>
              <select
                value={scope}
                disabled={busy}
                onChange={(e) => setScope(e.target.value as Scope)}
              >
                {SCOPES.map((s) => <option key={s} value={s}>{scopeLabel(s)}</option>)}
              </select>
            </div>
            {scope === "Common" && (
              <div className="field">
                <label>{t("common.table.paidBy")}</label>
                <select
                  value={paidBy}
                  disabled={busy}
                  onChange={(e) => setPaidBy(e.target.value as Person)}
                >
                  <option value="P1">{names.p1}</option>
                  <option value="P2">{names.p2}</option>
                </select>
              </div>
            )}
          </div>
        )}

        <div className="field" style={{ marginTop: 10 }}>
          <label>{t("common.table.description")}</label>
          <input
            placeholder={t("common.optional")}
            value={description}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {recurring && (
          <div className="field" style={{ marginTop: 10 }}>
            <label>{t("recurring.applyLabel")}</label>
            <select
              value={apply}
              disabled={busy}
              onChange={(e) => setApply(e.target.value as "one" | "future")}
            >
              <option value="one">{t("recurring.applyThisMonth")}</option>
              <option value="future">{t("recurring.applyFuture")}</option>
            </select>
            {apply === "future" && (
              <p className="subtitle" style={{ margin: "4px 0 0" }}>
                {t("recurring.dateNote")}
              </p>
            )}
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button className="primary" onClick={() => run(save)} disabled={!online || busy}>
            {busy ? t("common.working") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
