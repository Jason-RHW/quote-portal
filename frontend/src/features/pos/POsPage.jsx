import { useEffect, useState, useMemo } from "react";
import { api } from "../../api/client";
import POFormModal from "./POFormModal";
import { SDR_LIST } from "../../config/sdrs";
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

export default function POsPage() {
  const [pos,     setPos]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [editing, setEditing] = useState(null);

  // Filters
  const [search,    setSearch]    = useState("");
  const [period,    setPeriod]    = useState("all");
  const [sortValue, setSortValue] = useState(null);
  const [filterSDR, setFilterSDR] = useState("");

  async function load() {
    setLoading(true); setError(null);
    try { setPos(await api.pos.list()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleSave(payload) {
    if (editing.id) await api.pos.update(editing.id, payload);
    else            await api.pos.create(payload);
    setEditing(null); load();
  }

  async function handleDelete(id) {
    if (!confirm("Delete this purchase order?")) return;
    await api.pos.remove(id); load();
  }

  function cycleSort() {
    setSortValue(v => v === null ? "desc" : v === "desc" ? "asc" : null);
  }

  function clearFilters() {
    setSearch(""); setPeriod("all"); setSortValue(null); setFilterSDR("");
  }

  const hasFilters = search || period !== "all" || sortValue || filterSDR;

  const visible = useMemo(() => {
    let r = [...pos];
    if (search)       r = r.filter(p => p.business_name.toLowerCase().includes(search.toLowerCase()));
    if (filterSDR)    r = r.filter(p => p.associated_sdr === filterSDR);
    if (period !== "all") r = r.filter(p => inDateRange(p.date_of_po, period));
    if (sortValue === "asc")  r.sort((a,b) => (a.po_value||0) - (b.po_value||0));
    if (sortValue === "desc") r.sort((a,b) => (b.po_value||0) - (a.po_value||0));
    return r;
  }, [pos, search, filterSDR, period, sortValue]);

  const totalValue = visible.reduce((sum, p) => sum + (p.po_value||0), 0);
  const sortLabel  = sortValue === "asc" ? "Value ↑" : sortValue === "desc" ? "Value ↓" : "Value ⇅";

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Purchase orders</h1>
          <p className="page-sub">Closed deals. Quotes convert here once a customer commits.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing({})}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New PO
        </button>
      </div>

      <div className="summary-cards" style={{ gridTemplateColumns:"repeat(2,1fr)", maxWidth:400 }}>
        <div className="summary-card"><div className="s-label">POs shown</div><div className="s-value">{visible.length}</div></div>
        <div className="summary-card"><div className="s-label">Total value</div><div className="s-value">{fmt$(totalValue)}</div></div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="data-card">

        {/* Toolbar: search */}
        <div className="toolbar">
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
          <select className="filter-select" value={filterSDR} onChange={e => setFilterSDR(e.target.value)}>
            <option value="">All SDRs</option>
            {SDR_LIST.map(s => <option key={s}>{s}</option>)}
          </select>
          {hasFilters && <button className="filter-clear-btn" onClick={clearFilters}>Clear filters</button>}
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>Business name</th>
              <th>PO value</th>
              <th>Date of PO</th>
              <th>SDR</th>
              <th style={{ width:110 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="empty-state">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={5} className="empty-state">No purchase orders match this view.</td></tr>
            ) : visible.map(p => (
              <tr key={p.id}>
                <td className="col-name">{p.business_name}</td>
                <td>{fmt$(p.po_value)}</td>
                <td>{fmtDate(p.date_of_po)}</td>
                <td style={{fontSize:12}}>{p.associated_sdr||"—"}</td>
                <td>
                  <div className="row-actions">
                    <button className="row-action-btn" onClick={() => setEditing(p)}>Edit</button>
                    <button className="row-action-btn danger" onClick={() => handleDelete(p.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="table-footer">
          <span className="table-footer-label">
            Showing {visible.length} of {pos.length} purchase orders
            {hasFilters ? " — filters active" : ""}
          </span>
        </div>
      </div>

      {editing && <POFormModal po={editing} onClose={() => setEditing(null)} onSave={handleSave} />}
    </div>
  );
}
