import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ensureConfig } from "./db/db";
import { ensureRecurring } from "./db/recurring";
import { useHousehold } from "./db/live";
import { useOnline } from "./lib/useOnline";
import { useCurrency } from "./lib/currency";
import Toaster from "./components/Toaster";
import ConfirmDialog from "./components/ConfirmDialog";

export default function App() {
  const { t } = useTranslation();
  const online = useOnline();
  const household = useHousehold();
  // Re-render the tree when the display currency changes in Settings so every
  // formatted amount updates without a reload.
  const currency = useCurrency();

  // Seed the config singleton on first launch.
  useEffect(() => {
    ensureConfig();
  }, []);

  // Top recurring income/bills up to the rolling horizon. Runs on launch and
  // whenever the active household changes (join, merge or dismantle).
  useEffect(() => {
    if (household) void ensureRecurring();
  }, [household?.id]);

  return (
    <div className="app" data-currency={currency}>
      <main className="content">
        {!online && (
          <div className="offline-banner" role="status">
            {t("common.offline")}
          </div>
        )}
        <Outlet />
      </main>
      <Toaster />
      <ConfirmDialog />
    </div>
  );
}
