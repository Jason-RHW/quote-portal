import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import DateFilterCalendar from "./DateFilterCalendar";
import "../../components/shared.css";

const STATUS_LABELS = {
  requested: "Requested", sent: "Sent", in_transit: "In Transit", delivered: "Delivered",
  returned: "Returned", delivery_issue: "Delivery issue", on_hold: "On hold", rejected: "Rejected",
};

function recordDate(req) {
  return req.created_at?.slice(0, 10) || req.requested_date;
}

function fmtAddress(req) {
  return [req.address_line, [req.city, req.state].filter(Boolean).join(", "), req.zip_code].filter(Boolean).join(" · ") || "—";
}

export default function PickSampleRecordModal({ onClose, onPick }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState(null);
  const [dateRange, setDateRange] = useState({ from: "", to: "" });
  const [calendarOpen, setCalendarOpen] = useState(false);

  useEffect(() => {
    api.samples.list({ include_archived: false })
      .then(setRecords)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const dataDates = useMemo(() => [...new Set(records.map(recordDate))], [records]);

  const visible = useMemo(() => {
    let list = [...records];
    if (dateFilter) list = list.filter(r => recordDate(r) === dateFilter);
    if (dateRange.from) list = list.filter(r => recordDate(r) >= dateRange.from);
    if (dateRange.to) list = list.filter(r => recordDate(r) <= dateRange.to);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(r =>
        r.business_name?.toLowerCase().includes(q) ||
        r.contact_name?.toLowerCase().includes(q) ||
        r.tracking_number?.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => (recordDate(b) || "").localeCompare(recordDate(a) || ""));
  }, [records, search, dateFilter, dateRange.from, dateRange.to]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="modal-title">Pick a sample record</p>
            <p className="modal-subtitle">Search or filter by date to find the right record.</p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {error && <div className="error-banner">{error}</div>}

          <div style={{ display: "flex", gap: 8, marginBottom: 12, position: "relative" }}>
            <input
              placeholder="Search business, contact, tracking #..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, height: 34, padding: "0 10px", border: "0.5px solid #CBD5E1", borderRadius: 5, fontSize: 13 }}
            />
            <DateFilterCalendar
              dataDates={dataDates}
              selectedDate={dateFilter}
              selectedRange={dateRange}
              onSelect={setDateFilter}
              onRangeChange={setDateRange}
              onClear={() => { setDateFilter(null); setDateRange({ from: "", to: "" }); }}
              isOpen={calendarOpen}
              onOpenChange={setCalendarOpen}
            />
          </div>

          {loading ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading records…</p>
          ) : visible.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No records match.</p>
          ) : (
            visible.slice(0, 100).map(r => (
              <div
                key={r.id}
                onClick={() => onPick(r)}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10,
                  padding: "8px 10px", border: "0.5px solid var(--border)", borderRadius: 6,
                  marginBottom: 6, cursor: "pointer",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{r.business_name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{r.contact_name || "—"}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{fmtAddress(r)}</div>
                  <span className="status-badge" style={{ marginTop: 4, display: "inline-block" }}>{STATUS_LABELS[r.status] || r.status}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{recordDate(r) || "—"}</div>
              </div>
            ))
          )}
          {visible.length > 100 && (
            <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
              Showing first 100 of {visible.length} — narrow your search to see more.
            </p>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
