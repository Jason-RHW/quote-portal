import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import "../../components/shared.css";

export default function POFormModal({ po, onClose, onSave }) {
  const [form, setForm] = useState({
    business_name:  po.business_name  || "",
    po_value:       po.po_value       ?? "",
    date_of_po:     po.date_of_po     ? po.date_of_po.slice(0, 10) : "",
    associated_sdr: po.associated_sdr || "",
  });
  const [sdrs, setSdrs] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);

  useEffect(() => {
    api.sdrs.list(false).then(setSdrs).catch(() => setSdrs([]));
  }, []);

  const sdrOptions = useMemo(() => {
    const names = sdrs.map(s => s.full_name);
    return form.associated_sdr && !names.includes(form.associated_sdr)
      ? [form.associated_sdr, ...names]
      : names;
  }, [sdrs, form.associated_sdr]);

  function setField(f, v) { setForm(prev => ({ ...prev, [f]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      await onSave({
        ...form,
        po_value:       parseFloat(form.po_value) || 0,
        date_of_po:     form.date_of_po ? new Date(form.date_of_po).toISOString() : null,
        associated_sdr: form.associated_sdr || null,
      });
    } catch (e) { setError(e.message); setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="modal-title">{po.id ? "Edit purchase order" : "New purchase order"}</p>
          </div>
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
                <label>PO value ($) <span className="form-req">*</span></label>
                <input type="number" step="0.01" min="0" value={form.po_value} onChange={e => setField("po_value", e.target.value)} />
              </div>
              <div className="form-field">
                <label>Date of PO</label>
                <input type="date" value={form.date_of_po} onChange={e => setField("date_of_po", e.target.value)} />
              </div>
              <div className="form-field">
                <label>Associated SDR</label>
                <select value={form.associated_sdr} onChange={e => setField("associated_sdr", e.target.value)}>
                  <option value="">— None —</option>
                  {sdrOptions.map(name => <option key={name}>{name}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Save PO"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
