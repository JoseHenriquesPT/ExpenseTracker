import { useEffect, useRef, useState } from "react";
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
import BackHome from "../components/BackHome";
import TypedConfirmDialog from "../components/TypedConfirmDialog";

type ListKey = Extract<
  keyof Config,
  "incomeCategories" | "expenseCategories" | "billCategories" | "plannedTags"
>;

const LISTS: { key: ListKey; title: string }[] = [
  { key: "incomeCategories", title: "Income categories" },
  { key: "expenseCategories", title: "Expense categories" },
  { key: "billCategories", title: "Bill categories" },
  { key: "plannedTags", title: "Planned expense areas" },
];

export default function SettingsPage() {
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
        title: "Replace all data",
        message:
          `This replaces every current row with the backup (${describeBackup(data)}). ` +
          "This can't be undone.",
        confirmLabel: "Replace everything",
        danger: true,
      });
      if (!ok) return;
      await importBackup(data);
      await ensureConfig();
      setStatus("Backup imported ✓");
    } catch (e) {
      const message = toMessage(e);
      pushToast(message, "error");
      setStatus("Import failed");
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

  if (!config) return <div className="empty">Loading…</div>;

  return (
    <div>
      <BackHome />
      <h2>Settings</h2>
      <p className="subtitle">
        {household?.kind === "single"
          ? "Edit your name, categories and back up your data."
          : "Edit people, categories and back up your data."}
      </p>

      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Account</h3>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          {email && <span className="subtitle" style={{ margin: 0 }}>{email}</span>}
          <button
            className="ghost"
            style={{ marginLeft: "auto" }}
            onClick={() => supabase.auth.signOut()}
          >
            Sign out
          </button>
        </div>
      </div>

      <HouseholdPanel household={household} online={online} />

      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>
          {household?.kind === "single" ? "Your name" : "People"}
        </h3>
        {household?.kind === "single" ? (
          <div className="field">
            <label>Name shown in the app</label>
            <input
              value={names?.p1 ?? ""}
              onChange={(e) => setNames((d) => ({ p1: e.target.value, p2: d?.p2 ?? "" }))}
              disabled={!online || !names}
            />
          </div>
        ) : (
          <div className="field-row">
            <div className="field">
              <label>Person 1 (P1)</label>
              <input
                value={names?.p1 ?? ""}
                onChange={(e) => setNames((d) => ({ p1: e.target.value, p2: d?.p2 ?? "" }))}
                disabled={!online || !names}
              />
            </div>
            <div className="field">
              <label>Person 2 (P2)</label>
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
            Save
          </button>
          {namesDirty && (
            <span className="subtitle" style={{ margin: 0 }}>Unsaved changes</span>
          )}
        </div>
      </div>

      {household?.kind !== "single" && (
        <SettlementMethodsPanel config={config} online={online} />
      )}

      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Backup</h3>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button className="primary" onClick={() => exportBackup()} disabled={importing}>
            Export JSON
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={!online || importing}>
            {importing ? "Importing…" : "Import JSON"}
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
          Import replaces all current data in the shared database, after validating the
          file and asking for confirmation. Export a copy regularly.
        </p>
      </div>

      <div className="charts">
        {LISTS.map(({ key, title }) => (
          <CategoryEditor
            key={key}
            title={title}
            items={config[key] ?? []}
            disabled={!online}
            onAdd={(v) => addCategory(key, v)}
            onRemove={(v) => removeCategory(key, v)}
          />
        ))}
      </div>

      <div className="panel" style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>Dismantle household</h3>
        <p className="subtitle">
          Breaks up the household. Both members keep their past months' data in
          their own account; everything recorded in the current month is deleted.
        </p>
        <button
          className="danger-solid"
          disabled={!online || dismantling}
          onClick={() => setConfirmingDismantle(true)}
        >
          Dismantle Household
        </button>
      </div>

      <TypedConfirmDialog
        open={confirmingDismantle}
        title="Dismantle household"
        message={
          "This breaks up the household. Both members keep their past months' " +
          "data — each one gets their own copy in a new single-person household — " +
          "but everything recorded in the current month is deleted, for both people. " +
          "This can't be undone."
        }
        phrase="I want to dismantle household"
        confirmLabel="Dismantle Household"
        busyLabel="Dismantling…"
        busy={dismantling}
        onCancel={() => setConfirmingDismantle(false)}
        onConfirm={() => runDismantle(dismantle)}
      />
    </div>
  );
}

function HouseholdPanel({ household, online }: { household: Household | null; online: boolean }) {
  // Both people set: there is nothing left to manage, so the box disappears.
  if (household && household.memberCount >= 2) return null;
  return (
    <div className="panel" style={{ marginBottom: 24 }}>
      <h3 style={{ marginTop: 0 }}>Household</h3>
      <HouseholdBody household={household} online={online} />
    </div>
  );
}

/** One guarded branch per state, in order: no household yet, single (offer the
 *  upgrade), invite/join while alone, otherwise nothing (full households hide
 *  the whole box at {@link HouseholdPanel}). */
function HouseholdBody({ household, online }: { household: Household | null; online: boolean }) {
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
      pushToast("Invite code copied", "success");
    } catch {
      pushToast("Couldn't copy — select the code and copy it manually.", "error");
    }
  }

  if (!household) {
    return <p className="subtitle" style={{ margin: 0 }}>Loading…</p>;
  }

  if (household.kind === "single") {
    return (
      <>
        <p className="subtitle">
          This is a one-person household. Upgrading turns on the P1/P2 split
          and lets you invite a partner.
        </p>
        <button
          className="primary"
          disabled={!online || busy}
          onClick={() => action(upgradeToCouple)}
        >
          {busy ? "Upgrading…" : "Upgrade to a couple household"}
        </button>
      </>
    );
  }

  if (household.memberCount >= 2) {
    return (
      <p className="subtitle" style={{ margin: 0 }}>
        Two members — your household is full.
      </p>
    );
  }

  if (invites === undefined) {
    return <p className="subtitle" style={{ margin: 0 }}>Loading…</p>;
  }

  return (
    <>
      <p className="subtitle">
        Invite your partner: send them the code. They can enter it on the
        welcome screen or here in Settings.
      </p>
      {invites.length === 0 ? (
        <button
          className="primary"
          disabled={!online || busy}
          onClick={() => action(async () => { await createInvite(); })}
        >
          {busy ? "Creating…" : "Create invite code"}
        </button>
      ) : (
        <div className="tag-list">
          {invites.map((inv) => (
            <span key={inv.id} className="tag">
              <code>{inv.code}</code>
              <button onClick={() => copy(inv.code)} title="Copy">Copy</button>
              <button
                onClick={() => action(() => revokeInvite(inv.id))}
                title="Revoke"
                disabled={!online || busy}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="field" style={{ marginTop: 16 }}>
        <label>Got a code from your partner? Join their household instead</label>
        <div className="toolbar" style={{ marginTop: 4, marginBottom: 0 }}>
          <input
            value={joinCode}
            placeholder="Invite code"
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
            {joining ? "Joining…" : "Join"}
          </button>
        </div>
        <p className="subtitle" style={{ margin: "6px 0 0" }}>
          Your entries move with you and are tagged P2 — your partner stays P1.
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
  const [draft, setDraft] = useState("");
  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div className="tag-list" style={{ marginBottom: 12 }}>
        {items.map((c) => (
          <span key={c} className="tag">
            {c}
            <button onClick={() => onRemove(c)} title="Remove" disabled={disabled}>✕</button>
          </span>
        ))}
        {items.length === 0 && <span className="subtitle">None yet.</span>}
      </div>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <input
          placeholder="New category"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { onAdd(draft); setDraft(""); }
          }}
        />
        <button onClick={() => { onAdd(draft); setDraft(""); }} disabled={disabled}>Add</button>
      </div>
    </div>
  );
}

/** How the shared pool is divided: income-proportional (the original model) or
 *  a custom percentage for P1, controlled by the slider. Hidden in single mode
 *  by the caller — there is no shared pool to divide. */
function SettlementMethodsPanel({ config, online }: { config: Config; online: boolean }) {
  const { busy: saving, run: runSave } = useBusy();
  // Tolerate rows written before migration 0015 (columns absent).
  const storedMethod: SettlementMethod = config.settlementMethod ?? "proportional";
  const storedShare = config.customShareP1 ?? 50;
  const [draft, setDraft] = useState<{ method: SettlementMethod; shareP1: number } | null>(null);

  // Seed from the stored config, and re-sync when it changes *unless* there
  // are unsaved edits (don't clobber) — same pattern as the name editor.
  useEffect(() => {
    setDraft((d) =>
      d && (d.method !== storedMethod || d.shareP1 !== storedShare)
        ? d
        : { method: storedMethod, shareP1: storedShare }
    );
  }, [storedMethod, storedShare]);

  const dirty =
    !!draft && (draft.method !== storedMethod || draft.shareP1 !== storedShare);

  async function save() {
    if (config.id == null || !draft || !dirty) return;
    await db.config.put({
      ...config,
      settlementMethod: draft.method,
      customShareP1: draft.shareP1,
    });
  }

  const shareP1 = draft?.shareP1 ?? storedShare;
  const isCustom = draft?.method === "custom";

  function pick(method: SettlementMethod) {
    setDraft((d) => ({ method, shareP1: d?.shareP1 ?? storedShare }));
  }

  return (
    <div className="panel" style={{ marginBottom: 24 }}>
      <h3 style={{ marginTop: 0 }}>Settlement methods</h3>
      <p className="subtitle">How the shared pool is divided at the end of a period.</p>

      <div className="choice-row" role="group" aria-label="Settlement method">
        <button
          type="button"
          className={draft?.method === "proportional" ? "choice active" : "choice"}
          aria-pressed={draft?.method === "proportional"}
          disabled={!online || !draft}
          onClick={() => pick("proportional")}
        >
          Proportional Effort Split
        </button>
        <button
          type="button"
          className={draft?.method === "custom" ? "choice active" : "choice"}
          aria-pressed={draft?.method === "custom"}
          disabled={!online || !draft}
          onClick={() => pick("custom")}
        >
          Custom Split
        </button>
      </div>

      <div className="split-slider">
        <label>
          {config.p1Name} pays {shareP1}% · {config.p2Name} pays {100 - shareP1}%
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
            setDraft((d) => ({ method: d?.method ?? "custom", shareP1: share }));
          }}
        />
        <p className="subtitle" style={{ margin: "4px 0 12px" }}>
          {isCustom
            ? "Each person pays exactly their chosen percentage of the shared pool."
            : "Each person pays their share of the household income (50/50 when no income is recorded)."}
        </p>
      </div>

      <div className="toolbar" style={{ marginBottom: 0 }}>
        <button
          className="primary"
          disabled={!online || !dirty || saving}
          onClick={() => runSave(save)}
        >
          Save
        </button>
        {dirty && <span className="subtitle" style={{ margin: 0 }}>Unsaved changes</span>}
      </div>
    </div>
  );
}
