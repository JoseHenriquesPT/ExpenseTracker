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

const EMPTY_LINK: PlannedLink = { text: "", url: "" };

function withOneRow(links: PlannedLink[]): PlannedLink[] {
  return links.length ? links : [{ ...EMPTY_LINK }];
}

function cleanLinks(links: PlannedLink[]): PlannedLink[] {
  return links
    .map((l) => ({ text: l.text.trim(), url: l.url.trim() }))
    .filter((l) => l.text || l.url);
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
      links: [{ ...EMPTY_LINK }],
      purchased: false,
    });
    setFocusId(id);
  }

  return (
    <div>
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
  const savedKey = JSON.stringify({ name: plan.name, links: plan.links });
  const savedRef = useRef(savedKey);
  const [name, setName] = useState(plan.name);
  const [links, setLinks] = useState<PlannedLink[]>(withOneRow(plan.links));

  // Re-sync from the database when the other person edits the plan, but never
  // clobber a draft that hasn't been saved yet.
  useEffect(() => {
    if (savedRef.current === savedKey) return;
    savedRef.current = savedKey;
    setName(plan.name);
    setLinks(withOneRow(plan.links));
  }, [savedKey, plan.name, plan.links]);

  const cleaned = cleanLinks(links);
  const dirty =
    JSON.stringify({ name: name.trim(), links: cleaned }) !== savedKey;

  async function save() {
    await db.plannedExpenses.put({
      ...plan,
      name: name.trim(),
      links: cleaned,
    });
  }

  async function purchase() {
    if (dirty) await save();
    onPurchase({ ...plan, name: name.trim(), links: cleaned });
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

  function setLink(index: number, patch: Partial<PlannedLink>) {
    setLinks((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));
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
        {plan.links.length > 0 && (
          <div className="plan-links read-only">
            {plan.links.map((l, i) =>
              l.url ? (
                <a key={i} href={l.url} target="_blank" rel="noreferrer">
                  {l.text || l.url}
                </a>
              ) : (
                <span key={i}>{l.text}</span>
              )
            )}
          </div>
        )}
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

      <div className="plan-links">
        {links.map((l, i) => (
          <div className="plan-link-row" key={i}>
            <input
              placeholder="Text"
              value={l.text}
              onChange={(e) => setLink(i, { text: e.target.value })}
              disabled={busy}
            />
            <input
              placeholder="https://…"
              value={l.url}
              onChange={(e) => setLink(i, { url: e.target.value })}
              disabled={busy}
            />
            <button
              className="ghost"
              title="Remove link"
              onClick={() => setLinks(links.filter((_, j) => j !== i))}
              disabled={busy || links.length === 1}
            >
              ✕
            </button>
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
        {dirty && (
          <button
            className="primary"
            onClick={() => run(save)}
            disabled={!online || busy}
          >
            Save
          </button>
        )}
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
