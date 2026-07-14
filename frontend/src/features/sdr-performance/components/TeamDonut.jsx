import { ACCENTS } from "../constants";

export default function TeamDonut({ sdrs, callsDelta }) {
  const total = sdrs.reduce((s, r) => s + r.calls, 0) || 1;
  let cum = 0;
  const stops = sdrs
    .map((r, i) => {
      const pct = (r.calls / total) * 100;
      const seg = `${ACCENTS[i % ACCENTS.length]} ${cum.toFixed(2)}% ${(cum + pct).toFixed(2)}%`;
      cum += pct;
      return seg;
    })
    .join(", ");

  return (
    <div className="team-comp">
      <div className="donut-wrap">
        <div className="donut" style={{ background: `conic-gradient(${stops})` }} />
        <div className="donut-center">
          <div className="n">{total.toLocaleString()}</div>
          <div className="d">Team Calls</div>
          {callsDelta && (
            <div className={`dl ${callsDelta.dir}`}>
              {callsDelta.dir === "flat" ? "—" : `${callsDelta.dir === "up" ? "▲" : "▼"} ${callsDelta.pct}%`}
            </div>
          )}
        </div>
      </div>
      <div className="legend">
        {sdrs.map((r, i) => {
          const pct = ((r.calls / total) * 100).toFixed(1);
          return (
            <div className="legend-row" key={r.name}>
              <span className="legend-dot" style={{ background: ACCENTS[i % ACCENTS.length] }} />
              <span className="legend-name">{r.name}</span>
              <span className="legend-count">{r.calls}</span>
              <span className="legend-pct">({pct}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
