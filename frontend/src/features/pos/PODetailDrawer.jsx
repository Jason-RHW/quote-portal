import "../../components/shared.css";
import { brandStyle } from "../../config/brandColors";
import { displayShipTo } from "../../utils/shipTo";

const STATUS_CLASSES = {
  "Received":  "requested",
  "Processed": "progress",
  "Fulfilled": "fulfilled",
  "Stalled":   "stalled",
};

function fmt$(v) {
  return (v ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—";
}

function BrandChip({ brand }) {
  const s = brandStyle(brand);
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      fontSize: 11, fontWeight: 500, background: s.bg, color: s.color,
    }}>
      {brand}
    </span>
  );
}

export default function PODetailDrawer({ po, linkedQuote, onClose, onEdit }) {
  if (!po) return null;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer open">

        <div className="drawer-header">
          <div>
            <p className="drawer-title">{po.business_name}</p>
            {po.po_number && <span className="status-badge progress">{po.po_number}</span>}
            {po.status && <span className={`status-badge ${STATUS_CLASSES[po.status] || "progress"}`} style={{ marginLeft: 6 }}>{po.status}</span>}
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="drawer-body">

          {/* Subtotal — big display */}
          <div className="drawer-field">
            <div className="drawer-field-label">Subtotal</div>
            <div className="drawer-value-big">{fmt$(po.subtotal ?? po.po_value)}</div>
          </div>

          {/* Two-column grid for the metadata */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 20px", marginBottom: 20 }}>
            <div className="drawer-field" style={{ marginBottom: 0 }}>
              <div className="drawer-field-label">PO number</div>
              <div className="drawer-field-value">{po.po_number || "—"}</div>
            </div>
            <div className="drawer-field" style={{ marginBottom: 0 }}>
              <div className="drawer-field-label">Date of PO</div>
              <div className="drawer-field-value">{fmtDate(po.date_of_po)}</div>
            </div>
            <div className="drawer-field" style={{ marginBottom: 0 }}>
              <div className="drawer-field-label">Associated SDR</div>
              <div className="drawer-field-value">{po.associated_sdr || "—"}</div>
            </div>
            <div className="drawer-field" style={{ marginBottom: 0 }}>
              <div className="drawer-field-label">Linked quote</div>
              <div className="drawer-field-value">{linkedQuote ? linkedQuote.business_name : "—"}</div>
            </div>
            <div className="drawer-field full" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
              <div className="drawer-field-label">Ship to</div>
              <div className="drawer-field-value" style={{ whiteSpace: "pre-wrap" }}>{displayShipTo(po.ship_to) || "—"}</div>
            </div>
          </div>

          {/* Line items */}
          <div className="section-divider">
            <div className="section-divider-line" />
            <span className="section-divider-text">Brand line items</span>
            <div className="section-divider-line" />
          </div>

          {po.line_items && po.line_items.length > 0 ? (
            <table className="drawer-line-items">
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>SKU</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Unit price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {po.line_items.map((item, i) => (
                  <tr key={i}>
                    <td><BrandChip brand={item.brand} /></td>
                    <td style={{ color: "var(--text-secondary)" }}>{item.sku || "—"}</td>
                    <td style={{ color: "var(--text-secondary)" }}>{item.quantity ?? "—"}</td>
                    <td style={{ color: "var(--text-secondary)" }}>{item.unit || "—"}</td>
                    <td style={{ color: "var(--text-secondary)" }}>{item.unit_price != null ? fmt$(item.unit_price) : "—"}</td>
                    <td style={{ color: "var(--text-secondary)" }}>
                      {item.quantity != null && item.unit_price != null ? fmt$(item.quantity * item.unit_price) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "16px 0" }}>
              No line items recorded.
            </p>
          )}

          {/* Timestamps */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 20px", marginTop: 24 }}>
            <div className="drawer-field" style={{ marginBottom: 0 }}>
              <div className="drawer-field-label">Created</div>
              <div className="drawer-field-value" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {fmtDate(po.created_at)}
              </div>
            </div>
            <div className="drawer-field" style={{ marginBottom: 0 }}>
              <div className="drawer-field-label">Last updated</div>
              <div className="drawer-field-value" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {fmtDate(po.updated_at)}
              </div>
            </div>
          </div>

        </div>

        <div className="drawer-footer">
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={() => { onClose(); onEdit(po); }}>
            Edit PO
          </button>
        </div>

      </div>
    </>
  );
}
