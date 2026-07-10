import { useEffect, useState } from "react";
import { api } from "../../api/client";
import PeriodPicker from "./components/PeriodPicker";
import TeamDonut from "./components/TeamDonut";
import SdrCard from "./components/SdrCard";
import "./sdr-performance.css";

const KPI_DEFS = [
  { key: "quotes",    label: "Total Quotes", fmt: (v) => v },
  { key: "connect",   label: "Avg Connect",  fmt: (v) => `${v}%` },
  { key: "convert",   label: "Avg Convert",  fmt: (v) => `${v}%` },
  { key: "samples",   label: "Samples Sent", fmt: (v) => v },
  { key: "activeHrs", label: "Active Hrs",   fmt: (v) => v },
];

function fetchReport(granularity, key) {
  if (granularity === "daily") return api.sdrPerformance.daily(key);
  if (granularity === "weekly") return api.sdrPerformance.weekly(key);
  return api.sdrPerformance.monthly(key);
}

export default function SdrPerformancePage() {
  const [periods, setPeriods] = useState(null);
  const [granularity, setGranularity] = useState("daily");
  const [selectedKey, setSelectedKey] = useState(null);
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | empty | error

  // Load available periods once, then default to the most recent daily report.
  useEffect(() => {
    api.sdrPerformance.periods()
      .then((p) => {
        setPeriods(p);
        const latest = p.daily[p.daily.length - 1];
        setSelectedKey(latest || null);
        if (!latest) setStatus("empty");
      })
      .catch(() => setStatus("error"));
  }, []);

  // Fetch the report whenever granularity or selected period changes.
  useEffect(() => {
    if (!selectedKey) return;
    setStatus("loading");
    fetchReport(granularity, selectedKey)
      .then((r) => { setReport(r); setStatus("ready"); })
      .catch((err) => {
        // The backend 404s when a period has no report (e.g. picked via
        // calendar before data existed). Treat that as an empty state,
        // not a hard error.
        if (String(err.message).startsWith("404")) {
          setReport(null);
          setStatus("empty");
        } else {
          setStatus("error");
        }
      });
  }, [granularity, selectedKey]);

  function handleGranularityChange(g) {
    setGranularity(g);
    const keys = periods?.[g] || [];
    setSelectedKey(keys.length ? keys[keys.length - 1] : null);
  }

  return (
    <div className="sdr-performance-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">SDR Performance</h1>
          <p className="page-sub">Outbound calls &amp; sample activity — Aircall + Sample Tracker, plus quotes from this portal.</p>
        </div>
      </div>

      {periods && (
        <div className="report-toolbar">
          <PeriodPicker
            granularity={granularity}
            onGranularityChange={handleGranularityChange}
            periods={periods}
            value={selectedKey}
            onChange={setSelectedKey}
          />
        </div>
      )}

      {status === "loading" && <div className="empty-state">Loading…</div>}

      {status === "error" && (
        <div className="empty-state">Couldn't load this report. Try again in a moment.</div>
      )}

      {status === "empty" && (
        <div className="dash-section">
          <div className="empty-state">
            {periods && periods.daily.length === 0
              ? "No SDR performance reports have been generated yet."
              : "No report was generated for this period."}
          </div>
        </div>
      )}

      {status === "ready" && report && (
        <>
          <div className="overview-grid">
            <div className="dash-section">
              <div className="dash-section-header"><h2 className="dash-section-title">Team Calls — by SDR</h2></div>
              <TeamDonut sdrs={report.sdrs} callsDelta={report.team.deltas.calls} />
            </div>
            <div className="kpi-grid">
              {KPI_DEFS.map((d) => {
                const delta = report.team.deltas[d.key];
                return (
                  <div className="kpi-card" key={d.key}>
                    <div className="kpi-label">{d.label}</div>
                    <div className="kpi-value">{d.fmt(report.team[d.key])}</div>
                    {delta && (
                      <span className={`kpi-delta ${delta.dir}`}>
                        {delta.dir === "flat" ? "—" : `${delta.dir === "up" ? "▲" : "▼"} ${delta.pct}%`}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="dash-section section-card">
            <div className="dash-section-header">
              <h2 className="dash-section-title">
                SDR breakdown{granularity !== "daily" ? ` — ${granularity} average` : ""}
              </h2>
              <span className="dash-section-sub">{report.sdrs.length} active SDR{report.sdrs.length === 1 ? "" : "s"}</span>
            </div>
            <div className="sdr-grid">
              {report.sdrs.map((sdr, i) => (
                <SdrCard key={sdr.name} sdr={sdr} index={i} granularity={granularity} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
