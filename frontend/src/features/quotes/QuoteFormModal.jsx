import { useState } from "react";
import { SDR_LIST } from "../../config/sdrs";
import "../../components/shared.css";

const BRANDS   = ["TitanFlex", "SwiftGrip", "Schneider", "SwiftLite"];
const STATUSES = ["In Progress", "Fulfilled", "Stalled"];

function blankLine() { return { brand: "", sku: "", cases: "" }; }

export default function QuoteFormModal({ quote, onClose, onSave }) {
  const existingLines = quote.line_items?.length
    ? quote.line_items.map(l => ({ brand: l.brand || "", sku: l.sku || "", cases: l.cases ?? "" }))
    : [blankLine()];

  const [form, setForm] = useState({
    business_name:  quote.business_name  || "",
    requested_by:   quote.requested_by   || "",
    quote_value:    quote.quote_value     ?? "",
    date_requested: quote.date_requested  ? quote.date_requested.slice(0, 10) : "",
    status:         quote.status          || "In Progress",
    associated_sdr: quote.associated_sdr  || "",
  });
  const [lineItems, setLineItems] = useState(existingLines);
  const [saving,    setSaving]    = useState(false);
  const [errors,    setErrors]    = useState([]);

  function setField(field, value) { setForm(f => ({ ...f, [field]: value })); }
  function setLine(i, field, value) {
    setLineItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  }
  function addLine()  { setLineItems(prev => [...prev, blankLine()]); }
  function removeLine(i) { if (lineItems.length > 1) setLineItems(prev => prev.filter((_, idx) => idx !== i)); }

  function validate() {
    const errs = [];
    if (!form.business_name.trim()) errs.push("Business name is required.");
    if (!form.requested_by.trim())  errs.push("Requested by is required.");
    if (!form.quote_value || parseFloat(form.quote_value) <= 0) errs.push("Quote value is required.");
    if (!form.date_requested)       errs.push("Date requested is required.");
    lineItems.forEach((item, i) => {
      if (!item.brand) errs.push(`Brand is required on line ${i + 1}.`);
    });
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (errs.length) { setErrors(errs); return; }
    setSaving(true); setErrors([]);
    try {
      await onSave({
        business_name:  form.business_name,
        requested_by:   form.requested_by,
        quote_value:    parseFloat(form.quote_value),
        date_requested: new Date(form.date_requested).toISOString(),
        status:         form.status,
        associated_sdr: form.associated_sdr || null,
        line_items: lineItems
          .filter(l => l.brand)
          .map(l => ({
            brand: l.brand,
            sku:   l.sku   || null,
            cases: l.cases ? parseInt(l.cases, 10) : null,
          })),
      });
    } catch (e) {
      setErrors([e.message]);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="modal-title">{quote.id ? "Edit quote" : "New quote"}</p>
            <p className="modal-subtitle">All required fields must be completed to save.</p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {errors.length > 0 && (
              <div className="error-banner">
                {errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}

            <div className="form-section-label">Required</div>

            <div className="form-grid form-grid-2">
              <div className="form-field">
                <label>Business name <span className="form-req">*</span></label>
                <input value={form.business_name} onChange={e => setField("business_name", e.target.value)} placeholder="e.g. Benchmark Industrial" />
              </div>
              <div className="form-field">
                <label>Requested by <span className="form-req">*</span></label>
                <input value={form.requested_by} onChange={e => setField("requested_by", e.target.value)} placeholder="Contact name" />
              </div>
            </div>

            <div className="form-grid form-grid-3">
              <div className="form-field">
                <label>Quote value ($) <span className="form-req">*</span></label>
                <input type="number" step="0.01" min="0" value={form.quote_value} onChange={e => setField("quote_value", e.target.value)} placeholder="0.00" />
              </div>
              <div className="form-field">
                <label>Date requested <span className="form-req">*</span></label>
                <input type="date" value={form.date_requested} onChange={e => setField("date_requested", e.target.value)} />
              </div>
              <div className="form-field">
                <label>Status <span className="form-req">*</span></label>
                <select value={form.status} onChange={e => setField("status", e.target.value)}>
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="form-grid form-grid-2" style={{ marginBottom: 0 }}>
              <div className="form-field">
                <label>Associated SDR</label>
                <select value={form.associated_sdr} onChange={e => setField("associated_sdr", e.target.value)}>
                  <option value="">— None —</option>
                  {SDR_LIST.map(name => <option key={name}>{name}</option>)}
                </select>
              </div>
            </div>

            <div className="section-divider">
              <div className="section-divider-line" />
              <span className="section-divider-text">Brand line items</span>
              <div className="section-divider-line" />
            </div>

            <div className="line-items-header">
              <span>Brand <span className="form-req">*</span></span>
              <span>SKU</span>
              <span>Cases</span>
              <span />
            </div>

            {lineItems.map((item, i) => (
              <div className="line-item-row" key={i}>
                <select value={item.brand} onChange={e => setLine(i, "brand", e.target.value)}>
                  <option value="" disabled>Select brand</option>
                  {BRANDS.map(b => <option key={b}>{b}</option>)}
                </select>
                <input placeholder="SKU (optional)" value={item.sku} onChange={e => setLine(i, "sku", e.target.value)} />
                <input type="number" min="1" placeholder="0" value={item.cases} onChange={e => setLine(i, "cases", e.target.value)} />
                <button type="button" className="line-item-remove" onClick={() => removeLine(i)} aria-label="Remove line">×</button>
              </div>
            ))}

            <button type="button" className="add-line-btn" onClick={addLine}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add brand line
            </button>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : quote.id ? "Save changes" : "Create quote"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
