import { useEffect, useRef, useState } from "react";
import { useHousehold, useLiveQuery } from "../db/live";
import { db, ensureConfig } from "../db/db";
import { supabase } from "../db/supabase";
import {
  createInvite, listInvites, revokeInvite, upgradeToCouple,
} from "../db/onboarding";
import type { Config } from "../db/types";
import { exportBackup, importBackup, parseBackupFile } from "../lib/backup";
import { describeBackup } from "../lib/backupSchema";
import { confirm } from "../lib/confirm";
import { pushToast } from "../lib/toast";
import { useBusy } from "../lib/useBusy";
import { useOnline } from "../lib/useOnline";
import BackHome from "../components/BackHome";

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
  const invites = useLiveQuery(
    () => listInvites(),
    [household?.id, household?.memberCount]
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [email, setEmail] = useState("");
  const { busy: importing, run: runImport } = useBusy();
  const { busy: savingNames, run: runSaveNames } = useBusy();
  const { busy: householdBusy, run: runHousehold } = useBusy();
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  /** Run a household action with double-submit guard + error toast. */
  function runHouseholdAction(fn: () => Promise<void>) {
    return runHousehold(async () => {
      try {
        await fn();
      } catch (e) {
        pushToast(e instanceof Error ? e.message : String(e), "error");
      }
    });
  }

  async function copyInvite(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      pushToast("Invite code copied", "success");
    } catch {
      pushToast("Couldn't copy — select the code and copy it manually.", "error");
    }
  }

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
      const message = e instanceof Error ? e.message : String(e);
      pushToast(message, "error");
      setStatus("Import failed");
    } finally {
      // Allow re-selecting the same file next time.
      if (fileRef.current) fileRef.current.value = "";
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

      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Household</h3>
        {!household ? (
          <p className="subtitle" style={{ margin: 0 }}>Loading…</p>
        ) : household.kind === "single" ? (
          <>
            <p className="subtitle">
              This is a one-person household. Upgrading turns on the P1/P2 split
              and lets you invite a partner.
            </p>
            <button
              className="primary"
              disabled={!online || householdBusy}
              onClick={() => runHouseholdAction(upgradeToCouple)}
            >
              {householdBusy ? "Upgrading…" : "Upgrade to a couple household"}
            </button>
          </>
        ) : household.memberCount >= 2 ? (
          <p className="subtitle" style={{ margin: 0 }}>
            Two members — your household is full.
          </p>
        ) : (
          <>
            <p className="subtitle">
              Invite your partner: send them the code, and they choose
              “Join” on the welcome screen.
            </p>
            {invites === undefined ? (
              <p className="subtitle" style={{ margin: 0 }}>Loading…</p>
            ) : invites.length === 0 ? (
              <button
                className="primary"
                disabled={!online || householdBusy}
                onClick={() => runHouseholdAction(async () => { await createInvite(); })}
              >
                {householdBusy ? "Creating…" : "Create invite code"}
              </button>
            ) : (
              <div className="tag-list">
                {invites.map((inv) => (
                  <span key={inv.id} className="tag">
                    <code>{inv.code}</code>
                    <button onClick={() => copyInvite(inv.code)} title="Copy">
                      Copy
                    </button>
                    <button
                      onClick={() => runHouseholdAction(() => revokeInvite(inv.id))}
                      title="Revoke"
                      disabled={!online || householdBusy}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

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
    </div>
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
