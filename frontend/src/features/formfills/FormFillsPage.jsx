import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import DateFilterCalendar from "../samples/DateFilterCalendar";
import FormFillDetailDrawer from "./FormFillDetailDrawer";
import "../../components/shared.css";
import "../samples/samples.css";
import "./formfills.css";

const PAGE_SIZE = 50;

function isoLocal(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function daysAgo(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function SourceBadge({ source }) {
  return <span className={`status-badge ${source === "manual" ? "hold" : "hs-tracking-synced"}`}>{source === "manual" ? "Manual" : "Synced"}</span>;
}

export default function FormFillsPage() {
  const [fills, setFills] = useState([]);
  const [sdrs, setSdrs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [dateFilter, setDateFilter] = useState(null);
  const [dateRange, setDateRange] = useState({ from: "", to: "" });
  const [dateOpen, setDateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dateSort, setDateSort] = useState("desc");
  const [page, setPage] = useState(1);

  const [showAddModal, setShowAddModal] = useState(false);
  const [openId, setOpenId] = useState(null);

  const activeSdrs = useMemo(() => sdrs.filter(s => s.active), [sdrs]);
  const sdrsById = useMemo(() => Object.fromEntries(sdrs.map(s => [s.id, s])), [sdrs]);

  const reload = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const [fillList, sdrList] = await Promise.all([
        api.formFills.list(),
        api.sdrs.list(),
      ]);
      setFills(fillList);
      setSdrs(sdrList);
    } catch (e) {
      if (!silent) setError(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const id = window.setInterval(() => reload({ silent: true }), 30000);
    return () => window.clearInterval(id);
  }, [reload]);
  useEffect(() => { setPage(1); }, [dateFilter, dateRange.from, dateRange.to, search]);

  const visible = useMemo(() => {
    let list = fills;
    if (dateFilter) list = list.filter(f => f.fill_date === dateFilter);
    if (dateRange.from) list = list.filter(f => f.fill_date >= dateRange.from);
    if (dateRange.to) list = list.filter(f => f.fill_date <= dateRange.to);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(f => (f.company_name || "").toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      const direction = dateSort === "asc" ? 1 : -1;
      const dateDiff = (a.fill_date || "").localeCompare(b.fill_date || "") * direction;
      if (dateDiff !== 0) return dateDiff;
      return String(a.id).localeCompare(String(b.id)) * direction;
    });
  }, [fills, dateFilter, dateRange.from, dateRange.to, search, dateSort]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedVisible = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return visible.slice(start, start + PAGE_SIZE);
  }, [visible, currentPage]);

  const dataDates = useMemo(() => [...new Set(fills.map(f => f.fill_date))], [fills]);

  const todayIso = isoLocal(new Date());
  const monthPrefix = todayIso.slice(0, 7); // "YYYY-MM"
  const todayCount = useMemo(() => fills.filter(f => f.fill_date === todayIso).length, [fills, todayIso]);
  const monthCount = useMemo(() => fills.filter(f => (f.fill_date || "").startsWith(monthPrefix)).length, [fills, monthPrefix]);
  const monthLabel = new Date(`${monthPrefix}-01T00:00:00`).toLocaleDateString("en-US", { month: "long" });
  const openFill = useMemo(() => fills.find(f => f.id === openId) || null, [fills, openId]);

  return (
    <div className="form-fills-page samples-page">
      <div className="page-header">
        <div>
          <p className="page-title">Form Fills</p>
          <p className="page-sub">SDR account-research notes synced daily from HubSpot — $5 each toward commission.</p>
        </div>
        <div className="page-header-actions">
          <button className="btn-primary" onClick={() => setShowAddModal(true)}>+ Add Form Fill</button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="summary-cards">
        <div className="summary-card accent">
          <div className="s-label">Total Form Fills</div>
          <div className="s-value">{fills.length}</div>
        </div>
        <div className="summary-card accent">
          <div className="s-label">{monthLabel}</div>
          <div className="s-value">{monthCount}</div>
        </div>
        <div className="summary-card accent">
          <div className="s-label">Today</div>
          <div className="s-value">{todayCount}</div>
        </div>
      </div>

      <div className="data-card">
        <div className="toolbar">
          <DateFilterCalendar
            dataDates={dataDates}
            selectedDate={dateFilter}
            selectedRange={dateRange}
            onSelect={setDateFilter}
            onRangeChange={setDateRange}
            onClear={() => { setDateFilter(null); setDateRange({ from: "", to: "" }); }}
            isOpen={dateOpen}
            onOpenChange={setDateOpen}
          />
          <div className="search-wrap">
            <input placeholder="Search company..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="empty-state">No form fills match these filters.</div>
        ) : (
          <div className="sample-record-list-scroll">
            <table className="data-table sample-record-list-table">
              <thead>
                <tr>
                  <th>SDR</th>
                  <th>Company</th>
                  <th>
                    <button
                      type="button"
                      className={`date-sort-button ${dateSort}`}
                      onClick={() => setDateSort(prev => prev === "desc" ? "asc" : "desc")}
                      title={`Date ${dateSort === "desc" ? "newest to oldest" : "oldest to newest"}`}
                    >
                      <span>Date</span>
                      <span className="date-sort-arrow" aria-hidden="true" />
                    </button>
                  </th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {pagedVisible.map(f => {
                  const age = daysAgo(f.fill_date);
                  return (
                    <tr key={f.id} style={{ cursor: "pointer" }} onClick={() => setOpenId(f.id)}>
                      <td>{sdrsById[f.sdr_id]?.full_name || "—"}</td>
                      <td className="col-name">
                        {f.company_name || "—"}
                        <div className="biz-sub">{f.company_domain || ""}</div>
                      </td>
                      <td>
                        {new Date(f.fill_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        <div className="age-tag">{age === 0 ? "today" : `${age}d ago`}</div>
                      </td>
                      <td><SourceBadge source={f.source} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && visible.length > 0 && (
          <div className="table-footer">
            <span className="table-footer-label">
              Showing {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, visible.length)} of {visible.length} form fills
            </span>
            <div className="pagination">
              <button className="pg-btn" disabled={currentPage === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).slice(Math.max(0, currentPage - 3), Math.min(pageCount, currentPage + 2)).map(p => (
                <button key={p} className={`pg-btn ${p === currentPage ? "active" : ""}`} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button className="pg-btn" disabled={currentPage === pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}>Next</button>
            </div>
          </div>
        )}
      </div>

      {openFill && (
        <FormFillDetailDrawer
          fill={openFill}
          sdrs={activeSdrs}
          allSdrs={sdrs}
          onClose={() => setOpenId(null)}
          onChanged={reload}
        />
      )}

      {showAddModal && (
        <AddFormFillModal
          sdrs={activeSdrs}
          onClose={() => setShowAddModal(false)}
          onSaved={async () => { setShowAddModal(false); await reload(); }}
        />
      )}
    </div>
  );
}

function AddFormFillModal({ sdrs, onClose, onSaved }) {
  const [sdrId, setSdrId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [notePreview, setNotePreview] = useState("");
  const [fillDate, setFillDate] = useState(isoLocal(new Date()));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);
    if (!companyName.trim()) { setError("Company name is required."); return; }
    if (!fillDate) { setError("Date is required."); return; }
    setSaving(true);
    try {
      await api.formFills.create({
        sdr_id: sdrId || null,
        company_name: companyName.trim(),
        note_text: notePreview.trim() || null,
        fill_date: fillDate,
        created_by: "admin",
      });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ width: 460 }}>
        <div className="modal-header">
          <p className="modal-title">Add Form Fill</p>
          <p className="modal-subtitle">Manually log a form fill not picked up by the HubSpot sync.</p>
        </div>
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {error && <div className="error-banner">{error}</div>}
          <div className="form-field">
            <label>SDR</label>
            <select value={sdrId} onChange={e => setSdrId(e.target.value)}>
              <option value="">— Unassigned —</option>
              {sdrs.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label>Company name</label>
            <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Company name" />
          </div>
          <div className="form-field">
            <label>Note (optional)</label>
            <textarea value={notePreview} onChange={e => setNotePreview(e.target.value)} rows={3} />
          </div>
          <div className="form-field">
            <label>Date</label>
            <input type="date" value={fillDate} onChange={e => setFillDate(e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Add"}</button>
        </div>
      </div>
    </div>
  );
}
