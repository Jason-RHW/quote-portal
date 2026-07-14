import { useEffect, useState } from "react";

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function DateFilterCalendar({ dataDates, selectedDate, selectedRange, onSelect, onRangeChange, onClear, isOpen, onOpenChange }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [mode, setMode] = useState(selectedRange?.from || selectedRange?.to ? "range" : "single");
  const initial = selectedDate ? new Date(selectedDate + "T00:00:00") : (dataDates.length ? new Date([...dataDates].sort().slice(-1)[0] + "T00:00:00") : new Date());
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const [rangeDraft, setRangeDraft] = useState({ from: selectedRange?.from || "", to: selectedRange?.to || "" });

  const dataSet = new Set(dataDates);
  const open = isOpen ?? internalOpen;

  function setOpen(nextOpen) {
    const resolved = typeof nextOpen === "function" ? nextOpen(open) : nextOpen;
    if (onOpenChange) onOpenChange(resolved);
    else setInternalOpen(resolved);
  }

  useEffect(() => {
    setRangeDraft({ from: selectedRange?.from || "", to: selectedRange?.to || "" });
  }, [selectedRange?.from, selectedRange?.to]);

  function shiftMonth(delta) {
    let m = viewMonth + delta, y = viewYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setViewMonth(m); setViewYear(y);
  }

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function isoFor(d) {
    return `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function fmtShort(iso) {
    if (!iso) return "";
    return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function handleDateClick(iso, hasData) {
    if (mode === "single") {
      if (!hasData) return;
      onRangeChange?.({ from: "", to: "" });
      onSelect(iso);
      setOpen(false);
      return;
    }

    if (!rangeDraft.from || rangeDraft.to) {
      const next = { from: iso, to: "" };
      setRangeDraft(next);
      onSelect?.(null);
      onRangeChange?.(next);
      return;
    }

    const next = iso < rangeDraft.from
      ? { from: iso, to: rangeDraft.from }
      : { from: rangeDraft.from, to: iso };
    setRangeDraft(next);
    onSelect?.(null);
    onRangeChange?.(next);
    setOpen(false);
  }

  const hasRange = selectedRange?.from || selectedRange?.to;
  const label = hasRange
    ? `${selectedRange.from || "Start"} - ${selectedRange.to || "End"}`
    : selectedDate
    ? new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "Filter by date";

  return (
    <div style={{ position: "relative" }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <button
        className={`filter-select filter-dropdown-trigger ${open ? "open" : ""}`}
        style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", ...((selectedDate || hasRange) ? { borderColor: "var(--enterprise-blue)", background: "var(--status-progress-bg)", color: "var(--enterprise-blue)", fontWeight: 600 } : {}) }}
        onClick={() => setOpen(o => !o)}
        type="button"
      >
        <span>{label}</span>
        <span className="filter-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, width: 250, background: "#fff",
          border: "0.5px solid var(--border)", borderRadius: 8, boxShadow: "0 10px 26px rgba(10,22,40,.14)", zIndex: 15, padding: 12,
        }}>
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            <button type="button" onClick={() => setMode("single")} style={mode === "single" ? activeModeBtnStyle : modeBtnStyle}>Single</button>
            <button type="button" onClick={() => setMode("range")} style={mode === "range" ? activeModeBtnStyle : modeBtnStyle}>Range</button>
          </div>

          {mode === "range" && (
            <div style={rangeHintStyle}>
              {rangeDraft.from
                ? rangeDraft.to
                  ? `${fmtShort(rangeDraft.from)} - ${fmtShort(rangeDraft.to)}`
                  : `${fmtShort(rangeDraft.from)} - select end date`
                : "Select start date"}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <button type="button" onClick={() => shiftMonth(-1)} style={navBtnStyle}>‹</button>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{MONTH_NAMES[viewMonth]} {viewYear}</span>
            <button type="button" onClick={() => shiftMonth(1)} style={navBtnStyle}>›</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", textAlign: "center", fontSize: 10, color: "var(--text-placeholder)", fontWeight: 600, marginBottom: 4 }}>
            {["S","M","T","W","T","F","S"].map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
            {cells.map((d, i) => {
              if (d === null) return <div key={i} style={{ aspectRatio: "1" }} />;
              const iso = isoFor(d);
              const hasData = dataSet.has(iso);
              const isSelected = selectedDate === iso;
              const isRangeStart = mode === "range" && rangeDraft.from === iso;
              const isRangeEnd = mode === "range" && rangeDraft.to === iso;
              const isInRange = mode === "range" && rangeDraft.from && rangeDraft.to && iso > rangeDraft.from && iso < rangeDraft.to;
              const isMarked = isSelected || isRangeStart || isRangeEnd;
              return (
                <div
                  key={i}
                  onClick={() => handleDateClick(iso, hasData)}
                  style={{
                    aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11.5, borderRadius: 5, position: "relative",
                    color: (hasData || mode === "range") ? "var(--text-primary)" : "var(--text-placeholder)",
                    fontWeight: (hasData || isMarked) ? 500 : 400,
                    cursor: mode === "range" || hasData ? "pointer" : "not-allowed",
                    background: isMarked ? "var(--enterprise-blue)" : isInRange ? "var(--status-progress-bg)" : "transparent",
                    ...(isMarked ? { color: "#fff" } : {}),
                  }}
                >
                  {d}
                  {hasData && !isMarked && !isInRange && <span style={{ position: "absolute", bottom: 2, width: 4, height: 4, borderRadius: "50%", background: "var(--enterprise-blue)" }} />}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, paddingTop: 8, borderTop: "0.5px solid var(--border)" }}>
            <span style={{ fontSize: 10.5, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--enterprise-blue)", display: "inline-block" }} /> has requests
            </span>
            <button type="button" onClick={() => { setRangeDraft({ from: "", to: "" }); onClear(); setOpen(false); }} style={{ background: "transparent", border: "none", color: "var(--enterprise-blue)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}

const navBtnStyle = { background: "transparent", border: "0.5px solid var(--border)", borderRadius: 4, width: 22, height: 22, fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" };
const modeBtnStyle = { flex: 1, height: 26, border: "0.5px solid var(--border)", borderRadius: 5, background: "var(--surface-card)", color: "var(--text-muted)", fontSize: 11.5, cursor: "pointer" };
const activeModeBtnStyle = { ...modeBtnStyle, borderColor: "var(--enterprise-blue)", background: "var(--status-progress-bg)", color: "var(--enterprise-blue)", fontWeight: 600 };
const rangeHintStyle = { marginBottom: 10, padding: "7px 9px", borderRadius: 5, background: "var(--surface-subtle)", color: "var(--text-muted)", fontSize: 11.5, fontWeight: 500 };
