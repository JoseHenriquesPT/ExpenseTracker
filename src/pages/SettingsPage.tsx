import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "../db/live";
import { db, ensureConfig } from "../db/db";
import type { Config } from "../db/types";
import { exportBackup, importBackup } from "../lib/backup";
import { useOnline } from "../lib/useOnline";

type ListKey = Extract<
  keyof Config,
  "incomeCategories" | "expenseCategories" | "billCategories" | "investmentCategories"
>;

const LISTS: { key: ListKey; title: string }[] = [
  { key: "incomeCategories", title: "Income categories" },
  { key: "expenseCategories", title: "Expense categories" },
  { key: "billCategories", title: "Bill categories" },
  { key: "investmentCategories", title: "Investment categories" },
];

export default function SettingsPage() {
  const online = useOnline();
  const config = useLiveQuery(() => db.config.get({ key: "config" }), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");

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
    if (config[key].includes(value)) return;
    await db.config.put({ ...config, [key]: [...config[key], value] });
  }

  async function removeCategory(key: ListKey, value: string) {
    if (!config?.id) return;
    await db.config.put({
      ...config,
      [key]: config[key].filter((c) => c !== value),
    });
  }

  async function onImport(file?: File) {
    if (!file) return;
    try {
      await importBackup(file);
      await ensureConfig();
      setStatus("Backup imported ✓");
    } catch (e) {
      setStatus("Import failed: " + (e as Error).message);
    }
  }

  if (!config) return <div className="empty">Loading…</div>;

  return (
    <div>
      <h2>Settings</h2>
      <p className="subtitle">Edit people, categories and back up your data.</p>

      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>People</h3>
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
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <button className="primary" onClick={saveNames} disabled={!online || !namesDirty}>
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
          <button className="primary" onClick={() => exportBackup()}>Export JSON</button>
          <button onClick={() => fileRef.current?.click()} disabled={!online}>Import JSON</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={(e) => onImport(e.target.files?.[0])}
          />
          {status && <span className="subtitle" style={{ margin: 0 }}>{status}</span>}
        </div>
        <p className="subtitle" style={{ marginBottom: 0 }}>
          Import replaces all current data. Export regularly — everything lives only in this browser.
        </p>
      </div>

      <div className="charts">
        {LISTS.map(({ key, title }) => (
          <CategoryEditor
            key={key}
            title={title}
            items={config[key]}
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
