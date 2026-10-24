import { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useLiveQuery, useSingleMode } from "../db/live";
import { db } from "../db/db";
import type { Person, PlannedExpense, PlannedLink, Scope } from "../db/types";
import { dateForPeriod } from "../lib/period";
import { fmtMoney, fmtDate } from "../lib/format";
import { personName, scopeName, type PersonNames } from "../lib/labels";
import { purchaseEntry, purchasedPlanPatch } from "../lib/planned";
import { availableTags, filterByTags, toggleTag } from "../lib/plannedTags";
import { safeUrl } from "../lib/links";
import { useOnline } from "../lib/useOnline";
import { confirm } from "../lib/confirm";
import { useBusy } from "../lib/useBusy";
import BackHome from "../components/BackHome";
import { usePeriodFilter } from "../components/PeriodFilter";

const EMPTY_LINK: PlannedLink = { text: "", url: "" };

function withOneRow(links: PlannedLink[]): PlannedLink[] {
  return links.length ? links : [{ ...EMPTY_LINK }];
}

function cleanLinks(links: PlannedLink[]): PlannedLink[] {
  return links
    .map((l) => ({ text: l.text.trim(), url: l.url.trim() }))
    .filter((l) => l.url && safeUrl(l.url));
}

export default function PlannedPage() {
  const { t } = useTranslation();
  const online = useOnline();
  const single = useSingleMode();
  const { busy, run } = useBusy();
  const config = useLiveQuery(() => db.config.get({ key: "config" }), []);
  const plans = useLiveQuery(
    () => db.plannedExpenses.orderBy("id").toArray(),
    []
  );
  const [purchasing, setPurchasing] = useState<PlannedExpense | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const names = { p1: config?.p1Name ?? "P1", p2: config?.p2Name ?? "P2" };
  const configuredTags = useMemo(
    () => config?.plannedTags ?? [],
    [config?.plannedTags]
  );
  // Chips to offer: configured tags in use, plus stale tags still on plans.
  const offered = useMemo(
    () => availableTags(plans ?? [], configuredTags),
    [plans, configuredTags]
  );
  const visible = useMemo(
    () => filterByTags(plans ?? [], selectedTags),
    [plans, selectedTags]
  );

  async function addPlan() {
    const id = await db.plannedExpenses.add({
      name: "",
      notes: "",
      links: [{ ...EMPTY_LINK }],
      tags: [],
      purchased: false,
    });
    setFocusId(id);
  }

  return (
    <div>
      <BackHome />
      <h2>{t("planned.title")}</h2>
      <p className="subtitle">
        <Trans
          i18nKey="planned.subtitle"
          values={{
            target: single ? t("planned.targetSingle") : t("planned.targetCouple"),
          }}
          components={{ strong: <strong /> }}
        />
      </p>

      <div className="toolbar">
        <button
          className="primary"
          onClick={() => run(addPlan)}
          disabled={!online || busy}
        >
          {t("planned.add")}
        </button>
        {offered.length > 0 && (
          <div className="choice-row plan-filter">
            <button
              className={"choice" + (selectedTags.length === 0 ? " active" : "")}
              aria-pressed={selectedTags.length === 0}
              onClick={() => setSelectedTags([])}
            >
              {t("planned.all")}
            </button>
            {offered.map((tag) => (
              <button
                key={tag}
                className={"choice" + (selectedTags.includes(tag) ? " active" : "")}
                aria-pressed={selectedTags.includes(tag)}
                onClick={() => setSelectedTags((s) => toggleTag(s, tag))}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {plans === undefined ? (
        <div className="empty">{t("common.loading")}</div>
      ) : plans.length === 0 ? (
        <div className="empty">{t("planned.emptyNone")}</div>
      ) : visible.length === 0 ? (
        <div className="empty">{t("planned.emptyFiltered")}</div>
      ) : (
        <div className="plan-grid">
          {visible.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              names={names}
              online={online}
              allTags={configuredTags}
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
  plan, names, online, allTags, autoFocusName, onPurchase,
}: {
  plan: PlannedExpense;
  names: PersonNames;
  online: boolean;
  allTags: string[];
  autoFocusName: boolean;
  onPurchase: (plan: PlannedExpense) => void;
}) {
  const { t } = useTranslation();
  const { busy, run } = useBusy();
  const single = useSingleMode();
  const savedTags = [...(plan.tags ?? [])].sort();
  const savedKey = JSON.stringify({
    name: plan.name, notes: plan.notes ?? "", links: plan.links, tags: savedTags,
  });
  const savedRef = useRef(savedKey);
  const [name, setName] = useState(plan.name);
  const [notes, setNotes] = useState(plan.notes ?? "");
  const [links, setLinks] = useState<PlannedLink[]>(withOneRow(plan.links));
  const [tags, setTags] = useState<string[]>(savedTags);
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
      setTags([...(plan.tags ?? [])].sort());
    }
  }, [savedKey, editing, plan.name, plan.notes, plan.links, plan.tags]);

  const cleaned = cleanLinks(links);
  const cleanNotes = notes.trim();
  const cleanTags = [...tags].sort();
  const dirty =
    editing &&
    JSON.stringify({ name: name.trim(), notes: cleanNotes, links: cleaned, tags: cleanTags }) !== savedKey;

  // Tags the picker offers: everything configured, plus any stale tag still
  // assigned to this plan so it can be removed here.
  const pickableTags = [
    ...allTags,
    ...tags.filter((tag) => !allTags.includes(tag)),
  ];

  async function save() {
    if (dirty) {
      const trimmed = name.trim();
      await db.plannedExpenses.put({
        ...plan, name: trimmed, notes: cleanNotes, links: cleaned, tags: cleanTags,
      });
      setName(trimmed);
      setNotes(cleanNotes);
      setLinks(withOneRow(cleaned));
      setTags(cleanTags);
    }
    setEditing(false);
  }

  async function purchase() {
    const draft = {
      ...plan, name: name.trim(), notes: cleanNotes, links: cleaned, tags: cleanTags,
    };
    if (dirty) await db.plannedExpenses.put(draft);
    onPurchase(draft);
  }

  async function deletePlan() {
    if (plan.id == null) return;
    const ok = await confirm({
      title: t("planned.deleteTitle"),
      message: t("planned.deleteMessage", {
        name: plan.name || t("planned.unnamed"),
      }),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (ok) await db.plannedExpenses.delete(plan.id);
  }

  function setLink(index: number, url: string) {
    setLinks((ls) => ls.map((l, i) => (i === index ? { ...l, url } : l)));
  }

  if (plan.purchased) {
    // Single mode has no routing to show — the purchase is just yours.
    const who = single
      ? null
      : plan.scope === "Common" && plan.paidBy
      ? t("planned.paidByCommon", { name: personName(plan.paidBy, names) })
      : scopeName(plan.scope ?? "Common", names);
    return (
      <div className="plan purchased">
        <div className="plan-head">
          <div className="plan-name">{plan.name || t("planned.untitled")}</div>
          <span className="pill purchased-badge">{t("planned.purchasedBadge")}</span>
        </div>
        <div className="plan-meta">
          <strong>{fmtMoney(plan.finalValue ?? 0)}</strong>
          {who && <> · {who}</>} · {fmtDate(plan.purchasedDate ?? "")}
        </div>
        {(plan.tags ?? []).length > 0 && (
          <div className="plan-tags">
            {plan.tags.map((tag) => (
              <span key={tag} className="pill">{tag}</span>
            ))}
          </div>
        )}
        {plan.notes?.trim() && <p className="plan-notes">{plan.notes}</p>}
        {plan.links.length > 0 && <PlannedLinks links={plan.links} />}
        <div className="plan-actions">
          <button
            className="ghost danger"
            onClick={() => run(deletePlan)}
            disabled={!online || busy}
          >
            {t("common.delete")}
          </button>
        </div>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="plan collapsed">
        <div className="plan-name">{plan.name || t("planned.untitledPlan")}</div>
        {(plan.tags ?? []).length > 0 && (
          <div className="plan-tags">
            {plan.tags.map((tag) => (
              <span key={tag} className="pill">{tag}</span>
            ))}
          </div>
        )}
        {plan.notes?.trim() && <p className="plan-notes">{plan.notes}</p>}
        <PlannedLinks links={plan.links} />
        <div className="plan-actions">
          <button onClick={() => setEditing(true)} disabled={busy}>
            {t("planned.edit")}
          </button>
          <button onClick={() => run(purchase)} disabled={!online || busy}>
            {t("planned.purchased")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="plan">
      <input
        className="plan-name-input"
        placeholder={t("planned.namePlaceholder")}
        value={name}
        autoFocus={autoFocusName}
        onChange={(e) => setName(e.target.value)}
        disabled={busy}
      />

      <textarea
        className="plan-notes-input"
        placeholder={t("planned.notesPlaceholder")}
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        disabled={busy}
      />

      {pickableTags.length > 0 ? (
        <div className="choice-row">
          {pickableTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={"choice" + (tags.includes(tag) ? " active" : "")}
              aria-pressed={tags.includes(tag)}
              onClick={() => setTags((s) => toggleTag(s, tag))}
              disabled={busy}
            >
              {tag}
            </button>
          ))}
        </div>
      ) : (
        <p className="plan-tags-hint">{t("planned.tagsHint")}</p>
      )}

      <div className="plan-links">
        {links.map((l, i) => (
          <div className="plan-link-row" key={i}>
            {i > 0 && (
              <button
                className="ghost link-remove"
                title={t("planned.removeLink")}
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
          {t("planned.addLink")}
        </button>
      </div>

      <div className="plan-actions">
        <button
          className="primary"
          onClick={() => run(save)}
          disabled={busy || (dirty && !online)}
        >
          {t("common.save")}
        </button>
        <button onClick={() => run(purchase)} disabled={!online || busy}>
          {t("planned.purchased")}
        </button>
        <button
          className="ghost danger plan-delete"
          onClick={() => run(deletePlan)}
          disabled={!online || busy}
        >
          {t("common.delete")}
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
      {urls.map((l, i) => {
        // Only http/https/mailto ever become an anchor; anything else (old
        // data, a crafted backup) shows as plain text, never as href.
        const href = safeUrl(l.url);
        return href ? (
          <a key={i} href={href} target="_blank" rel="noreferrer" title={l.url}>
            {l.url}
          </a>
        ) : (
          <span key={i} title={l.url}>
            {l.url}
          </span>
        );
      })}
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
  const { t } = useTranslation();
  const { busy, run } = useBusy();
  const single = useSingleMode();
  const filter = usePeriodFilter();
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
      // Single mode books the purchase to the one person's Expenses ledger.
      const effScope: Scope = single ? "Common" : scope;
      const effPaidBy: Person = single ? "P1" : paidBy;
      const input = {
        value: num, scope: effScope, paidBy: effPaidBy, date: dateForPeriod(filter),
      };
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
        <h3 className="modal-title">{t("planned.confirmTitle")}</h3>
        <p className="modal-message">
          {t("planned.confirmMessage", {
            name: plan.name || t("planned.unnamedItem"),
          })}
        </p>

        <div className="field-row" style={{ marginBottom: 14 }}>
          <div className="field">
            <label>{t("planned.finalPrice")}</label>
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
          {!single && (
            <>
              <div className="field" style={{ flex: 1 }}>
                <label>{t("planned.expenseType")}</label>
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value as Scope)}
                  disabled={busy}
                >
                  <option value="Common">{t("planned.scopeCommon")}</option>
                  <option value="P1">
                    {t("planned.scopeIndividual", { name: names.p1 })}
                  </option>
                  <option value="P2">
                    {t("planned.scopeIndividual", { name: names.p2 })}
                  </option>
                </select>
              </div>
              {scope === "Common" && (
                <div className="field">
                  <label>{t("planned.paidBy")}</label>
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
            </>
          )}
        </div>

        <p className="subtitle" style={{ marginBottom: 16 }}>
          {single
            ? t("planned.destSingle")
            : scope === "Common"
            ? t("planned.destCommon")
            : t("planned.destPerson", { name: personName(scope, names) })}
        </p>

        <div className="modal-actions">
          <button className="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button
            className="primary"
            onClick={confirmPurchase}
            disabled={!valid || !online || busy}
          >
            {busy ? t("planned.saving") : t("planned.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
