import { useState } from "react";
import "../../components/shared.css";

export default function AccountFormModal({ account, onClose, onSave }) {
  const [form, setForm] = useState({
    business_name:     account.business_name     || "",
    account_number:    account.account_number    || "",
    registration_date: account.registration_date ? account.registration_date.slice(0, 10) : "",
    status:            account.status            || "",
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);

  function setField(f, v) { setForm(prev => ({ ...prev, [f]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      await onSave({
        ...form,
        registration_date: form.registration_date ? new Date(form.registration_date).toISOString() : null,
      });
    } catch (e) { setError(e.message); setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div><p className="modal-title">{account.id ? "Edit account" : "New account"}</p></div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="error-banner">{error}</div>}
            <div className="form-grid">
              <div className="form-field">
                <label>Business name <span className="form-req">*</span></label>
                <input required value={form.business_name} onChange={e => setField("business_name", e.target.value)} />
              </div>
              <div className="form-field">
                <label>Account number</label>
                <input value={form.account_number} onChange={e => setField("account_number", e.target.value)} />
              </div>
              <div className="form-field">
                <label>Registration date</label>
                <input type="date" value={form.registration_date} onChange={e => setField("registration_date", e.target.value)} />
              </div>
              <div className="form-field">
                <label>Status</label>
                <input value={form.status} onChange={e => setField("status", e.target.value)} />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Save account"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
