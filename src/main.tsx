import React from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, Navigate, RouterProvider } from "react-router-dom";
// Initializes i18next (language detection + persistence) before anything renders.
import "./i18n";
import AuthGate from "./auth/AuthGate";
import App from "./App";
import HomePage from "./pages/HomePage";
import LedgerPage from "./pages/LedgerPage";
import HistoryPage from "./pages/HistoryPage";
import InvestmentsPage from "./pages/InvestmentsPage";
import BillsPage from "./pages/BillsPage";
import PlannedPage from "./pages/PlannedPage";
import SettingsPage from "./pages/SettingsPage";
import "./styles.css";

// HashRouter so it works when opened from the filesystem / static host too.
const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      // The Dashboard now lives on the Home page; keep the old URL working.
      { path: "dashboard", element: <Navigate to="/" replace /> },
      { path: "expenses", element: <LedgerPage tabs={["expenses", "personalExpenses"]} /> },
      // Old standalone route — Individual now lives as a subtab under Expenses.
      { path: "personal", element: <Navigate to="/expenses" replace /> },
      { path: "income", element: <LedgerPage tabs={["income"]} /> },
      { path: "history", element: <HistoryPage /> },
      // Archived: no longer linked from Home, kept so old rows stay reachable.
      { path: "investments", element: <InvestmentsPage /> },
      { path: "bills", element: <BillsPage /> },
      { path: "planned", element: <PlannedPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate>
      <RouterProvider router={router} />
    </AuthGate>
  </React.StrictMode>
);
