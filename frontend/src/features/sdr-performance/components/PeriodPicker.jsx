import { useEffect, useRef, useState } from "react";
import { labelFor, dateFromKey, pad2 } from "../format";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

export default function PeriodPicker({ granularity, onGranularityChange, periods, value, onChange }) {
  const [ddOpen, setDdOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [calView, setCalView] = useState(() => {
    const d = value ? dateFromKey(value) : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const wrapRef = useRef(null);

  const keys = (periods?.[granularity] || []).slice().sort();
  const idx = keys.indexOf(value);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setDdOpen(false);
        setCalOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function openPicker() {
    if (granularity === "daily") {
      const d = value ? dateFromKey(value) : new Date();
      setCalView({ year: d.getFullYear(), month: d.getMonth() });
      setCalOpen((o) => !o);
      setDdOpen(false);
    } else {
      setDdOpen((o) => !o);
      setCalOpen(false);
    }
  }

  function shift(direction) {
    const next = idx + direction;
    if (next < 0 || next >= keys.length) return;
    onChange(keys[next]);
  }

  const dailySet = new Set(periods?.daily || []);

  return (
    <div className="period-controls">
      <div className="filter-period">
        {["daily", "weekly", "monthly"].map((g) => (
          <button
            key={g}
            className={`filter-period-btn ${granularity === g ? "active" : ""}`}
            onClick={() => onGranularityChange(g)}
          >
            {g[0].toUpperCase() + g.slice(1)}
          </button>
        ))}
      </div>

      <button className="btn-secondary period-nav-btn" onClick={() => shift(-1)} disabled={idx <= 0}>←</button>

      <div className="period-dd-wrap" ref={wrapRef}>
        <button className="period-label-btn" type="button" onClick={openPicker}>
          <span>{labelFor(granularity, value) || "Select a period"}</span>
          <span className="caret">▾</span>
        </button>

        {ddOpen && (
          <div className="period-dd-panel open">
            {keys.slice().reverse().map((k) => (
              <div
                key={k}
                className={`period-dd-item ${k === value ? "active" : ""}`}
                onClick={() => { onChange(k); setDdOpen(false); }}
              >
                {labelFor(granularity, k)}
              </div>
            ))}
            {keys.length === 0 && <div className="period-dd-item">No reports yet</div>}
          </div>
        )}

        {calOpen && (
          <CalendarPanel
            view={calView}
            onViewChange={setCalView}
            selected={value}
            availableDates={dailySet}
            onSelect={(k) => { onChange(k); setCalOpen(false); }}
          />
        )}
      </div>

      <button className="btn-secondary period-nav-btn" onClick={() => shift(1)} disabled={idx >= keys.length - 1 || idx === -1}>→</button>
    </div>
  );
}

function CalendarPanel({ view, onViewChange, selected, availableDates, onSelect }) {
  const { year, month } = view;
  const startWeekday = new Date(year, month, 1).getDay();
  const total = daysInMonth(year, month);
  const monthLabel = new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);

  function goMonth(delta) {
    let m = month + delta, y = year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    onViewChange({ year: y, month: m });
  }

  return (
    <div className="period-cal-panel open">
      <div className="cal-header">
        <button className="cal-nav-btn" type="button" onClick={() => goMonth(-1)}>‹</button>
        <span className="cal-header-label">{monthLabel}</span>
        <button className="cal-nav-btn" type="button" onClick={() => goMonth(1)}>›</button>
      </div>
      <div className="cal-grid">
        {WEEKDAYS.map((w) => <div className="cal-weekday" key={w}>{w}</div>)}
        {cells.map((d, i) => {
          if (d === null) return <div className="cal-day blank" key={`b${i}`} />;
          const key = `${year}-${pad2(month + 1)}-${pad2(d)}`;
          const hasData = availableDates.has(key);
          const isActive = key === selected;
          const cls = `cal-day${hasData ? "" : " no-data"}${isActive ? " active" : ""}`;
          return (
            <div
              key={key}
              className={cls}
              aria-disabled={!hasData}
              onClick={hasData ? () => onSelect(key) : undefined}
            >
              {d}
            </div>
          );
        })}
      </div>
      <div className="cal-legend">Only dates with a generated report are selectable.</div>
    </div>
  );
}
