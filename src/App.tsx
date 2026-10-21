import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ensureConfig } from "./db/db";
import { ensureRecurring } from "./db/recurring";
import { useHousehold } from "./db/live";
import { useOnline } from "./lib/useOnline";
import Toaster from "./components/Toaster";
import ConfirmDialog from "./components/ConfirmDialog";

export default function App() {
  const { t } = useTranslation();
  const online = useOnline();
  const household = useHousehold();

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
    <div className="app">
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
