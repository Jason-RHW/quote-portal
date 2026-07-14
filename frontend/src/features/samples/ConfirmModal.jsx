export default function ConfirmModal({ icon, iconTone = "warn", title, subtitle, rowList, confirmLabel, confirmTone = "danger", onCancel, onConfirm, loading }) {
  const iconBg = iconTone === "warn" ? "var(--status-stalled-bg)" : "var(--status-new-bg, #EFF6FF)";
  const iconColor = iconTone === "warn" ? "var(--status-stalled-text)" : "var(--enterprise-blue)";
  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ width: 440 }}>
        <div className="modal-header">
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ width: 38, height: 38, borderRadius: 8, background: iconBg, color: iconColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>
              {icon}
            </div>
            <div>
              <p className="modal-title">{title}</p>
              <p className="modal-subtitle">{subtitle}</p>
            </div>
          </div>
        </div>
        <div className="modal-body">
          <div style={{ background: "var(--surface-subtle)", border: "0.5px solid var(--border)", borderRadius: 6, padding: "10px 12px", fontSize: 12, color: "var(--text-secondary)", maxHeight: 110, overflowY: "auto" }}>
            {rowList}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className={confirmTone === "danger" ? "btn-danger" : "btn-primary"} onClick={onConfirm} disabled={loading}>
            {loading ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
