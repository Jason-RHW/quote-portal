import { useEffect, useState, useMemo } from "react";
import { api } from "../../api/client";
import FilterDropdown from "../../components/FilterDropdown";
import POFormModal from "./POFormModal";
import PODetailDrawer from "./PODetailDrawer";
import "../../components/shared.css";

const PERIODS = [
  { key: "all",   label: "All time" },
  { key: "today", label: "Today"    },
  { key: "week",  label: "Week"     },
  { key: "month", label: "Month"    },
  { key: "year",  label: "Year"     },
];

function inDateRange(dateStr, period) {
  if (period === "all") return true;
  if (!dateStr) return false;
  const d   = new Date(dateStr);
  const now = new Date();
  if (period === "today") return d.toDateString() === now.toDateString();
  const start = new Date(now);
  if      (period === "week")  { start.setDate(now.getDate() - now.getDay() + 1); start.setHours(0,0,0,0); }
  else if (period === "month") { start.setDate(1);    start.setHours(0,0,0,0); }
  else if (period === "year")  { start.setMonth(0,1); start.setHours(0,0,0,0); }
  return d >= start;
}

function fmt$(v) { return (v??0).toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—"; }

const STATUS_CLASSES = {
  "Received":  "requested",
  "Processed": "progress",
  "Fulfilled": "fulfilled",
  "Stalled":   "stalled",
};

function StatusBadge({ status }) {
  return <span className={`status-badge ${STATUS_CLASSES[status] || "progress"}`}>{status}</span>;
}

function UploadPOModal({ onClose, onExtracted }) {
  const [file, setFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState(null);

  function handleFile(e) {
    const f = e.target.files?.[0];
    setError(null);
    if (f && f.type !== "application/pdf") { setError("Please choose a PDF file."); setFile(null); return; }
    if (f && f.size > 10 * 1024 * 1024) { setError("PDF is too large (10MB max)."); setFile(null); return; }
    setFile(f || null);
  }

  async function extract() {
    if (!file) { setError("Choose a PDF file first."); return; }
    setExtracting(true); setError(null);
    try {
      const draft = await api.pos.extractPdf(file);
      onExtracted(draft);
    } catch (e) {
      setError("Couldn't read that PDF — you can still enter the PO manually. (" + e.message + ")");
    } finally {
      setExtracting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="modal-title">Upload PO</p>
            <p className="modal-subtitle">Upload the customer's PDF purchase order — we'll pre-fill the form for you to review before saving.</p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>PDF file</label>
            <input type="file" accept="application/pdf" onChange={handleFile} />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={extract} disabled={extracting || !file}>
            {extracting ? "Reading PDF…" : "Extract"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function POsPage() {
  const [pos,     setPos]     = useState([]);
  const [quotes,  setQuotes]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft,   setDraft]   = useState(null);       // AI-extracted draft, seeds POFormModal when set
  const [selected, setSelected] = useState(null);      // drawer
  const [showUpload, setShowUpload] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState(null);
  const [search,    setSearch]    = useState("");
  const [period,    setPeriod]    = useState("all");
  const [sortValue, setSortValue] = useState(null);
  const [filterSDR, setFilterSDR] = useState("");
  const [openFilter, setOpenFilter] = useState(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [poList, quoteList] = await Promise.all([api.pos.list(), api.quotes.list()]);
      setPos(poList);
      setQuotes(quoteList);
    }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  // Sync selected drawer PO after refresh
  useEffect(() => {
    setSelected(current => {
      if (!current) return current;
      return pos.find(p => p.id === current.id) || current;
    });
  }, [pos]);

  const quotesById = useMemo(() => Object.fromEntries(quotes.map(q => [q.id, q])), [quotes]);

  async function handleSave(payload) {
    if (editing.id) await api.pos.update(editing.id, payload);
    else            await api.pos.create(payload);
    setEditing(null); setDraft(null); load();
  }

  async function handleDelete(id) {
    if (!confirm("Delete this purchase order?")) return;
    await api.pos.remove(id);
    if (selected?.id === id) setSelected(null);
    load();
  }

  function handleExtracted(extractedDraft) {
    setShowUpload(false);
    setDraft(extractedDraft);
    setEditing({});
  }

  function cycleSort() {
    setSortValue(v => v === null ? "desc" : v === "desc" ? "asc" : null);
  }

  function clearFilters() {
    setStatusFilter(null); setSearch(""); setPeriod("all"); setSortValue(null); setFilterSDR("");
  }

  const hasFilters = statusFilter || search || period !== "all" || sortValue || filterSDR;

  const visible = useMemo(() => {
    let r = [...pos];
    if (search)       r = r.filter(p => p.business_name.toLowerCase().includes(search.toLowerCase()));
    if (statusFilter) r = r.filter(p => p.status === statusFilter);
    if (filterSDR)    r = r.filter(p => p.associated_sdr === filterSDR);
    if (period !== "all") r = r.filter(p => inDateRange(p.date_of_po, period));
    if (sortValue === "asc")  r.sort((a,b) => (a.po_value||0) - (b.po_value||0));
    if (sortValue === "desc") r.sort((a,b) => (b.po_value||0) - (a.po_value||0));
    return r;
  }, [pos, search, statusFilter, filterSDR, period, sortValue]);

  const counts = pos.reduce((acc, p) => { acc[p.status] = (acc[p.status]||0)+1; return acc; }, {});
  const totalValue = visible.reduce((sum, p) => sum + (p.po_value||0), 0);
  const sortLabel  = sortValue === "asc" ? "Value ↑" : sortValue === "desc" ? "Value ↓" : "Value ⇅";
  const sdrOptions = useMemo(() => [...new Set(pos.map(p => p.associated_sdr).filter(Boolean))].sort(), [pos]);
  const sdrFilterOptions = [{ value: "", label: "All SDRs" }, ...sdrOptions.map(s => ({ value: s, label: s }))];

  return (
    <div className="list-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Purchase orders</h1>
          <p className="page-sub">Closed deals. Quotes convert here once a customer commits.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-secondary" onClick={() => setShowUpload(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M12 16V4M12 4l-4 4M12 4l4 4"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>
            Upload PO
          </button>
          <button className="btn-primary" onClick={() => { setDraft(null); setEditing({}); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New PO
          </button>
        </div>
      </div>

      <div className="summary-cards" style={{ gridTemplateColumns:"repeat(2,1fr)", maxWidth:400 }}>
        <div className="summary-card"><div className="s-label">POs shown</div><div className="s-value">{visible.length}</div></div>
        <div className="summary-card"><div className="s-label">Total value</div><div className="s-value">{fmt$(totalValue)}</div></div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="data-card record-list-card">

        {/* Toolbar: status tabs + search */}
        <div className="toolbar">
          {[{key:null,label:"All"},{key:"Received",label:"Received"},{key:"Processed",label:"Processed"},{key:"Fulfilled",label:"Fulfilled"},{key:"Stalled",label:"Stalled"}].map(f => (
            <button key={String(f.key)} className={`filter-tab ${statusFilter===f.key?"active":""}`} onClick={() => setStatusFilter(f.key)}>
              {f.label}
              <span className="tab-count">{f.key ? (counts[f.key]||0) : pos.length}</span>
            </button>
          ))}
          <div className="search-wrap">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input placeholder="Search by business name…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {/* Filter bar: date, sort, SDR */}
        <div className="filter-bar">
          <div className="filter-period">
            {PERIODS.map(p => (
              <button key={p.key} className={`filter-period-btn ${period===p.key?"active":""}`} onClick={() => setPeriod(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="filter-divider" />
          <button className={`filter-sort-btn ${sortValue?"active":""}`} onClick={cycleSort}>{sortLabel}</button>
          <FilterDropdown value={filterSDR} options={sdrFilterOptions} open={openFilter === "sdr"} onOpenChange={open => setOpenFilter(open ? "sdr" : null)} onChange={setFilterSDR} />
          {hasFilters && <button className="filter-clear-btn" onClick={clearFilters}>Clear filters</button>}
        </div>

        <div className="record-list-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>PO number</th>
                <th>Business name</th>
                <th>PO value</th>
                <th>Date of PO</th>
                <th>Status</th>
                <th>SDR</th>
                <th style={{ width:110 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="empty-state">Loading…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={7} className="empty-state">No purchase orders match this view.</td></tr>
              ) : visible.map(p => (
                <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => setSelected(p)}>
                  <td>{p.po_number || "—"}</td>
                  <td className="col-name">{p.business_name}</td>
                  <td>{fmt$(p.subtotal ?? p.po_value)}</td>
                  <td>{fmtDate(p.date_of_po)}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td style={{fontSize:12}}>{p.associated_sdr||"—"}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="row-actions">
                      <button className="row-action-btn" onClick={() => { setDraft(null); setEditing(p); }}>Edit</button>
                      <button className="row-action-btn danger" onClick={() => handleDelete(p.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="table-footer">
          <span className="table-footer-label">
            Showing {visible.length} of {pos.length} purchase orders
            {hasFilters ? " — filters active" : ""}
          </span>
        </div>
      </div>

      {editing && (
        <POFormModal
          po={editing}
          initialDraft={draft}
          onClose={() => { setEditing(null); setDraft(null); }}
          onSave={handleSave}
        />
      )}
      {selected && (
        <PODetailDrawer
          po={selected}
          linkedQuote={selected.quote_id ? quotesById[selected.quote_id] : null}
          onClose={() => setSelected(null)}
          onEdit={(p) => { setSelected(null); setDraft(null); setEditing(p); }}
        />
      )}
      {showUpload && (
        <UploadPOModal onClose={() => setShowUpload(false)} onExtracted={handleExtracted} />
      )}
    </div>
  );
}
