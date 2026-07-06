import "../../components/shared.css";

const BRAND_STYLES = {
  TitanFlex: { bg: "#FAF5FF", color: "#7E22CE" },
  SwiftGrip: { bg: "#FFF7ED", color: "#C2410C" },
  Schneider: { bg: "#EFF6FF", color: "#1D4ED8" },
  SwiftLite: { bg: "#F0FDF4", color: "#15803D" },
};

function fmt$(v) {
  return (v ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—";
}

function StatusBadge({ status }) {
  const cls = { "In Progress": "progress", Fulfilled: "fulfilled", Stalled: "stalled" }[status] || "progress";
  return <span className={`status-badge ${cls}`}>{status}</span>;
}

function BrandChip({ brand }) {
  const s = BRAND_STYLES[brand] || { bg: "#F1F5F9", color: "#475569" };
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      fontSize: 11, fontWeight: 500, background: s.bg, color: s.color,
    }}>
      {brand}
    </span>
  );
}

export default function QuoteDetailDrawer({ quote, onClose, onEdit }) {
  if (!quote) return null;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer open">

        <div className="drawer-header">
          <div>
            <p className="drawer-title">{quote.business_name}</p>
            <StatusBadge status={quote.status} />
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="drawer-body">

          {/* Value — big display */}
          <div className="drawer-field">
            <div className="drawer-field-label">Quote value</div>
            <div className="drawer-value-big">{fmt$(quote.quote_value)}</div>
          </div>

          {/* Two-column grid for the metadata */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 20px", marginBottom: 20 }}>
            <div className="drawer-field" style={{ marginBottom: 0 }}>
              <div className="drawer-field-label">Date requested</div>
              <div className="drawer-field-value">{fmtDate(quote.date_requested)}</div>
            </div>
            <div className="drawer-field" style={{ marginBottom: 0 }}>
              <div className="drawer-field-label">Status</div>
              <div className="drawer-field-value"><StatusBadge status={quote.status} /></div>
            </div>
            <div className="drawer-field" style={{ marginBottom: 0 }}>
              <div className="drawer-field-label">Requested by</div>
              <div className="drawer-field-value">{quote.requested_by || "—"}</div>
            </div>
            <div className="drawer-field" style={{ marginBottom: 0 }}>
              <div className="drawer-field-label">Associated SDR</div>
              <div className="drawer-field-value">{quote.associated_sdr || "—"}</div>
            </div>
          </div>

          {/* Line items */}
          <div className="section-divider">
            <div className="section-divider-line" />
            <span className="section-divider-text">Brand line items</span>
            <div className="section-divider-line" />
          </div>

          {quote.line_items && quote.line_items.length > 0 ? (
            <table className="drawer-line-items">
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>SKU</th>
                  <th>Cases</th>
                </tr>
              </thead>
              <tbody>
                {quote.line_items.map((item, i) => (
                  <tr key={i}>
                    <td><BrandChip brand={item.brand} /></td>
                    <td style={{ color: "var(--text-secondary)" }}>{item.sku || "—"}</td>
                    <td style={{ color: "var(--text-secondary)" }}>{item.cases ?? "—"}</td>
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
                {fmtDate(quote.created_at)}
              </div>
            </div>
            <div className="drawer-field" style={{ marginBottom: 0 }}>
              <div className="drawer-field-label">Last updated</div>
              <div className="drawer-field-value" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {fmtDate(quote.updated_at)}
              </div>
            </div>
          </div>

        </div>

        <div className="drawer-footer">
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={() => { onClose(); onEdit(quote); }}>
            Edit quote
          </button>
        </div>

      </div>
    </>
  );
}
