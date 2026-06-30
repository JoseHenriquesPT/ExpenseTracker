import { useEffect } from "react";
import { useConfirm, resolveConfirm } from "../lib/confirm";

/** Single global confirmation modal, driven by the confirm() store. */
export default function ConfirmDialog() {
  const req = useConfirm();

  // Esc cancels, Enter confirms while the dialog is open.
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resolveConfirm(false);
      else if (e.key === "Enter") resolveConfirm(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req]);

  if (!req) return null;

  return (
    <div className="modal-overlay" onClick={() => resolveConfirm(false)}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {req.title && <h3 className="modal-title">{req.title}</h3>}
        <p className="modal-message">{req.message}</p>
        <div className="modal-actions">
          <button className="ghost" onClick={() => resolveConfirm(false)}>
            {req.cancelLabel ?? "Cancel"}
          </button>
          <button
            className={req.danger ? "danger" : "primary"}
            onClick={() => resolveConfirm(true)}
            autoFocus
          >
            {req.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
