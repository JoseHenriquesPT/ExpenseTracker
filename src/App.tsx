import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ensureConfig } from "./db/db";
import { useOnline } from "./lib/useOnline";
import Toaster from "./components/Toaster";
import ConfirmDialog from "./components/ConfirmDialog";

export default function App() {
  const { t } = useTranslation();
  const online = useOnline();

  // Seed the config singleton on first launch.
  useEffect(() => {
    ensureConfig();
  }, []);

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
