import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Dashboard from "./Dashboard";

export default function HomePage() {
  const { t } = useTranslation();
  const links = [
    { to: "/expenses", label: t("home.links.expenses") },
    { to: "/income", label: t("home.links.income") },
    { to: "/bills", label: t("home.links.bills") },
    { to: "/planned", label: t("home.links.planned") },
  ];

  return (
    <div>
      <header className="home-head">
        <h1 className="home-brand">{t("home.brand")}</h1>
      </header>

      <nav className="home-links">
        {links.map((l) => (
          <Link key={l.to} to={l.to} className="home-link">
            {l.label}
          </Link>
        ))}
      </nav>

      <Dashboard />

      <footer className="home-footer">
        <Link to="/history" className="home-link">{t("home.history")}</Link>
        <Link to="/settings" className="home-link">{t("home.settings")}</Link>
      </footer>
    </div>
  );
}
