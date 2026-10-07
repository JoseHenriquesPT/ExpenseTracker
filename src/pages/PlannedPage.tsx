import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "../db/live";
import { db } from "../db/db";
import type { Person, PlannedExpense, PlannedLink, Scope } from "../db/types";
import { toISO } from "../lib/finance";
import { fmtMoney, fmtDate } from "../lib/format";
import { personName, scopeName, type PersonNames } from "../lib/labels";
import { purchaseEntry, purchasedPlanPatch } from "../lib/planned";
import { useOnline } from "../lib/useOnline";
import { confirm } from "../lib/confirm";
import { useBusy } from "../lib/useBusy";
import BackHome from "../components/BackHome";

const EMPTY_LINK: PlannedLink = { text: "", url: "" };

function withOneRow(links: PlannedLink[]): PlannedLink[] {
  return links.length ? links : [{ ...EMPTY_LINK }];
}

function cleanLinks(links: PlannedLink[]): PlannedLink[] {
  return links
    .map((l) => ({ text: l.text.trim(), url: l.url.trim() }))
    .filter((l) => l.url);
}

export default function PlannedPage() {
  const online = useOnline();
  const { busy, run } = useBusy();
  const config = useLiveQuery(() => db.config.get({ key: "config" }), []);
  const plans = useLiveQuery(
    () => db.plannedExpenses.orderBy("id").toArray(),
    []
  );
  const [purchasing, setPurchasing] = useState<PlannedExpense | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);

  const names = { p1: config?.p1Name ?? "P1", p2: config?.p2Name ?? "P2" };

  async function addPlan() {
    const id = await db.plannedExpenses.add({
      name: "",
      notes: "",
      links: [{ ...EMPTY_LINK }],
      purchased: false,
    });
    setFocusId(id);
  }

  return (
    <div>
      <BackHome />
      <h2>Planned Expenses</h2>
      <p className="subtitle">
        Things you plan to buy. Add links for ideas, then press <strong>Purchased</strong> when
        you buy it — the final price goes to Common or Individual expenses automatically.
      </p>

      <div className="toolbar">
        <button
          className="primary"
          onClick={() => run(addPlan)}
          disabled={!online || busy}
        >
          + Add planned expense
        </button>
      </div>

      {plans === undefined ? (
        <div className="empty">Loading…</div>
      ) : plans.length === 0 ? (
        <div className="empty">
          No planned expenses yet — add one to start your wishlist.
        </div>
      ) : (
        <div className="plan-grid">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              names={names}
              online={online}
              autoFocusName={plan.id === focusId}
              onPurchase={setPurchasing}
            />
          ))}
        </div>
      )}

      {purchasing && (
        <PurchaseDialog
          plan={purchasing}
          names={names}
          online={online}
          onClose={() => setPurchasing(null)}
        />
      )}
    </div>
  );
}

function PlanCard({
  plan, names, online, autoFocusName, onPurchase,
}: {
  plan: PlannedExpense;
  names: PersonNames;
  online: boolean;
  autoFocusName: boolean;
  onPurchase: (plan: PlannedExpense) => void;
}) {
  const { busy, run } = useBusy();
  const savedKey = JSON.stringify({
    name: plan.name, notes: plan.notes ?? "", links: plan.links,
  });
  const savedRef = useRef(savedKey);
  const [name, setName] = useState(plan.name);
  const [notes, setNotes] = useState(plan.notes ?? "");
  const [links, setLinks] = useState<PlannedLink[]>(withOneRow(plan.links));
  const [editing, setEditing] = useState(autoFocusName);

  // Re-sync from the database when the other person edits the plan, but never
  // clobber a draft that hasn't been saved yet.
  useEffect(() => {
    if (savedRef.current === savedKey) return;
    savedRef.current = savedKey;
    if (!editing) {
      setName(plan.name);
      setNotes(plan.notes ?? "");
      setLinks(withOneRow(plan.links));
    }
  }, [savedKey, editing, plan.name, plan.notes, plan.links]);

  const cleaned = cleanLinks(links);
  const cleanNotes = notes.trim();
  const dirty =
    editing &&
    JSON.stringify({ name: name.trim(), notes: cleanNotes, links: cleaned }) !== savedKey;

  async function save() {
    if (dirty) {
      const trimmed = name.trim();
      await db.plannedExpenses.put({
        ...plan, name: trimmed, notes: cleanNotes, links: cleaned,
      });
      setName(trimmed);
      setNotes(cleanNotes);
      setLinks(withOneRow(cleaned));
    }
    setEditing(false);
  }

  async function purchase() {
    const draft = {
      ...plan, name: name.trim(), notes: cleanNotes, links: cleaned,
    };
    if (dirty) await db.plannedExpenses.put(draft);
    onPurchase(draft);
  }

  async function deletePlan() {
    if (plan.id == null) return;
    const ok = await confirm({
      title: "Delete planned expense",
      message: `Remove “${plan.name || "this planned expense"}”? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await db.plannedExpenses.delete(plan.id);
  }

  function setLink(index: number, url: string) {
    setLinks((ls) => ls.map((l, i) => (i === index ? { ...l, url } : l)));
  }

  if (plan.purchased) {
    const who =
      plan.scope === "Common" && plan.paidBy
        ? `Common · paid by ${personName(plan.paidBy, names)}`
        : scopeName(plan.scope ?? "Common", names);
    return (
      <div className="plan purchased">
        <div className="plan-head">
          <div className="plan-name">{plan.name || "Untitled"}</div>
          <span className="pill purchased-badge">✓ Purchased</span>
        </div>
        <div className="plan-meta">
          <strong>{fmtMoney(plan.finalValue ?? 0)}</strong> · {who} ·{" "}
          {fmtDate(plan.purchasedDate ?? "")}
        </div>
        {plan.notes?.trim() && <p className="plan-notes">{plan.notes}</p>}
        {plan.links.length > 0 && <PlannedLinks links={plan.links} />}
        <div className="plan-actions">
          <button
            className="ghost danger"
            onClick={() => run(deletePlan)}
            disabled={!online || busy}
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="plan collapsed">
        <div className="plan-name">{plan.name || "Untitled planned expense"}</div>
        {plan.notes?.trim() && <p className="plan-notes">{plan.notes}</p>}
        <PlannedLinks links={plan.links} />
        <div className="plan-actions">
          <button onClick={() => setEditing(true)} disabled={busy}>
            Edit
          </button>
          <button onClick={() => run(purchase)} disabled={!online || busy}>
            Purchased
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="plan">
      <input
        className="plan-name-input"
        placeholder="Expense name"
        value={name}
        autoFocus={autoFocusName}
        onChange={(e) => setName(e.target.value)}
        disabled={busy}
      />

      <textarea
        className="plan-notes-input"
        placeholder="Notes — draft anything (optional)"
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        disabled={busy}
      />

      <div className="plan-links">
        {links.map((l, i) => (
          <div className="plan-link-row" key={i}>
            {i > 0 && (
              <button
                className="ghost link-remove"
                title="Remove link"
                onClick={() => setLinks(links.filter((_, j) => j !== i))}
                disabled={busy}
              >
                ✕
              </button>
            )}
            <input
              placeholder="https://…"
              value={l.url}
              onChange={(e) => setLink(i, e.target.value)}
              disabled={busy}
            />
          </div>
        ))}
        <button
          className="ghost add-link"
          onClick={() => setLinks([...links, { ...EMPTY_LINK }])}
          disabled={busy}
        >
          + Add link
        </button>
      </div>

      <div className="plan-actions">
        <button
          className="primary"
          onClick={() => run(save)}
          disabled={busy || (dirty && !online)}
        >
          Save
        </button>
        <button onClick={() => run(purchase)} disabled={!online || busy}>
          Purchased
        </button>
        <button
          className="ghost danger plan-delete"
          onClick={() => run(deletePlan)}
          disabled={!online || busy}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function PlannedLinks({ links }: { links: PlannedLink[] }) {
  const urls = links.filter((l) => l.url);
  if (!urls.length) return null;
  // The box grows with the number of links; an over-long URL is the only thing
  // that gets cut, ending in "…" on its own line.
  return (
    <div className="plan-links read-only">
      {urls.map((l, i) => (
        <a key={i} href={l.url} target="_blank" rel="noreferrer" title={l.url}>
          {l.url}
        </a>
      ))}
    </div>
  );
}

function PurchaseDialog({
  plan, names, online, onClose,
}: {
  plan: PlannedExpense;
  names: PersonNames;
  online: boolean;
  onClose: () => void;
}) {
  const { busy, run } = useBusy();
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<Scope>("Common");
  const [paidBy, setPaidBy] = useState<Person>("P1");

  const num = parseFloat(value);
  const valid = value.trim() !== "" && Number.isFinite(num) && num > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function confirmPurchase() {
    if (!valid) return;
    await run(async () => {
      const input = { value: num, scope, paidBy, date: toISO(new Date()) };
      const target = purchaseEntry(plan, input);
      if (target.table === "expenses") await db.expenses.add(target.row);
      else await db.personalExpenses.add(target.row);
      await db.plannedExpenses.put({ ...plan, ...purchasedPlanPatch(input) });
      onClose();
    });
  }

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal-title">Confirm purchase</h3>
        <p className="modal-message">
          Confirm “{plan.name || "this item"}” was purchased. Enter the final price
          and where the expense should go.
        </p>

        <div className="field-row" style={{ marginBottom: 14 }}>
          <div className="field">
            <label>Final price</label>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Expense type</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
              disabled={busy}
            >
              <option value="Common">Common (shared)</option>
              <option value="P1">{names.p1} (individual)</option>
              <option value="P2">{names.p2} (individual)</option>
            </select>
          </div>
          {scope === "Common" && (
            <div className="field">
              <label>Paid by</label>
              <select
                value={paidBy}
                onChange={(e) => setPaidBy(e.target.value as Person)}
                disabled={busy}
              >
                <option value="P1">{names.p1}</option>
                <option value="P2">{names.p2}</option>
              </select>
            </div>
          )}
        </div>

        <p className="subtitle" style={{ marginBottom: 16 }}>
          {scope === "Common"
            ? "Will be added to Common Expenses and split in the monthly settlement."
            : `Will be added to ${personName(scope, names)}'s Individual Expenses.`}
        </p>

        <div className="modal-actions">
          <button className="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={confirmPurchase}
            disabled={!valid || !online || busy}
          >
            {busy ? "Saving…" : "Confirm purchase"}
          </button>
        </div>
      </div>
    </div>
  );
}
