import { useState } from "react";
import { useAuth } from "./context/AuthContext";
import LoginPage from "./pages/LoginPage";
import QuotesPage from "./features/quotes/QuotesPage";
import POsPage from "./features/pos/POsPage";
import AccountsPage from "./features/accounts/AccountsPage";
import DashboardPage from "./pages/DashboardPage";
import "./App.css";

const NAV = [
  { key: "quotes",    label: "Quotes",           icon: <FileInvoiceIcon /> },
  { key: "pos",       label: "Purchase orders",   icon: <ReceiptIcon /> },
  { key: "accounts",  label: "Accounts",           icon: <BuildingIcon /> },
  { key: "dashboard", label: "Dashboard",          icon: <ChartIcon /> },
];

export default function App() {
  const { authenticated, logout, ready } = useAuth();
  const [tab, setTab] = useState("quotes");

  if (!ready) return null;
  if (!authenticated) return <LoginPage />;

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <img src="/Schneider-Direct.png" alt="Schneider Direct" className="app-topbar-logo-img" />
        <div className="app-topbar-right">
          <span className="app-topbar-user">Marketing team</span>
          <button className="app-topbar-logout" onClick={logout}>Sign out</button>
        </div>
      </header>

      <div className="app-body">
        <nav className="app-sidebar">
          <div className="sidebar-group-label">Sales</div>
          {NAV.slice(0, 3).map(item => (
            <button key={item.key} className={`sidebar-item ${tab===item.key?"active":""}`} onClick={() => setTab(item.key)}>
              {item.icon}{item.label}
            </button>
          ))}
          <div className="sidebar-group-label">Analytics</div>
          <button className={`sidebar-item ${tab==="dashboard"?"active":""}`} onClick={() => setTab("dashboard")}>
            <ChartIcon />Dashboard
          </button>
        </nav>

        <main className="app-main">
          {tab === "quotes"    && <QuotesPage />}
          {tab === "pos"       && <POsPage />}
          {tab === "accounts"  && <AccountsPage />}
          {tab === "dashboard" && <DashboardPage />}
        </main>
      </div>
    </div>
  );
}

function FileInvoiceIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
}
function ReceiptIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>;
}
function BuildingIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>;
}
function ChartIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
}
