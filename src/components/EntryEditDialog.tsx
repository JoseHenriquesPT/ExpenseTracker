import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Bill, IncomeEntry, Person, Scope } from "../db/types";
import { saveRecurringOccurrence, type EntryChanges, type RecurringKind } from "../db/recurring";
import { useOnline } from "../lib/useOnline";
import { useBusy } from "../lib/useBusy";

export interface EditableEntry {
  id?: number;
  date: string;
  value: number;
  category: string;
  description?: string;
  person?: Person;
  scope?: Scope;
  paidBy?: Person;
  recurringId?: number;
}

const SCOPES: Scope[] = ["P1", "P2", "Common"];

/** Edit one income/bill row. A recurring row can be changed for this month only
 *  or from this month onward; the date always applies to this month only, so
 *  the series keeps its anchor day. */
export default function EntryEditDialog({
  kind, row, categories, p1Name, p2Name, single, onClose, onSaved,
}: {
  kind: RecurringKind;
  row: EditableEntry;
  categories: string[];
  p1Name: string;
  p2Name: string;
  single: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const { busy, run } = useBusy();

  const [date, setDate] = useState(row.date);
  const [value, setValue] = useState(String(row.value));
  const [category, setCategory] = useState(row.category);
  const [description, setDescription] = useState(row.description ?? "");
  const [person, setPerson] = useState<Person>(row.person ?? "P1");
  const [scope, setScope] = useState<Scope>(row.scope ?? "Common");
  const [paidBy, setPaidBy] = useState<Person>(row.paidBy ?? "P1");
  const [apply, setApply] = useState<"one" | "future">("one");

  const recurring = row.recurringId != null;
  const names = { p1: p1Name, p2: p2Name };
  const scopeLabel = (s: Scope) =>
    s === "Common" ? t("labels.common") : s === "P1" ? p1Name : p2Name;
  const options = categories.includes(row.category)
    ? categories
    : [row.category, ...categories];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function save() {
    const num = parseFloat(value);
    if (!date || isNaN(num) || !category) return;
    const changes: EntryChanges = { date, value: num, category, description };
    if (kind === "income") {
      changes.person = single ? "P1" : person;
    } else {
      changes.scope = single ? "Common" : scope;
      changes.paidBy = single ? "P1" : paidBy;
    }
    const entry: IncomeEntry | Bill = kind === "income"
      ? { ...row, person: changes.person ?? "P1" } as IncomeEntry
      : {
          ...row,
          scope: changes.scope ?? "Common",
          paidBy: changes.paidBy ?? "P1",
        } as Bill;
    await saveRecurringOccurrence(kind, entry, changes, apply);
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
        <h3 className="modal-title">{t("recurring.editTitle")}</h3>

        <div className="field-row">
          <div className="field">
            <label>{t("common.table.date")}</label>
            <input
              type="date"
              value={date}
              disabled={busy || apply === "future"}
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
          <select value={category} disabled={busy} onChange={(e) => setCategory(e.target.value)}>
            {options.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {!single && kind === "income" && (
          <div className="field" style={{ marginTop: 10 }}>
            <label>{t("common.table.person")}</label>
            <select
              value={person}
              disabled={busy}
              onChange={(e) => setPerson(e.target.value as Person)}
            >
              <option value="P1">{names.p1}</option>
              <option value="P2">{names.p2}</option>
            </select>
          </div>
        )}

        {!single && kind === "bill" && (
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
