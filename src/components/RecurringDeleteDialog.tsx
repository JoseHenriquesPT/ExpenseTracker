import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { fmtDate, fmtMoney } from "../lib/format";

/** Delete a recurring occurrence: this month only, or this month and every
 *  future month (which stops the series). Earlier months always stay. */
export default function RecurringDeleteDialog({
  amount, category, date, busy = false, onCancel, onThisMonth, onFuture,
}: {
  amount: number;
  category: string;
  date: string;
  busy?: boolean;
  onCancel: () => void;
  onThisMonth: () => void;
  onFuture: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal-title">{t("recurring.deleteTitle")}</h3>
        <p className="modal-message">
          {t("recurring.deleteMessage", {
            amount: fmtMoney(amount),
            category,
            date: fmtDate(date),
          })}
        </p>
        <p className="subtitle" style={{ marginTop: 0 }}>
          {t("recurring.deleteNote")}
        </p>
        <div className="modal-actions">
          <button className="ghost" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button className="ghost" onClick={onThisMonth} disabled={busy}>
            {t("recurring.deleteThisMonth")}
          </button>
          <button className="danger" onClick={onFuture} disabled={busy}>
            {t("recurring.deleteFuture")}
          </button>
        </div>
      </div>
    </div>
  );
}
