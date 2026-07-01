import React from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, Navigate, RouterProvider } from "react-router-dom";
import AuthGate from "./auth/AuthGate";
import App from "./App";
import Dashboard from "./pages/Dashboard";
import LedgerPage from "./pages/LedgerPage";
import InvestmentsPage from "./pages/InvestmentsPage";
import BillsPage from "./pages/BillsPage";
import SettingsPage from "./pages/SettingsPage";
import "./styles.css";

// HashRouter so it works when opened from the filesystem / static host too.
const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "expenses", element: <LedgerPage tabs={["expenses", "personalExpenses"]} /> },
      // Old standalone route — Individual now lives as a subtab under Expenses.
      { path: "personal", element: <Navigate to="/expenses" replace /> },
      { path: "income", element: <LedgerPage tabs={["income"]} /> },
      { path: "investments", element: <InvestmentsPage /> },
      { path: "bills", element: <BillsPage /> },
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
