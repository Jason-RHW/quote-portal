import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { joinShipTo, splitShipTo } from "../../utils/shipTo";
import "../../components/shared.css";

const BRANDS   = ["TitanFlex", "SwiftGrip", "Schneider", "SwiftLite"];
const UNITS    = ["Case", "Box"];
const STATUSES = ["Received", "Processed", "Fulfilled", "Stalled"];

const STATUS_PILL_STYLES = {
  Received:  { background: "var(--status-new-bg)",       color: "var(--status-new-text)",       border: "1px solid var(--status-new-text)" },
  Processed: { background: "var(--status-progress-bg)",  color: "var(--status-progress-text)",  border: "1px solid var(--status-progress-text)" },
  Fulfilled: { background: "var(--status-fulfilled-bg)", color: "var(--status-fulfilled-text)", border: "1px solid var(--status-fulfilled-text)" },
  Stalled:   { background: "var(--status-stalled-bg)",   color: "var(--status-stalled-text)",   border: "1px solid var(--status-stalled-text)" },
};

function blankLine() { return { brand: "", sku: "", quantity: "", unit: "Case", unit_price: "" }; }
function today() { return new Date().toISOString().slice(0, 10); }

function lineTotal(item) {
  const qty = parseFloat(item.quantity);
  const price = parseFloat(item.unit_price);
  return Number.isFinite(qty) && Number.isFinite(price) ? qty * price : null;
}


export default function POFormModal({ po, initialDraft, onClose, onSave }) {
  const draft = initialDraft || {};
  const existingLines = (po.line_items?.length ? po.line_items : draft.line_items)?.length
    ? (po.line_items?.length ? po.line_items : draft.line_items).map(l => ({
        brand: l.brand || "", sku: l.sku || "", quantity: l.quantity ?? "", unit: l.unit || "Case", unit_price: l.unit_price ?? "",
      }))
    : [blankLine()];

  const initialShipTo = po.id
    ? splitShipTo(po.ship_to)
    : {
        ship_to_business_name: draft.ship_to_business_name || "",
        ship_to_address_line1: draft.ship_to_address_line1 || "",
        ship_to_address_line2: draft.ship_to_address_line2 || "",
        ship_to_city:          draft.ship_to_city           || "",
        ship_to_state_zip:     draft.ship_to_state_zip       || "",
      };

  const [form, setForm] = useState({
    business_name:  po.business_name  || draft.business_name || "",
    po_number:      po.po_number      || draft.po_number      || "",
    po_value:       po.po_value       ?? "",
    date_of_po:     po.date_of_po     ? po.date_of_po.slice(0, 10) : (draft.date_of_po || today()),
    status:         po.status         || "Received",
    associated_sdr: po.associated_sdr || "",
    quote_id:       po.quote_id       || "",
    ...initialShipTo,
  });
  const [lineItems, setLineItems] = useState(existingLines);
  const [sdrs, setSdrs] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);

  useEffect(() => {
    api.sdrs.list(false).then(setSdrs).catch(() => setSdrs([]));
    api.quotes.list().then(setQuotes).catch(() => setQuotes([]));
  }, []);

  const quoteOptions = useMemo(() => {
    return [...quotes].sort((a, b) => (b.date_requested || "").localeCompare(a.date_requested || ""));
  }, [quotes]);

  const sdrOptions = useMemo(() => {
    const names = sdrs.map(s => s.full_name);
    return form.associated_sdr && !names.includes(form.associated_sdr)
      ? [form.associated_sdr, ...names]
      : names;
  }, [sdrs, form.associated_sdr]);

  const hasLineItems = lineItems.some(l => l.brand);
  const computedSubtotal = useMemo(() => {
    return lineItems.reduce((sum, item) => sum + (lineTotal(item) || 0), 0);
  }, [lineItems]);

  function setField(f, v) { setForm(prev => ({ ...prev, [f]: v })); }
  function setLine(i, field, value) {
    setLineItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  }
  function addLine()  { setLineItems(prev => [...prev, blankLine()]); }
  function removeLine(i) { if (lineItems.length > 1) setLineItems(prev => prev.filter((_, idx) => idx !== i)); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!hasLineItems && (form.po_value === "" || parseFloat(form.po_value) < 0)) {
      setError("PO value is required."); return;
    }
    setSaving(true); setError(null);
    try {
      await onSave({
        business_name:  form.business_name,
        po_number:      form.po_number || null,
        ship_to:        joinShipTo(form) || null,
        po_value:       hasLineItems ? computedSubtotal : (parseFloat(form.po_value) || 0),
        date_of_po:     form.date_of_po ? new Date(form.date_of_po).toISOString() : null,
        status:         form.status,
        associated_sdr: form.associated_sdr || null,
        quote_id:       form.quote_id || null,
        line_items: hasLineItems
          ? lineItems
              .filter(l => l.brand)
              .map(l => ({
                brand: l.brand,
                sku:   l.sku || null,
                quantity: l.quantity !== "" ? parseFloat(l.quantity) : null,
                unit:  l.unit || null,
                unit_price: l.unit_price !== "" ? parseFloat(l.unit_price) : null,
              }))
          : [],
      });
    } catch (e2) { setError(e2.message); setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="modal-title">{po.id ? "Edit purchase order" : "New purchase order"}</p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="error-banner">{error}</div>}

            {/* Header: identity + status pill */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, paddingBottom: 14, borderBottom: "0.5px solid var(--border)", marginBottom: 18 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <input
                  required
                  value={form.business_name}
                  onChange={e => setField("business_name", e.target.value)}
                  placeholder="Business name"
                  aria-label="Business name"
                  style={{ fontSize: 17, fontWeight: 500, border: "none", outline: "none", background: "transparent", padding: 0, width: "100%", color: "var(--text-primary)", fontFamily: "inherit" }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <input
                    value={form.po_number}
                    onChange={e => setField("po_number", e.target.value)}
                    placeholder="PO number"
                    aria-label="PO number"
                    style={{ fontSize: 12, height: 26, padding: "0 8px", border: "0.5px solid var(--border)", borderRadius: 5, background: "var(--surface-card)", color: "var(--text-secondary)", width: 110, fontFamily: "inherit" }}
                  />
                  <input
                    type="date"
                    value={form.date_of_po}
                    onChange={e => setField("date_of_po", e.target.value)}
                    aria-label="Date of PO"
                    style={{ fontSize: 12, height: 26, padding: "0 8px", border: "0.5px solid var(--border)", borderRadius: 5, background: "var(--surface-card)", color: "var(--text-secondary)", fontFamily: "inherit" }}
                  />
                </div>
              </div>
              <select
                value={form.status}
                onChange={e => setField("status", e.target.value)}
                aria-label="Status"
                style={{ borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", flexShrink: 0, ...STATUS_PILL_STYLES[form.status] }}
              >
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div className="form-section-label">Details</div>
            <div className="form-grid form-grid-2">
              <div className="form-field">
                <label>Associated SDR</label>
                <select value={form.associated_sdr} onChange={e => setField("associated_sdr", e.target.value)}>
                  <option value="">— None —</option>
                  {sdrOptions.map(name => <option key={name}>{name}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label>Link to existing quote</label>
                <select value={form.quote_id} onChange={e => setField("quote_id", e.target.value)}>
                  <option value="">— None —</option>
                  {quoteOptions.map(q => (
                    <option key={q.id} value={q.id}>
                      {q.business_name} — ${(q.quote_value || 0).toLocaleString()}{q.date_requested ? ` (${q.date_requested.slice(0, 10)})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-section-label">Ship to</div>
            <div className="form-grid form-grid-2">
              <div className="form-field">
                <label>Business name</label>
                <input value={form.ship_to_business_name} onChange={e => setField("ship_to_business_name", e.target.value)} placeholder="Recipient business name" />
              </div>
              <div className="form-field">
                <label>Street address line 1</label>
                <input value={form.ship_to_address_line1} onChange={e => setField("ship_to_address_line1", e.target.value)} placeholder="123 Main St" />
              </div>
              <div className="form-field">
                <label>Street address line 2</label>
                <input value={form.ship_to_address_line2} onChange={e => setField("ship_to_address_line2", e.target.value)} placeholder="Suite / unit (optional)" />
              </div>
              <div className="form-field">
                <label>City</label>
                <input value={form.ship_to_city} onChange={e => setField("ship_to_city", e.target.value)} placeholder="City" />
              </div>
              <div className="form-field" style={{ gridColumn: "1 / -1" }}>
                <label>State / Zip</label>
                <input value={form.ship_to_state_zip} onChange={e => setField("ship_to_state_zip", e.target.value)} placeholder="WA 98682" />
              </div>
            </div>

            <div className="form-section-label" style={{ marginTop: 18 }}>Brand line items{hasLineItems ? ` (${lineItems.filter(l => l.brand).length})` : ""}</div>

            <div className="po-line-items-header">
              <span>Brand</span>
              <span>SKU</span>
              <span>Qty</span>
              <span>Unit</span>
              <span>Unit price</span>
              <span>Total</span>
              <span />
            </div>

            {lineItems.map((item, i) => (
              <div className="po-line-item-row" key={i}>
                <select value={item.brand} onChange={e => setLine(i, "brand", e.target.value)}>
                  <option value="">Select brand</option>
                  {BRANDS.map(b => <option key={b}>{b}</option>)}
                </select>
                <input placeholder="SKU" value={item.sku} onChange={e => setLine(i, "sku", e.target.value)} />
                <input type="number" min="0" placeholder="0" value={item.quantity} onChange={e => setLine(i, "quantity", e.target.value)} />
                <select value={item.unit} onChange={e => setLine(i, "unit", e.target.value)}>
                  {UNITS.map(u => <option key={u}>{u}</option>)}
                </select>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={item.unit_price} onChange={e => setLine(i, "unit_price", e.target.value)} />
                <span className="po-line-item-total">{lineTotal(item) != null ? `$${lineTotal(item).toFixed(2)}` : "—"}</span>
                <button type="button" className="line-item-remove" onClick={() => removeLine(i)} aria-label="Remove line">×</button>
              </div>
            ))}

            <button type="button" className="add-line-btn" onClick={addLine}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add brand line
            </button>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface-subtle)", borderRadius: 8, padding: "12px 16px", marginTop: 16 }}>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                Subtotal {!hasLineItems && <span className="form-req">*</span>}
              </span>
              {hasLineItems ? (
                <span style={{ fontSize: 20, fontWeight: 500 }}>${computedSubtotal.toFixed(2)}</span>
              ) : (
                <input
                  type="number" step="0.01" min="0"
                  value={form.po_value} onChange={e => setField("po_value", e.target.value)}
                  placeholder="0.00"
                  aria-label="Subtotal"
                  style={{ width: 120, height: 32, textAlign: "right", fontSize: 16, fontWeight: 500, border: "0.5px solid var(--border)", borderRadius: 6, padding: "0 10px", background: "var(--surface-card)", color: "var(--text-primary)", fontFamily: "inherit" }}
                />
              )}
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
