import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHousehold, useLiveQuery } from "../db/live";
import { db, ensureConfig } from "../db/db";
import { supabase } from "../db/supabase";
import {
  createInvite, dismantleHousehold, listInvites, mergeIntoHousehold,
  revokeInvite, upgradeToCouple,
} from "../db/householdApi";
import type { Household } from "../db/household";
import type { Config, SettlementMethod } from "../db/types";
import { exportBackup, importBackup, parseBackupFile } from "../lib/backup";
import { describeBackup } from "../lib/backupSchema";
import { confirm } from "../lib/confirm";
import { toMessage } from "../lib/errors";
import { pushToast } from "../lib/toast";
import { useBusy } from "../lib/useBusy";
import { useOnline } from "../lib/useOnline";
import { LANGUAGES, currentLanguage, setLanguage } from "../i18n";
import { currencyChoices, setCurrency, useCurrency } from "../lib/currency";
import BackHome from "../components/BackHome";
import TypedConfirmDialog from "../components/TypedConfirmDialog";

type ListKey = Extract<
  keyof Config,
  "incomeCategories" | "expenseCategories" | "billCategories" | "plannedTags"
>;

const LISTS = [
  { key: "incomeCategories", titleKey: "settings.lists.income" },
  { key: "expenseCategories", titleKey: "settings.lists.expense" },
  { key: "billCategories", titleKey: "settings.lists.bill" },
  { key: "plannedTags", titleKey: "settings.lists.planned" },
] as const;

export default function SettingsPage() {
  const { t } = useTranslation();
  const online = useOnline();
  const config = useLiveQuery(() => db.config.get({ key: "config" }), []);
  const household = useHousehold();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [email, setEmail] = useState("");
  const [confirmingDismantle, setConfirmingDismantle] = useState(false);
  const { busy: importing, run: runImport } = useBusy();
  const { busy: savingNames, run: runSaveNames } = useBusy();
  const { busy: dismantling, run: runDismantle } = useBusy();
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  // Person names are edited locally and committed with the Save button — typing
  // no longer fires a DB write per keystroke. Seed from config, and re-sync when
  // the stored names change *unless* there are unsaved edits (don't clobber).
  const [names, setNames] = useState<{ p1: string; p2: string } | null>(null);
  useEffect(() => {
    if (!config) return;
    setNames((d) =>
      d && (d.p1 !== config.p1Name || d.p2 !== config.p2Name)
        ? d
        : { p1: config.p1Name, p2: config.p2Name }
    );
  }, [config?.p1Name, config?.p2Name]);

  const namesDirty =
    !!config && !!names && (names.p1 !== config.p1Name || names.p2 !== config.p2Name);

  async function saveNames() {
    if (!config?.id || !names || !namesDirty) return;
    await db.config.put({ ...config, p1Name: names.p1, p2Name: names.p2 });
  }

  async function addCategory(key: ListKey, raw: string) {
    const value = raw.trim();
    if (!config?.id || !value) return;
    // ?? [] tolerates rows from before migration 0011 added plannedTags.
    const items = config[key] ?? [];
    if (items.includes(value)) return;
    await db.config.put({ ...config, [key]: [...items, value] });
  }

  async function removeCategory(key: ListKey, value: string) {
    if (!config?.id) return;
    await db.config.put({
      ...config,
      [key]: (config[key] ?? []).filter((c) => c !== value),
    });
  }

  async function onImport(file?: File) {
    if (!file) return;
    try {
      // Validate first so a wrong file can't wipe anything, then ask.
      const data = await parseBackupFile(file);
      const ok = await confirm({
        title: t("settings.backup.confirmTitle"),
        message: t("settings.backup.confirmMessage", { summary: describeBackup(data) }),
        confirmLabel: t("settings.backup.confirmLabel"),
        danger: true,
      });
      if (!ok) return;
      await importBackup(data);
      await ensureConfig();
      setStatus(t("settings.backup.imported"));
    } catch (e) {
      const message = toMessage(e);
      pushToast(message, "error");
      setStatus(t("settings.backup.failed"));
    } finally {
      // Allow re-selecting the same file next time.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function dismantle() {
    try {
      await dismantleHousehold();
      setConfirmingDismantle(false);
    } catch (e) {
      pushToast(toMessage(e), "error");
    }
  }

  const activeLanguage = currentLanguage();
  const activeCurrency = useCurrency();
  const currencyLabel = (code: string) =>
    code === "EUR"
      ? t("settings.currency.eur")
      : code === "PLN"
        ? t("settings.currency.pln")
        : code;

  if (!config) return <div className="empty">{t("common.loading")}</div>;

  return (
    <div>
      <BackHome />
      <h2>{t("settings.title")}</h2>
      <p className="subtitle">
        {household?.kind === "single"
          ? t("settings.subtitleSingle")
          : t("settings.subtitleCouple")}
      </p>

      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>{t("settings.language.title")}</h3>
        <div className="choice-row" role="group" aria-label={t("settings.language.title")}>
          {LANGUAGES.map((code) => (
            <button
              key={code}
              type="button"
              className={activeLanguage === code ? "choice active" : "choice"}
              aria-pressed={activeLanguage === code}
              lang={code === "pt" ? "pt-PT" : code}
              onClick={() => void setLanguage(code)}
            >
              {t(`settings.language.${code}`)}
            </button>
          ))}
        </div>
        <p className="subtitle" style={{ marginBottom: 0 }}>
          {t("settings.language.subtitle")}
        </p>
      </div>

      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>{t("settings.currency.title")}</h3>
        <div className="choice-row" role="group" aria-label={t("settings.currency.title")}>
          {currencyChoices().map((code) => (
            <button
              key={code}
              type="button"
              className={activeCurrency === code ? "choice active" : "choice"}
              aria-pressed={activeCurrency === code}
              onClick={() => setCurrency(code)}
            >
              {currencyLabel(code)}
            </button>
          ))}
        </div>
        <p className="subtitle" style={{ marginBottom: 0 }}>
          {t("settings.currency.subtitle")}
        </p>
      </div>

      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>{t("settings.account.title")}</h3>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          {email && <span className="subtitle" style={{ margin: 0 }}>{email}</span>}
          <button
            className="ghost"
            style={{ marginLeft: "auto" }}
            onClick={() => supabase.auth.signOut()}
          >
            {t("settings.account.signOut")}
          </button>
        </div>
      </div>

      <HouseholdPanel household={household} online={online} />

      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>
          {household?.kind === "single"
            ? t("settings.names.singleTitle")
            : t("settings.names.coupleTitle")}
        </h3>
        {household?.kind === "single" ? (
          <div className="field">
            <label>{t("settings.names.singleLabel")}</label>
            <input
              value={names?.p1 ?? ""}
              onChange={(e) => setNames((d) => ({ p1: e.target.value, p2: d?.p2 ?? "" }))}
              disabled={!online || !names}
            />
          </div>
        ) : (
          <div className="field-row">
            <div className="field">
              <label>{t("settings.names.p1")}</label>
              <input
                value={names?.p1 ?? ""}
                onChange={(e) => setNames((d) => ({ p1: e.target.value, p2: d?.p2 ?? "" }))}
                disabled={!online || !names}
              />
            </div>
            <div className="field">
              <label>{t("settings.names.p2")}</label>
              <input
                value={names?.p2 ?? ""}
                onChange={(e) => setNames((d) => ({ p1: d?.p1 ?? "", p2: e.target.value }))}
                disabled={!online || !names}
              />
            </div>
          </div>
        )}
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <button
            className="primary"
            onClick={() => runSaveNames(saveNames)}
            disabled={!online || !namesDirty || savingNames}
          >
            {t("common.save")}
          </button>
          {namesDirty && (
            <span className="subtitle" style={{ margin: 0 }}>{t("common.unsavedChanges")}</span>
          )}
        </div>
      </div>

      {household?.kind !== "single" && (
        <SettlementMethodsPanel config={config} online={online} />
      )}

      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>{t("settings.backup.title")}</h3>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button className="primary" onClick={() => exportBackup()} disabled={importing}>
            {t("settings.backup.export")}
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={!online || importing}>
            {importing ? t("settings.backup.importing") : t("settings.backup.import")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={(e) => runImport(() => onImport(e.target.files?.[0]))}
          />
          {status && <span className="subtitle" style={{ margin: 0 }}>{status}</span>}
        </div>
        <p className="subtitle" style={{ marginBottom: 0 }}>
          {t("settings.backup.note")}
        </p>
      </div>

      <div className="charts">
        {LISTS.map(({ key, titleKey }) => (
          <CategoryEditor
            key={key}
            title={t(titleKey)}
            items={config[key] ?? []}
            disabled={!online}
            onAdd={(v) => addCategory(key, v)}
            onRemove={(v) => removeCategory(key, v)}
          />
        ))}
      </div>

      <div className="panel" style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>{t("settings.dismantle.title")}</h3>
        <p className="subtitle">{t("settings.dismantle.desc")}</p>
        <button
          className="danger-solid"
          disabled={!online || dismantling}
          onClick={() => setConfirmingDismantle(true)}
        >
          {t("settings.dismantle.button")}
        </button>
      </div>

      <TypedConfirmDialog
        open={confirmingDismantle}
        title={t("settings.dismantle.title")}
        message={t("settings.dismantle.confirmMessage")}
        phrase={t("settings.dismantle.phrase")}
        confirmLabel={t("settings.dismantle.button")}
        busyLabel={t("settings.dismantle.busy")}
        busy={dismantling}
        onCancel={() => setConfirmingDismantle(false)}
        onConfirm={() => runDismantle(dismantle)}
      />
    </div>
  );
}

function HouseholdPanel({ household, online }: { household: Household | null; online: boolean }) {
  const { t } = useTranslation();
  // Both people set: there is nothing left to manage, so the box disappears.
  if (household && household.memberCount >= 2) return null;
  return (
    <div className="panel" style={{ marginBottom: 24 }}>
      <h3 style={{ marginTop: 0 }}>{t("settings.household.title")}</h3>
      <HouseholdBody household={household} online={online} />
    </div>
  );
}

/** One guarded branch per state, in order: no household yet, single (offer the
 *  upgrade), invite/join while alone, otherwise nothing (full households hide
 *  the whole box at {@link HouseholdPanel}). */
function HouseholdBody({ household, online }: { household: Household | null; online: boolean }) {
  const { t } = useTranslation();
  const invites = useLiveQuery(
    () => listInvites(),
    [household?.id, household?.memberCount]
  );
  const { busy, run } = useBusy();
  const [joinCode, setJoinCode] = useState("");
  const { busy: joining, run: runJoin } = useBusy();

  /** Run a household action with double-submit guard + error toast. */
  function action(fn: () => Promise<void>) {
    return run(async () => {
      try {
        await fn();
      } catch (e) {
        pushToast(toMessage(e), "error");
      }
    });
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      pushToast(t("settings.household.copied"), "success");
    } catch {
      pushToast(t("settings.household.copyFailed"), "error");
    }
  }

  if (!household) {
    return <p className="subtitle" style={{ margin: 0 }}>{t("common.loading")}</p>;
  }

  if (household.kind === "single") {
    return (
      <>
        <p className="subtitle">{t("settings.household.singleDesc")}</p>
        <button
          className="primary"
          disabled={!online || busy}
          onClick={() => action(upgradeToCouple)}
        >
          {busy ? t("settings.household.upgrading") : t("settings.household.upgrade")}
        </button>
      </>
    );
  }

  if (household.memberCount >= 2) {
    return (
      <p className="subtitle" style={{ margin: 0 }}>
        {t("settings.household.full")}
      </p>
    );
  }

  if (invites === undefined) {
    return <p className="subtitle" style={{ margin: 0 }}>{t("common.loading")}</p>;
  }

  return (
    <>
      <p className="subtitle">{t("settings.household.inviteDesc")}</p>
      {invites.length === 0 ? (
        <button
          className="primary"
          disabled={!online || busy}
          onClick={() => action(async () => { await createInvite(); })}
        >
          {busy ? t("settings.household.creating") : t("settings.household.createInvite")}
        </button>
      ) : (
        <div className="tag-list">
          {invites.map((inv) => (
            <span key={inv.id} className="tag">
              <code>{inv.code}</code>
              <button onClick={() => copy(inv.code)} title={t("settings.household.copy")}>
                {t("settings.household.copy")}
              </button>
              <button
                onClick={() => action(() => revokeInvite(inv.id))}
                title={t("settings.household.revoke")}
                disabled={!online || busy}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="field" style={{ marginTop: 16 }}>
        <label>{t("settings.household.joinLabel")}</label>
        <div className="toolbar" style={{ marginTop: 4, marginBottom: 0 }}>
          <input
            value={joinCode}
            placeholder={t("auth.onboarding.invitePlaceholder")}
            disabled={!online || joining}
            onChange={(e) => setJoinCode(e.target.value)}
          />
          <button
            className="primary"
            disabled={!online || joining || !joinCode.trim()}
            onClick={() =>
              runJoin(async () => {
                try {
                  await mergeIntoHousehold(joinCode);
                  setJoinCode("");
                } catch (e) {
                  pushToast(toMessage(e), "error");
                }
              })
            }
          >
            {joining ? t("settings.household.joining") : t("settings.household.join")}
          </button>
        </div>
        <p className="subtitle" style={{ margin: "6px 0 0" }}>
          {t("settings.household.joinNote")}
        </p>
      </div>
    </>
  );
}

function CategoryEditor({
  title, items, disabled, onAdd, onRemove,
}: {
  title: string;
  items: string[];
  disabled?: boolean;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div className="tag-list" style={{ marginBottom: 12 }}>
        {items.map((c) => (
          <span key={c} className="tag">
            {c}
            <button onClick={() => onRemove(c)} title={t("common.remove")} disabled={disabled}>
              ✕
            </button>
          </span>
        ))}
        {items.length === 0 && <span className="subtitle">{t("settings.category.none")}</span>}
      </div>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <input
          placeholder={t("settings.category.new")}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { onAdd(draft); setDraft(""); }
          }}
        />
        <button onClick={() => { onAdd(draft); setDraft(""); }} disabled={disabled}>
          {t("common.add")}
        </button>
      </div>
    </div>
  );
}

/** How the shared pool is divided: income-proportional or
 *  a custom percentage for P1, controlled by the slider. Hidden in single mode
 *  by the caller — there is no shared pool to divide. */
function SettlementMethodsPanel({ config, online }: { config: Config; online: boolean }) {
  const { t } = useTranslation();
  const { busy: saving, run: runSave } = useBusy();
  // Tolerate rows written before migrations 0015/0016 (columns absent).
  const storedMethod: SettlementMethod = config.settlementMethod ?? "proportional";
  const storedShare = config.customShareP1 ?? 50;
  const storedHidePaidBy = config.hidePaidBy ?? false;
  const [draft, setDraft] = useState<{
    method: SettlementMethod; shareP1: number; hidePaidBy: boolean;
  } | null>(null);

  // Seed from the stored config, and re-sync when it changes *unless* there
  // are unsaved edits (don't clobber) — same pattern as the name editor.
  useEffect(() => {
    setDraft((d) =>
      d &&
      (d.method !== storedMethod ||
        d.shareP1 !== storedShare ||
        d.hidePaidBy !== storedHidePaidBy)
        ? d
        : { method: storedMethod, shareP1: storedShare, hidePaidBy: storedHidePaidBy }
    );
  }, [storedMethod, storedShare, storedHidePaidBy]);

  const dirty =
    !!draft &&
    (draft.method !== storedMethod ||
      draft.shareP1 !== storedShare ||
      draft.hidePaidBy !== storedHidePaidBy);

  async function save() {
    if (config.id == null || !draft || !dirty) return;
    await db.config.put({
      ...config,
      settlementMethod: draft.method,
      customShareP1: draft.shareP1,
      hidePaidBy: draft.hidePaidBy,
    });
  }

  const shareP1 = draft?.shareP1 ?? storedShare;
  const hidePaidBy = draft?.hidePaidBy ?? storedHidePaidBy;
  const isCustom = draft?.method === "custom";
  const isNone = draft?.method === "none";

  function pick(method: SettlementMethod) {
    setDraft((d) => ({
      method,
      shareP1: d?.shareP1 ?? storedShare,
      hidePaidBy: d?.hidePaidBy ?? storedHidePaidBy,
    }));
  }

  return (
    <div className="panel" style={{ marginBottom: 24 }}>
      <h3 style={{ marginTop: 0 }}>{t("settings.settlement.title")}</h3>
      <p className="subtitle">{t("settings.settlement.subtitle")}</p>

      <div className="choice-row" role="group" aria-label={t("settings.settlement.title")}>
        <button
          type="button"
          className={draft?.method === "proportional" ? "choice active" : "choice"}
          aria-pressed={draft?.method === "proportional"}
          disabled={!online || !draft}
          onClick={() => pick("proportional")}
        >
          {t("settings.settlement.proportional")}
        </button>
        <button
          type="button"
          className={draft?.method === "custom" ? "choice active" : "choice"}
          aria-pressed={draft?.method === "custom"}
          disabled={!online || !draft}
          onClick={() => pick("custom")}
        >
          {t("settings.settlement.custom")}
        </button>
        <button
          type="button"
          className={draft?.method === "none" ? "choice active" : "choice"}
          aria-pressed={draft?.method === "none"}
          disabled={!online || !draft}
          onClick={() => pick("none")}
        >
          {t("settings.settlement.none")}
        </button>
      </div>

      {isNone ? (
        <label className="settle-check">
          <input
            type="checkbox"
            checked={hidePaidBy}
            disabled={!online || !draft}
            onChange={(e) =>
              setDraft((d) => ({
                method: d?.method ?? "none",
                shareP1: d?.shareP1 ?? storedShare,
                hidePaidBy: e.target.checked,
              }))
            }
          />
          {t("settings.settlement.hidePaidBy")}
        </label>
      ) : (
        <div className="split-slider">
          <label>
            {t("settings.settlement.splitLabel", {
              p1: config.p1Name,
              p2: config.p2Name,
              p1Pct: shareP1,
              p2Pct: 100 - shareP1,
            })}
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={shareP1}
            disabled={!online || !isCustom}
            onChange={(e) => {
              const share = Number(e.target.value);
              setDraft((d) => ({
                method: d?.method ?? "custom",
                shareP1: share,
                hidePaidBy: d?.hidePaidBy ?? storedHidePaidBy,
              }));
            }}
          />
          <p className="subtitle" style={{ margin: "4px 0 12px" }}>
            {isCustom
              ? t("settings.settlement.customNote")
              : t("settings.settlement.proportionalNote")}
          </p>
        </div>
      )}

      <div className="toolbar" style={{ marginBottom: 0 }}>
        <button
          className="primary"
          disabled={!online || !dirty || saving}
          onClick={() => runSave(save)}
        >
          {t("common.save")}
        </button>
        {dirty && (
          <span className="subtitle" style={{ margin: 0 }}>{t("common.unsavedChanges")}</span>
        )}
      </div>
    </div>
  );
}
