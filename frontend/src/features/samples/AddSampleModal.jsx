import { useState } from "react";
import { api } from "../../api/client";
import { brandStyle } from "../../config/brandColors";
import "../../components/shared.css";
import "./samples.css";

export default function AddSampleModal({ sdrs, brands, onClose, onCreated }) {
  const [form, setForm] = useState({
    sdr_id: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    business_name: "",
    address_line: "",
    city: "",
    state: "",
    zip_code: "",
    requested_date: new Date().toISOString().slice(0, 10),
    status: "requested",
    tracking_number: "",
    sent_date: "",
    delivered_date: "",
    assignment_note: "",
  });
  const [brandIds, setBrandIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }
  function toggleBrand(id) { setBrandIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]); }

  async function save() {
    if (!form.business_name.trim()) { setError("Business name is required."); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        sdr_id: form.sdr_id || null,
        sent_date: form.sent_date || null,
        delivered_date: form.delivered_date || null,
        assignment_note: form.assignment_note || null,
        brand_ids: brandIds,
      };
      await api.samples.create(payload);
      onCreated();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer open add-sample-drawer">
        <div className="drawer-header">
          <div>
            <p className="drawer-title">Add Sample Request</p>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Manual entry — for phone/email requests or backfilling historical records.</div>
          </div>
          <button className="drawer-close" onClick={onClose}>×</button>
        </div>
        <div className="drawer-body">
          {error && <div className="error-banner">{error}</div>}

          <div className="drawer-block">
            <h4>Requested by</h4>
            <div className="form-grid form-grid-2">
              <div className="form-field">
                <label>SDR</label>
                <select value={form.sdr_id} onChange={e => set("sdr_id", e.target.value)}>
                  <option value="">None</option>
                  {sdrs.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label>Request date</label>
                <input type="date" value={form.requested_date} onChange={e => set("requested_date", e.target.value)} />
              </div>
            </div>
          </div>

          <div className="drawer-block">
            <h4>Contact & business</h4>
            <div className="form-grid form-grid-2">
              <div className="form-field"><label>Contact full name</label><input value={form.contact_name} onChange={e => set("contact_name", e.target.value)} placeholder="Jane Alvarez" /></div>
              <div className="form-field"><label>Email</label><input value={form.contact_email} onChange={e => set("contact_email", e.target.value)} placeholder="jane@company.com" /></div>
              <div className="form-field"><label>Phone</label><input value={form.contact_phone} onChange={e => set("contact_phone", e.target.value)} placeholder="(555) 123-4567" /></div>
              <div className="form-field"><label>Business name <span className="form-req">*</span></label><input value={form.business_name} onChange={e => set("business_name", e.target.value)} placeholder="Alvarez Manufacturing" /></div>
              <div className="form-field full"><label>Address</label><input value={form.address_line} onChange={e => set("address_line", e.target.value)} placeholder="Street address" /></div>
              <div className="form-field"><label>City</label><input value={form.city} onChange={e => set("city", e.target.value)} placeholder="City" /></div>
              <div className="form-field"><label>State</label><input value={form.state} onChange={e => set("state", e.target.value)} placeholder="CA" /></div>
              <div className="form-field"><label>Zip code</label><input value={form.zip_code} onChange={e => set("zip_code", e.target.value)} placeholder="90001" /></div>
            </div>
          </div>

          <div className="drawer-block">
            <h4>Brand assignment <span style={{ fontWeight: 400, color: "var(--text-placeholder)", fontSize: 10, textTransform: "none", letterSpacing: 0 }}>optional at creation</span></h4>
            <div className="brand-multiselect">
              {brands.map(b => {
                const s = brandStyle(b.name);
                return (
                  <div className="brand-option" key={b.id}>
                    <input type="checkbox" id={`add-b-${b.id}`} checked={brandIds.includes(b.id)} onChange={() => toggleBrand(b.id)} />
                    <label htmlFor={`add-b-${b.id}`}><span className="brand-dot" style={{ background: s.color }} />{b.name}</label>
                  </div>
                );
              })}
            </div>
            <div className="form-field" style={{ marginTop: 10 }}>
              <label>Assignment note <span className="hint">for special requirements, internal only</span></label>
              <textarea
                value={form.assignment_note}
                onChange={e => set("assignment_note", e.target.value)}
                placeholder="e.g. Send TitanFlex + Schneider for side-by-side comparison per customer request"
              />
            </div>
          </div>

          <div className="drawer-block">
            <h4>Status & fulfillment</h4>
            <div className="fb-preview-note" style={{ marginBottom: 12 }}>
              Backfilling an old record? Set status and dates directly below — no confirmation step here, unlike changing status on an existing record.
            </div>
            <div className="form-field" style={{ marginBottom: 12 }}>
              <label>Status</label>
              <select value={form.status} onChange={e => set("status", e.target.value)}>
                <option value="requested">Requested</option>
                <option value="sent">Sent</option>
                <option value="delivered">Delivered</option>
                <option value="on_hold">On hold</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div className="form-grid form-grid-2">
              <div className="form-field"><label>Tracking number <span className="hint">if known</span></label><input value={form.tracking_number} onChange={e => set("tracking_number", e.target.value)} placeholder="Leave blank if unknown" /></div>
              <div className="form-field"><label>Sent date <span className="hint">if known</span></label><input type="date" value={form.sent_date} onChange={e => set("sent_date", e.target.value)} /></div>
              <div className="form-field"><label>Delivered date <span className="hint">if known</span></label><input type="date" value={form.delivered_date} onChange={e => set("delivered_date", e.target.value)} /></div>
            </div>
          </div>
        </div>
        <div className="drawer-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save Request"}</button>
        </div>
      </div>
    </>
  );
}
