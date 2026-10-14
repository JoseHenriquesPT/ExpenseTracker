import { useTranslation } from "react-i18next";
import { useToasts, dismissToast } from "../lib/toast";

/** Renders active toasts bottom-right. Click (or wait) to dismiss. */
export default function Toaster() {
  const { t } = useTranslation();
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="toaster">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={"toast " + toast.type}
          role="alert"
          onClick={() => dismissToast(toast.id)}
          title={t("common.dismiss")}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
