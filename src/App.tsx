import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { ensureConfig } from "./db/db";
import { useOnline } from "./lib/useOnline";
import Toaster from "./components/Toaster";
import ConfirmDialog from "./components/ConfirmDialog";

const links = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/expenses", label: "Expenses" },
  { to: "/income", label: "Income" },
  { to: "/investments", label: "Investments" },
  { to: "/bills", label: "Bills" },
  { to: "/settings", label: "Settings" },
];

export default function App() {
  const online = useOnline();

  // Seed the config singleton on first launch.
  useEffect(() => {
    ensureConfig();
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <h1 className="brand">💰 Expense Tracker</h1>
        <nav>
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => (isActive ? "nav active" : "nav")}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </aside>
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
