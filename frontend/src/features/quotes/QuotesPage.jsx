import { useEffect, useState, useMemo } from "react";
import { api } from "../../api/client";
import BrandChips from "../../components/BrandChips";
import FilterDropdown from "../../components/FilterDropdown";
import QuoteFormModal from "./QuoteFormModal";
import QuoteDetailDrawer from "./QuoteDetailDrawer";
import "../../components/shared.css";

const BRANDS  = ["TitanFlex", "SwiftGrip", "Schneider", "SwiftLite"];
const PERIODS = [
  { key: "all",   label: "All time"   },
  { key: "today", label: "Today"      },
  { key: "week",  label: "Week"       },
  { key: "month", label: "Month"      },
  { key: "year",  label: "Year"       },
];

function inDateRange(dateStr, period) {
  if (period === "all") return true;
  if (!dateStr) return false;
  const d   = new Date(dateStr);
  const now = new Date();
  if (period === "today") return d.toDateString() === now.toDateString();
  const start = new Date(now);
  if      (period === "week")  { start.setDate(now.getDate() - now.getDay() + 1); start.setHours(0,0,0,0); }
  else if (period === "month") { start.setDate(1);   start.setHours(0,0,0,0); }
  else if (period === "year")  { start.setMonth(0,1); start.setHours(0,0,0,0); }
  return d >= start;
}

function fmt$(v) { return (v??0).toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—"; }

function StatusBadge({ status }) {
  const cls = {"In Progress":"progress",Fulfilled:"fulfilled",Stalled:"stalled"}[status]||"progress";
  return <span className={`status-badge ${cls}`}>{status}</span>;
}

export default function QuotesPage() {
  const [quotes,  setQuotes]  = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(null);  // drawer

  // Filters
  const [statusFilter, setStatusFilter] = useState(null);
  const [search,       setSearch]       = useState("");
  const [period,       setPeriod]       = useState("all");
  const [sortValue,    setSortValue]    = useState(null); // null | 'asc' | 'desc'
  const [filterSDR,    setFilterSDR]    = useState("");
  const [filterBrand,  setFilterBrand]  = useState("");
  const [openFilter,   setOpenFilter]   = useState(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [q, s] = await Promise.all([api.quotes.list(), api.dashboard.summary()]);
      setQuotes(q);
      setSummary(s);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  // Sync selected drawer quote after refresh
  useEffect(() => {
    setSelected(current => {
      if (!current) return current;
      return quotes.find(q => q.id === current.id) || current;
    });
  }, [quotes]);

  async function handleSave(payload) {
    if (editing.id) await api.quotes.update(editing.id, payload);
    else            await api.quotes.create(payload);
    setEditing(null);
    load();
  }

  async function handleDelete(id) {
    if (!confirm("Delete this quote?")) return;
    await api.quotes.remove(id);
    if (selected?.id === id) setSelected(null);
    load();
  }

  function cycleSort() {
    setSortValue(v => v === null ? "desc" : v === "desc" ? "asc" : null);
  }

  function clearFilters() {
    setStatusFilter(null); setSearch(""); setPeriod("all");
    setSortValue(null); setFilterSDR(""); setFilterBrand("");
  }

  const hasFilters = statusFilter || search || period !== "all" || sortValue || filterSDR || filterBrand;

  const visible = useMemo(() => {
    let r = [...quotes];
    if (search)        r = r.filter(q => q.business_name.toLowerCase().includes(search.toLowerCase()));
    if (statusFilter)  r = r.filter(q => q.status === statusFilter);
    if (filterSDR)     r = r.filter(q => q.associated_sdr === filterSDR);
    if (filterBrand)   r = r.filter(q => q.line_items?.some(l => l.brand === filterBrand));
    if (period !== "all") r = r.filter(q => inDateRange(q.date_requested, period));
    if (sortValue === "asc")  r.sort((a,b) => (a.quote_value||0) - (b.quote_value||0));
    if (sortValue === "desc") r.sort((a,b) => (b.quote_value||0) - (a.quote_value||0));
    return r;
  }, [quotes, search, statusFilter, filterSDR, filterBrand, period, sortValue]);

  const counts = quotes.reduce((acc, q) => { acc[q.status] = (acc[q.status]||0)+1; return acc; }, {});
  const sortLabel = sortValue === "asc" ? "Value ↑" : sortValue === "desc" ? "Value ↓" : "Value ⇅";
  const sdrOptions = useMemo(() => [...new Set(quotes.map(q => q.associated_sdr).filter(Boolean))].sort(), [quotes]);
  const sdrFilterOptions = [{ value: "", label: "All SDRs" }, ...sdrOptions.map(s => ({ value: s, label: s }))];
  const brandFilterOptions = [{ value: "", label: "All brands" }, ...BRANDS.map(b => ({ value: b, label: b }))];

  return (
    <div className="list-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Quotes</h1>
          <p className="page-sub">Track and manage quote requests across all accounts.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing({})}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New quote
        </button>
      </div>

      {summary && (
        <div className="summary-cards">
          <div className="summary-card"><div className="s-label">Total quotes</div><div className="s-value">{summary.total_quotes}</div></div>
          <div className="summary-card"><div className="s-label">Pipeline value</div><div className="s-value">{fmt$(summary.total_quote_value)}</div></div>
          <div className="summary-card"><div className="s-label">Avg. quote value</div><div className="s-value">{fmt$(summary.avg_quote_value)}</div></div>
          <div className="summary-card"><div className="s-label">Stalled</div><div className="s-value danger">{summary.stalled_count}</div></div>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="data-card record-list-card">

        {/* Row 1: status tabs + search */}
        <div className="toolbar">
          {[{key:null,label:"All"},{key:"In Progress",label:"In progress"},{key:"Fulfilled",label:"Fulfilled"},{key:"Stalled",label:"Stalled"}].map(f => (
            <button key={String(f.key)} className={`filter-tab ${statusFilter===f.key?"active":""}`} onClick={() => setStatusFilter(f.key)}>
              {f.label}
              <span className="tab-count">{f.key ? (counts[f.key]||0) : quotes.length}</span>
            </button>
          ))}
          <div className="search-wrap">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input placeholder="Search quotes…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {/* Row 2: date, sort, SDR, brand */}
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
          <FilterDropdown value={filterBrand} options={brandFilterOptions} open={openFilter === "brand"} onOpenChange={open => setOpenFilter(open ? "brand" : null)} onChange={setFilterBrand} />
          {hasFilters && <button className="filter-clear-btn" onClick={clearFilters}>Clear filters</button>}
        </div>

        <div className="record-list-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Business name</th>
                <th>Requested by</th>
                <th>Value</th>
                <th>Brands</th>
                <th>Date</th>
                <th>Status</th>
                <th>SDR</th>
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="empty-state">Loading…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={8} className="empty-state">No quotes match this view.</td></tr>
              ) : visible.map(q => (
                <tr key={q.id} style={{ cursor:"pointer" }} onClick={() => setSelected(q)}>
                  <td className="col-name">{q.business_name}</td>
                  <td>{q.requested_by||"—"}</td>
                  <td>{fmt$(q.quote_value)}</td>
                  <td className="col-brands"><BrandChips lineItems={q.line_items||[]} /></td>
                  <td>{fmtDate(q.date_requested)}</td>
                  <td><StatusBadge status={q.status} /></td>
                  <td style={{fontSize:12}}>{q.associated_sdr||"—"}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="row-actions">
                      <button className="row-action-btn" onClick={() => setEditing(q)}>Edit</button>
                      <button className="row-action-btn danger" onClick={() => handleDelete(q.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="table-footer">
          <span className="table-footer-label">
            Showing {visible.length} of {quotes.length} quotes
            {hasFilters ? " — filters active" : ""}
          </span>
        </div>
      </div>

      {editing && <QuoteFormModal quote={editing} onClose={() => setEditing(null)} onSave={handleSave} />}
      {selected && (
        <QuoteDetailDrawer
          quote={selected}
          onClose={() => setSelected(null)}
          onEdit={(q) => { setSelected(null); setEditing(q); }}
        />
      )}
    </div>
  );
}
