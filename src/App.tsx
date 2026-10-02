import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { ensureConfig } from "./db/db";
import { useOnline } from "./lib/useOnline";
import Toaster from "./components/Toaster";
import ConfirmDialog from "./components/ConfirmDialog";

export default function App() {
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
            ⚠ You’re offline — data can’t be loaded and changes can’t be saved until you reconnect.
          </div>
        )}
        <Outlet />
      </main>
      <Toaster />
      <ConfirmDialog />
    </div>
  );
}
