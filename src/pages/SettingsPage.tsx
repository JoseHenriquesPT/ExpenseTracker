import { useRef, useState } from "react";
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

  async function renamePerson(which: "p1Name" | "p2Name", value: string) {
    if (!config?.id) return;
    await db.config.put({ ...config, [which]: value });
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
              value={config.p1Name}
              onChange={(e) => renamePerson("p1Name", e.target.value)}
              disabled={!online}
            />
          </div>
          <div className="field">
            <label>Person 2 (P2)</label>
            <input
              value={config.p2Name}
              onChange={(e) => renamePerson("p2Name", e.target.value)}
              disabled={!online}
            />
          </div>
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
