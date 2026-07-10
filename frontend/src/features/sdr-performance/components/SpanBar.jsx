// Active/idle time shown as real proportions of an 8-hour reference shift,
// not normalized to 100% — so a 4-hour day and a 7-hour day visibly differ.
export default function SpanBar({ active, idle }) {
  const off = Math.max(0, 8 - active - idle);
  const wActive = (active / 8) * 100;
  const wIdle = (idle / 8) * 100;

  return (
    <div className="span8-block">
      <div className="span-cap">Avg call span {(active + idle).toFixed(1)}h of an 8h shift</div>
      <div className="span8-scale">
        <div className="span8-seg" style={{ left: "0%", width: `${wActive}%`, background: "var(--c-active)" }} />
        <div className="span8-seg" style={{ left: `${wActive}%`, width: `${wIdle}%`, background: "var(--c-idle)" }} />
      </div>
      <div className="span8-ticks"><span>0h</span><span>2h</span><span>4h</span><span>6h</span><span>8h</span></div>
      <div className="span8-legend">
        <span className="span8-legend-item"><span className="span8-legend-dot" style={{ background: "var(--c-active)" }} />Active<span className="span8-legend-val">{active}h</span></span>
        <span className="span8-legend-item"><span className="span8-legend-dot" style={{ background: "var(--c-idle)" }} />Idle<span className="span8-legend-val">{idle}h</span></span>
        <span className="span8-legend-item"><span className="span8-legend-dot" style={{ background: "var(--c-off)" }} />Off calls<span className="span8-legend-val">{off.toFixed(1)}h</span></span>
      </div>
    </div>
  );
}
