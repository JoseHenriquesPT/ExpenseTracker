import { useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useLiveQuery, useSingleMode } from "../db/live";
import { db } from "../db/db";
import { stopRecurringFrom } from "../db/recurring";
import { filterByWindow } from "../lib/finance";
import { fmtMoney, fmtDate } from "../lib/format";
import { modeText, monthName, personName, scopeName } from "../lib/labels";
import { useOnline } from "../lib/useOnline";
import { confirm } from "../lib/confirm";
import { useBusy } from "../lib/useBusy";
import PeriodFilter, { usePeriodFilter } from "../components/PeriodFilter";
import BackHome from "../components/BackHome";
import HistoryEntryDialog, {
  type HistoryKind,
  type HistoryRow,
} from "../components/HistoryEntryDialog";
import RecurringDeleteDialog from "../components/RecurringDeleteDialog";

type KindFilter = "all" | HistoryKind;

const KIND_KEYS = {
  personal: "history.kind.personal",
  savings: "history.kind.savings",
  bill: "history.kind.bill",
} as const;

/** Every expense-side entry in one list: common/individual spending, savings
 *  and bills — savings included because they're where investments now live. */
export default function HistoryPage() {
  const { t } = useTranslation();
  const single = useSingleMode();
  const labels = modeText(single);
  const online = useOnline();
  const { busy, run } = useBusy();
  const config = useLiveQuery(() => db.config.get({ key: "config" }), []);
  const expenses = useLiveQuery(() => db.expenses.toArray(), []);
  const personal = useLiveQuery(() => db.personalExpenses.toArray(), []);
  const bills = useLiveQuery(() => db.bills.toArray(), []);

  const names = { p1: config?.p1Name ?? "P1", p2: config?.p2Name ?? "P2" };
  const filter = usePeriodFilter();
  const [kind, setKind] = useState<KindFilter>("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<HistoryRow | null>(null);
  const [deleting, setDeleting] = useState<HistoryRow | null>(null);

  const all = useMemo<HistoryRow[]>(() => {
    if (!expenses || !personal || !bills) return [];
    const rows: HistoryRow[] = [
      ...expenses.map((entry): HistoryRow => ({
        source: "expenses",
        entry,
        date: entry.date,
        kind: entry.saved ? "savings" : "common",
        scope: "Common",
        paidBy: entry.paidBy,
      })),
      ...personal.map((entry): HistoryRow => ({
        source: "personalExpenses",
        entry,
        date: entry.date,
        kind: entry.saved ? "savings" : "personal",
        scope: entry.person,
        paidBy: entry.person,
      })),
      ...bills.map((entry): HistoryRow => ({
        source: "bills",
        entry,
        date: entry.date,
        kind: "bill",
        scope: entry.scope,
        paidBy: entry.paidBy,
      })),
    ];
    return rows.sort((a, b) =>
      a.entry.date !== b.entry.date
        ? (a.entry.date < b.entry.date ? 1 : -1)
        : (b.entry.id ?? 0) - (a.entry.id ?? 0)
    );
  }, [expenses, personal, bills]);

  const categories = useMemo(
    () => [...new Set(all.map((r) => r.entry.category))].sort((a, b) => a.localeCompare(b)),
    [all]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return filterByWindow(all, filter.window).filter((r) => {
      if (kind !== "all" && r.kind !== kind) return false;
      if (category !== "all" && r.entry.category !== category) return false;
      if (
        q &&
        !`${r.entry.category} ${r.entry.description ?? ""}`.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [all, filter.window, kind, category, query]);

  // Newest first — the sort above makes map insertion order month-descending.
  const months = useMemo(() => {
    const map = new Map<string, HistoryRow[]>();
    for (const r of filtered) {
      const key = r.entry.date.slice(0, 7);
      const list = map.get(key);
      if (list) list.push(r);
      else map.set(key, [r]);
    }
    return [...map.entries()];
  }, [filtered]);

  const total = filtered.reduce((a, r) => a + r.entry.value, 0);

  async function remove(r: HistoryRow) {
    const id = r.entry.id;
    if (id == null) return;
    if (r.source === "bills" && r.entry.recurringId != null) {
      setDeleting(r);
      return;
    }
    const label = r.kind === "savings"
      ? t("ledger.savingsLabel", { amount: fmtMoney(r.entry.value) })
      : `${r.entry.category} — ${fmtMoney(r.entry.value)}`;
    const ok = await confirm({
      title: t("ledger.deleteTitle"),
      message: r.entry.description
        ? t("ledger.deleteMessageDesc", { label, desc: r.entry.description })
        : t("ledger.deleteMessage", { label }),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    if (r.source === "expenses") await db.expenses.delete(id);
    else if (r.source === "personalExpenses") await db.personalExpenses.delete(id);
    else await db.bills.delete(id);
  }

  return (
    <div>
      <BackHome />
      <h2>{t("history.title")}</h2>
      <p className="subtitle">{t("history.subtitle")}</p>

      <PeriodFilter state={filter} />

      <div className="toolbar">
        <select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
          <option value="all">{t("history.allTypes")}</option>
          <option value="common">{labels.expenses}</option>
          {!single && <option value="personal">{t("history.individualOption")}</option>}
          <option value="savings">{t("history.savingsOption")}</option>
          <option value="bill">{t("history.billsOption")}</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">{t("history.allCategories")}</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input
          placeholder={t("history.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ minWidth: 200 }}
        />
        <span className="subtitle" style={{ margin: 0 }}>
          <Trans
            i18nKey="history.total"
            values={{ amount: fmtMoney(total) }}
            components={{ strong: <strong /> }}
          />
          {" · "}
          {t("history.count", { count: filtered.length })}
        </span>
      </div>

      {months.length === 0 ? (
        <div className="empty">
          {all.length === 0 ? t("history.emptyNone") : t("history.emptyFiltered")}
        </div>
      ) : (
        months.map(([key, rows]) => {
          const [y, m] = key.split("-").map(Number);
          const monthTotal = rows.reduce((a, r) => a + r.entry.value, 0);
          return (
            <section key={key} className="history-month">
              <div className="history-month-head">
                <h3>{monthName(m)} {y}</h3>
                <span className="history-month-total">
                  {fmtMoney(monthTotal)} · {t("history.count", { count: rows.length })}
                </span>
              </div>
              <table className="cards-on-mobile">
                <thead>
                  <tr>
                    <th>{t("common.table.date")}</th>
                    <th>{t("common.table.type")}</th>
                    <th>{t("common.table.category")}</th>
                    {!single && <th>{t("common.table.scope")}</th>}
                    {!single && <th>{t("common.table.paidBy")}</th>}
                    <th className="num">{t("common.table.value")}</th>
                    <th>{t("common.table.description")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.source}-${r.entry.id}`}>
                      <td data-label={t("common.table.date")}>{fmtDate(r.entry.date)}</td>
                      <td data-label={t("common.table.type")}>
                        <span className={r.kind === "savings" ? "pill savings" : "pill"}>
                          {r.kind === "common" ? labels.expenseKind : t(KIND_KEYS[r.kind])}
                        </span>
                      </td>
                      <td data-label={t("common.table.category")}>{r.entry.category}</td>
                      {!single && (
                        <>
                          <td data-label={t("common.table.scope")}>
                            <span className="pill">{scopeName(r.scope, names)}</span>
                          </td>
                          <td data-label={t("common.table.paidBy")}>
                            <span className="pill">{personName(r.paidBy, names)}</span>
                          </td>
                        </>
                      )}
                      <td className="num" data-label={t("common.table.value")}>
                        {fmtMoney(r.entry.value)}
                      </td>
                      <td data-label={t("common.table.description")}>{r.entry.description}</td>
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
                          <button
                            className="ghost danger"
                            title={t("common.delete")}
                            aria-label={t("common.delete")}
                            onClick={() => remove(r)}
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
            </section>
          );
        })
      )}

      {editing && (
        <HistoryEntryDialog
          row={editing}
          categories={
            editing.source === "bills"
              ? config?.billCategories ?? []
              : config?.expenseCategories ?? []
          }
          p1Name={names.p1}
          p2Name={names.p2}
          single={single}
          hidePaidBy={config?.hidePaidBy ?? false}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}

      {deleting?.source === "bills" && deleting.entry.recurringId != null && (
        <RecurringDeleteDialog
          amount={deleting.entry.value}
          category={deleting.entry.category}
          date={deleting.entry.date}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onThisMonth={() =>
            run(async () => {
              if (deleting.entry.id != null) await db.bills.delete(deleting.entry.id);
              setDeleting(null);
            })
          }
          onFuture={() =>
            run(async () => {
              await stopRecurringFrom("bill", deleting.entry);
              setDeleting(null);
            })
          }
        />
      )}
    </div>
  );
}
