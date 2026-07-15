import { useEffect, useState } from "react";
import { api } from "../../api/client";
import AccountFormModal from "./AccountFormModal";
import "../../components/shared.css";

function fmtDate(d) { return d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"; }

export default function AccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [editing,  setEditing]  = useState(null);

  async function load() {
    setLoading(true); setError(null);
    try { setAccounts(await api.accounts.list()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleSave(payload) {
    if (editing.id) await api.accounts.update(editing.id, payload);
    else            await api.accounts.create(payload);
    setEditing(null); load();
  }

  async function handleDelete(id) {
    if (!confirm("Delete this account?")) return;
    await api.accounts.remove(id); load();
  }

  return (
    <div className="list-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Account registrations</h1>
          <p className="page-sub">Customer accounts registered with Schneider Direct.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing({})}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New account
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="data-card record-list-card">
        <div className="record-list-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Business name</th>
                <th>Account number</th>
                <th>Registration date</th>
                <th>Status</th>
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="empty-state">Loading…</td></tr>
              ) : accounts.length === 0 ? (
                <tr><td colSpan={5} className="empty-state">No accounts registered yet.</td></tr>
              ) : accounts.map(a => (
                <tr key={a.id}>
                  <td className="col-name">{a.business_name}</td>
                  <td className="col-muted">{a.account_number || "—"}</td>
                  <td className="col-muted">{fmtDate(a.registration_date)}</td>
                  <td className="col-muted">{a.status || "—"}</td>
                  <td>
                    <div className="row-actions">
                      <button className="row-action-btn" onClick={() => setEditing(a)}>Edit</button>
                      <button className="row-action-btn danger" onClick={() => handleDelete(a.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span className="table-footer-label">{accounts.length} account{accounts.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {editing && <AccountFormModal account={editing} onClose={() => setEditing(null)} onSave={handleSave} />}
    </div>
  );
}
