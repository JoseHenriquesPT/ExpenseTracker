import { useToasts, dismissToast } from "../lib/toast";

/** Renders active toasts bottom-right. Click (or wait) to dismiss. */
export default function Toaster() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="toaster">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={"toast " + t.type}
          role="alert"
          onClick={() => dismissToast(t.id)}
          title="Dismiss"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
