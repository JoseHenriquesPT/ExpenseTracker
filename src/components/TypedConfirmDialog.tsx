import { useEffect, useState } from "react";

/**
 * Destructive confirmation that requires typing an exact phrase. Built for
 * actions too dangerous for a simple Yes/No — the confirm button stays off
 * until the phrase matches, forcing a deliberate pause.
 */
export default function TypedConfirmDialog({
  open, title, message, phrase, confirmLabel, busyLabel = "Working…", busy = false,
  onCancel, onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  /** The exact text the user must type (ignoring surrounding spaces). */
  phrase: string;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (open) setText("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  const matches = text.trim() === phrase;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal-title">{title}</h3>
        <p className="modal-message">{message}</p>
        <input
          autoFocus
          value={text}
          placeholder={phrase}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches && !busy) onConfirm();
          }}
        />
        <p className="subtitle" style={{ marginTop: 8 }}>
          Type <strong>{phrase}</strong> to confirm.
        </p>
        <div className="modal-actions">
          <button className="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="danger" disabled={!matches || busy} onClick={onConfirm}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
