import { useEffect, useState, useMemo } from "react";
import { api } from "../api/client";
import "../components/shared.css";

const PERIODS = [
  { key: "all",   label: "All time" },
  { key: "today", label: "Today"    },
  { key: "week",  label: "This week"  },
  { key: "month", label: "This month" },
  { key: "year",  label: "This year"  },
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

function fmt$(v, compact = false) {
  if (compact && v >= 1000) return `$${(v/1000).toFixed(1)}k`;
  return (v??0).toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});
}

function KPICard({ label, value, sub }) {
  return (
    <div className="dash-card">
      <div className="dash-card-label">{label}</div>
      <div className="dash-card-value">{value}</div>
      {sub && <div className="dash-card-sub">{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const [quotes,  setQuotes]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [period,  setPeriod]  = useState("all");

  async function load() {
    setLoading(true); setError(null);
    try { setQuotes(await api.quotes.list()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  // Filter quotes by date.
  const filtered = useMemo(() => {
    return quotes.filter(q => inDateRange(q.date_requested, period));
  }, [quotes, period]);

  // Overall KPIs
  const totals = useMemo(() => {
    const count = filtered.length;
    const total = filtered.reduce((sum, q) => sum + (q.quote_value||0), 0);
    return { count, total, avg: count > 0 ? total / count : 0 };
  }, [filtered]);

  // Per-SDR breakdown
  const sdrRows = useMemo(() => {
    const map = {};
    for (const q of filtered) {
      const key = q.associated_sdr || "Unassigned";
      if (!map[key]) map[key] = { name: key, count: 0, total: 0 };
      map[key].count += 1;
      map[key].total += q.quote_value || 0;
    }
    return Object.values(map)
      .map(s => ({ ...s, avg: s.count > 0 ? s.total / s.count : 0 }))
      .sort((a, b) => b.total - a.total);
  }, [filtered]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Quote performance by SDR.</p>
        </div>
        <button className="btn-secondary" onClick={load}>↻ Refresh</button>
      </div>

      {/* Filters */}
      <div className="dash-filters">
        <div className="filter-period">
          {PERIODS.map(p => (
            <button key={p.key} className={`filter-period-btn ${period===p.key?"active":""}`} onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        {period !== "all" && (
          <button className="filter-clear-btn" onClick={() => setPeriod("all")}>
            Clear filters
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Overall KPI cards */}
      <div className="dash-cards">
        <KPICard label="Quote count"       value={totals.count} />
        <KPICard label="Total quote value" value={fmt$(totals.total)} />
        <KPICard label="Avg. quote value"  value={fmt$(totals.avg)} />
      </div>

      {loading ? (
        <p style={{ textAlign:"center", color:"var(--text-muted)", padding:"40px 0" }}>Loading…</p>
      ) : sdrRows.length === 0 ? (
        <p style={{ textAlign:"center", color:"var(--text-muted)", padding:"40px 0" }}>No quotes match the selected filters.</p>
      ) : (
        <div className="dash-section">
          <div className="dash-section-header">
            <p className="dash-section-title">Breakdown by SDR</p>
          </div>
          <table className="data-table dash-breakdown-table">
            <thead>
              <tr>
                <th>SDR</th>
                <th>Quote count</th>
                <th>Total quote value</th>
                <th>Avg. quote value</th>
              </tr>
            </thead>
            <tbody>
              {sdrRows.map(row => (
                <tr key={row.name}>
                  <td className="col-name">{row.name}</td>
                  <td>{row.count}</td>
                  <td>{fmt$(row.total)}</td>
                  <td>{fmt$(row.avg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="table-footer">
            <span className="table-footer-label">
              {totals.count} quote{totals.count !== 1 ? "s" : ""} across {sdrRows.length} SDR{sdrRows.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
