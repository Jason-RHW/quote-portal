import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { brandStyle } from "../../config/brandColors";
import DateFilterCalendar from "./DateFilterCalendar";
import FilterDropdown from "../../components/FilterDropdown";
import "./samples.css";

const STATUSES = [
  { value: "requested", label: "Requested" },
  { value: "sent", label: "Sent" },
  { value: "delivered", label: "Delivered" },
  { value: "on_hold", label: "On hold" },
  { value: "rejected", label: "Rejected" },
];

function statusLabel(value) {
  return STATUSES.find(s => s.value === value)?.label || value;
}

function parseApiError(e) {
  const jsonStart = e.message.indexOf(": ");
  if (jsonStart === -1) return e.message;
  try {
    return JSON.parse(e.message.slice(jsonStart + 2)).detail || e.message;
  } catch {
    return e.message;
  }
}

function BrandSummary({ record, brandsById }) {
  const brandIds = record.brand_ids || [];
  if (!brandIds?.length) {
    if (record.assignment_note?.trim()) {
      return <span className="brand-chip-summary special" title={record.assignment_note}>Special Request</span>;
    }
    return <span className="brand-chip-summary unassigned">Needs assignment</span>;
  }
  const brandNames = brandIds.map(id => brandsById[id]?.name).filter(Boolean);
  if (brandNames.length > 1) {
    const first = brandsById[brandIds[0]];
    const s = brandStyle(first?.name || brandNames[0]);
    return (
      <span className="brand-hover-wrap">
        <span className="brand-pill" style={{ background: s.bg, color: s.color }}>{brandNames[0]} +{brandNames.length - 1}</span>
        <span className="brand-hover-popover">
          {brandIds.map(id => {
            const brand = brandsById[id];
            if (!brand) return null;
            const style = brandStyle(brand.name);
            return <span key={id} className="brand-pill" style={{ background: style.bg, color: style.color }}>{brand.name}</span>;
          })}
        </span>
      </span>
    );
  }
  return (
    <div className="manager-brand-stack">
      {brandIds.map(id => {
        const brand = brandsById[id];
        if (!brand) return null;
        const s = brandStyle(brand.name);
        return <span key={id} className="brand-pill" style={{ background: s.bg, color: s.color }}>{brand.name}</span>;
      })}
    </div>
  );
}

export default function SampleRecordsManagerModal({ brands, sdrsById, onClose, onChanged }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [dateRange, setDateRange] = useState({ from: "", to: "" });
  const [openFilter, setOpenFilter] = useState(null);
  const [trackingDrafts, setTrackingDrafts] = useState({});
  const [savingTrackingId, setSavingTrackingId] = useState(null);
  const [brandRecord, setBrandRecord] = useState(null);
  const [sentRecord, setSentRecord] = useState(null);
  const [deliveredRecord, setDeliveredRecord] = useState(null);
  const [savingStatusId, setSavingStatusId] = useState(null);

  const brandsById = useMemo(() => Object.fromEntries(brands.map(b => [b.id, b])), [brands]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.samples.list({ status: statusFilter || undefined });
      setRecords(data);
      setTrackingDrafts(Object.fromEntries(data.map(r => [r.id, r.tracking_number || ""])));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [statusFilter]); // eslint-disable-line

  const visible = useMemo(() => {
    let list = records;
    if (dateFilter) list = list.filter(r => r.requested_date === dateFilter);
    if (dateRange.from) list = list.filter(r => r.requested_date >= dateRange.from);
    if (dateRange.to) list = list.filter(r => r.requested_date <= dateRange.to);
    return list;
  }, [records, dateFilter, dateRange.from, dateRange.to]);

  const dataDates = useMemo(() => [...new Set(records.map(r => r.requested_date))], [records]);

  function patchRecord(updated) {
    setRecords(prev => prev.map(r => r.id === updated.id ? updated : r));
    setTrackingDrafts(prev => ({ ...prev, [updated.id]: updated.tracking_number || "" }));
    onChanged?.();
  }

  async function updateTracking(record) {
    const nextTracking = (trackingDrafts[record.id] || "").trim();
    if ((record.tracking_number || "") === nextTracking) return;
    setSavingTrackingId(record.id);
    try {
      const updated = await api.samples.update(record.id, { tracking_number: nextTracking || null });
      patchRecord(updated);
    } catch (e) {
      alert(parseApiError(e));
      setTrackingDrafts(prev => ({ ...prev, [record.id]: record.tracking_number || "" }));
    } finally {
      setSavingTrackingId(null);
    }
  }

  function handleStatusSelect(record, nextStatus) {
    if (nextStatus === record.status) return;
    if (nextStatus === "sent") {
      setSentRecord(record);
      return;
    }
    if (nextStatus === "delivered") {
      setDeliveredRecord(record);
      return;
    }
    applyStatus(record, { status: nextStatus });
  }

  async function applyStatus(record, payload) {
    setSavingStatusId(record.id);
    try {
      const updated = await api.samples.changeStatus(record.id, { changed_by: "admin", ...payload });
      patchRecord(updated);
    } catch (e) {
      alert(parseApiError(e));
    } finally {
      setSavingStatusId(null);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box sample-manager-modal">
        <div className="modal-header">
          <div>
            <p className="modal-title">Sample Record Management</p>
            <p className="modal-subtitle">Manage brands, status, and tracking without opening each record.</p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="manager-toolbar">
          <DateFilterCalendar
            dataDates={dataDates}
            selectedDate={dateFilter}
            selectedRange={dateRange}
            onSelect={setDateFilter}
            onRangeChange={setDateRange}
            onClear={() => { setDateFilter(""); setDateRange({ from: "", to: "" }); }}
            isOpen={openFilter === "date"}
            onOpenChange={open => setOpenFilter(open ? "date" : null)}
          />
          <FilterDropdown
            value={statusFilter}
            options={[{ value: "", label: "All statuses" }, ...STATUSES]}
            open={openFilter === "status"}
            onOpenChange={open => setOpenFilter(open ? "status" : null)}
            onChange={setStatusFilter}
          />
          {(dateFilter || dateRange.from || dateRange.to || statusFilter) && (
            <button className="btn-secondary manager-clear" onClick={() => { setDateFilter(""); setDateRange({ from: "", to: "" }); setStatusFilter(""); }}>Clear filters</button>
          )}
          <span className="manager-count">{visible.length} record{visible.length === 1 ? "" : "s"}</span>
        </div>

        {error && <div className="error-banner" style={{ margin: "0 18px 12px" }}>{error}</div>}

        <div className="sample-manager-table-wrap">
          <table className="data-table sample-manager-table">
            <thead>
              <tr>
                <th>SDR</th>
                <th>Contact</th>
                <th>Business</th>
                <th>Phone</th>
                <th>Street address</th>
                <th>City</th>
                <th>State</th>
                <th>Zipcode</th>
                <th>Brand</th>
                <th>Status</th>
                <th>Tracking</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="empty-state">Loading…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={11} className="empty-state">No sample records match these filters.</td></tr>
              ) : visible.map(record => (
                <tr key={record.id}>
                  <td>{sdrsById[record.sdr_id]?.full_name || "—"}</td>
                  <td>{record.contact_name || "—"}</td>
                  <td className="col-name">{record.business_name}</td>
                  <td>{record.contact_phone || "—"}</td>
                  <td>{record.address_line || "—"}</td>
                  <td>{record.city || "—"}</td>
                  <td>{record.state || "—"}</td>
                  <td>{record.zip_code || "—"}</td>
                  <td className="manager-brand-cell">
                    <button className="manager-inline-button" onClick={() => setBrandRecord(record)}>
                      <BrandSummary record={record} brandsById={brandsById} />
                    </button>
                  </td>
                  <td>
                    <select
                      className="manager-status-select"
                      value={record.status}
                      disabled={savingStatusId === record.id}
                      onChange={e => handleStatusSelect(record, e.target.value)}
                    >
                      {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td>
                    {record.status === "requested" ? (
                      <span className="manager-empty-value">-</span>
                    ) : (
                      <input
                        className="manager-tracking-input"
                        value={trackingDrafts[record.id] ?? ""}
                        disabled={savingTrackingId === record.id}
                        onChange={e => setTrackingDrafts(prev => ({ ...prev, [record.id]: e.target.value }))}
                        onBlur={() => updateTracking(record)}
                        onKeyDown={e => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") {
                            setTrackingDrafts(prev => ({ ...prev, [record.id]: record.tracking_number || "" }));
                            e.currentTarget.blur();
                          }
                        }}
                        placeholder="Tracking #"
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>

      {brandRecord && (
        <ManagerBrandModal
          record={brandRecord}
          brands={brands}
          onClose={() => setBrandRecord(null)}
          onSaved={(updated) => { patchRecord(updated); setBrandRecord(null); }}
        />
      )}

      {sentRecord && (
        <SentStatusModal
          record={sentRecord}
          onClose={() => setSentRecord(null)}
          onSave={async (payload) => {
            await applyStatus(sentRecord, payload);
            setSentRecord(null);
          }}
        />
      )}

      {deliveredRecord && (
        <DeliveredStatusModal
          record={deliveredRecord}
          onClose={() => setDeliveredRecord(null)}
          onSave={async (payload) => {
            await applyStatus(deliveredRecord, payload);
            setDeliveredRecord(null);
          }}
        />
      )}
    </div>
  );
}

function ManagerBrandModal({ record, brands, onClose, onSaved }) {
  const [selected, setSelected] = useState(record.brand_ids || []);
  const [note, setNote] = useState(record.assignment_note || "");
  const [saving, setSaving] = useState(false);

  function toggle(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function save() {
    setSaving(true);
    try {
      const updated = await api.samples.update(record.id, { brand_ids: selected, assignment_note: note || null });
      onSaved(updated);
    } catch (e) {
      alert(parseApiError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay manager-nested-overlay">
      <div className="modal-box" style={{ width: 420 }}>
        <div className="modal-header">
          <div>
            <p className="modal-title">Assign Brands</p>
            <p className="modal-subtitle">{record.business_name}</p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="brand-multiselect">
            {brands.map(b => {
              const s = brandStyle(b.name);
              return (
                <div className="brand-option" key={b.id}>
                  <input type="checkbox" id={`manager-brand-${b.id}`} checked={selected.includes(b.id)} onChange={() => toggle(b.id)} />
                  <label htmlFor={`manager-brand-${b.id}`}><span className="brand-dot" style={{ background: s.color }} />{b.name}</label>
                </div>
              );
            })}
          </div>
          <div className="form-field" style={{ marginTop: 16 }}>
            <label>Assignment note <span className="hint">internal only</span></label>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Special requirements or assignment notes" />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save Assignment"}</button>
        </div>
      </div>
    </div>
  );
}

function SentStatusModal({ record, onClose, onSave }) {
  const [tracking, setTracking] = useState(record.tracking_number || "");
  const [sentDate, setSentDate] = useState(record.sent_date || "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!tracking.trim() || !sentDate) {
      alert("Tracking number and sent date are both required to mark this as Sent.");
      return;
    }
    setSaving(true);
    try {
      await onSave({ status: "sent", tracking_number: tracking.trim(), sent_date: sentDate });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay manager-nested-overlay">
      <div className="modal-box" style={{ width: 380 }}>
        <div className="modal-header">
          <div>
            <p className="modal-title">Mark as Sent</p>
            <p className="modal-subtitle">{record.business_name}</p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-field" style={{ marginBottom: 12 }}>
            <label>Tracking number *</label>
            <input value={tracking} onChange={e => setTracking(e.target.value)} />
          </div>
          <div className="form-field">
            <label>Sent date *</label>
            <input type="date" value={sentDate} onChange={e => setSentDate(e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save as Sent"}</button>
        </div>
      </div>
    </div>
  );
}

function DeliveredStatusModal({ record, onClose, onSave }) {
  const needsTracking = !record.tracking_number;
  const needsSentDate = !record.sent_date;
  const [tracking, setTracking] = useState(record.tracking_number || "");
  const [sentDate, setSentDate] = useState(record.sent_date || "");
  const [deliveredDate, setDeliveredDate] = useState(record.delivered_date || "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (needsTracking && !tracking.trim()) {
      alert("Tracking number is required since this record was never marked Sent.");
      return;
    }
    if (needsSentDate && !sentDate) {
      alert("Sent date is required since this record was never marked Sent.");
      return;
    }
    if (!deliveredDate) {
      alert("Delivered date is required to mark this as Delivered.");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        status: "delivered",
        tracking_number: needsTracking ? tracking.trim() : undefined,
        sent_date: needsSentDate ? sentDate : undefined,
        delivered_date: deliveredDate,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay manager-nested-overlay">
      <div className="modal-box" style={{ width: 380 }}>
        <div className="modal-header">
          <div>
            <p className="modal-title">Mark as Delivered</p>
            <p className="modal-subtitle">{statusLabel(record.status)} → Delivered</p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {needsTracking && (
            <div className="form-field" style={{ marginBottom: 12 }}>
              <label>Tracking number *</label>
              <input value={tracking} onChange={e => setTracking(e.target.value)} />
            </div>
          )}
          {needsSentDate && (
            <div className="form-field" style={{ marginBottom: 12 }}>
              <label>Sent date *</label>
              <input type="date" value={sentDate} onChange={e => setSentDate(e.target.value)} />
            </div>
          )}
          <div className="form-field">
            <label>Delivered date *</label>
            <input type="date" value={deliveredDate} onChange={e => setDeliveredDate(e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save as Delivered"}</button>
        </div>
      </div>
    </div>
  );
}
