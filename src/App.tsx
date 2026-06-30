import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { ensureConfig } from "./db/db";
import { supabase } from "./db/supabase";
import { useOnline } from "./lib/useOnline";
import Toaster from "./components/Toaster";

const links = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/expenses", label: "Common Expenses" },
  { to: "/income", label: "Income" },
  { to: "/investments", label: "Investments" },
  { to: "/bills", label: "Bills" },
  { to: "/settings", label: "Settings" },
];

export default function App() {
  const [email, setEmail] = useState("");
  const online = useOnline();

  // Seed the config singleton on first launch.
  useEffect(() => {
    ensureConfig();
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
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
        <div className="sidebar-foot">
          {email && <div className="subtitle" style={{ margin: "0 0 6px" }}>{email}</div>}
          <button className="ghost" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        {!online && (
          <div className="offline-banner" role="status">
            ⚠ You’re offline — viewing only. Changes can’t be saved until you reconnect.
          </div>
        )}
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}
