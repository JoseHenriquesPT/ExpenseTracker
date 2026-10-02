import { Link } from "react-router-dom";
import Dashboard from "./Dashboard";

const LINKS = [
  { to: "/expenses", label: "Expenses & Savings" },
  { to: "/income", label: "Income" },
  { to: "/bills", label: "Bills" },
  { to: "/planned", label: "Planned" },
  { to: "/history", label: "History" },
  { to: "/settings", label: "Settings" },
];

export default function HomePage() {
  return (
    <div>
      <header className="home-head">
        <h1 className="home-brand">Expense Tracker</h1>
      </header>

      <nav className="home-links">
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="home-link">
            {l.label}
          </Link>
        ))}
      </nav>

      <Dashboard />
    </div>
  );
}
