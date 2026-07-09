import ClockDial from "./ClockDial";
import SpanBar from "./SpanBar";
import { ACCENTS } from "../constants";

function DeltaBox({ delta }) {
  if (!delta || delta.dir === "flat") return <div className="dl flat">—</div>;
  return (
    <div className={`dl ${delta.dir}`}>{delta.dir === "up" ? "▲" : "▼"}{delta.pct}%</div>
  );
}

function MixDelta({ delta }) {
  if (!delta) return null;
  return (
    <span className={`sdr-legend-delta ${delta.dir}`}>
      {delta.dir === "flat" ? "—" : `${delta.dir === "up" ? "▲" : "▼"}${delta.pct}%`}
    </span>
  );
}

export default function SdrCard({ sdr, index, granularity }) {
  const accent = ACCENTS[index % ACCENTS.length];
  const { mix } = sdr;
  const b1 = mix.connected;
  const b2 = mix.connected + mix.voicemail;
  const gradient = `conic-gradient(var(--c-connected) 0% ${b1}%, var(--c-voicemail) ${b1}% ${b2}%, var(--c-other) ${b2}% 100%)`;

  return (
    <div className="sdr-card" style={{ "--accent": accent }}>
      <div className="sdr-card-head">
        <span className="sdr-badge" style={{ background: accent }}>{index + 1}</span>
        <span className="sdr-name">{sdr.name}</span>
      </div>

      <div className="sdr-top">
        <div className="sdr-donut-block">
          <div className="sdr-donut-wrap">
            <div className="sdr-donut" style={{ background: gradient }} />
            <div className="sdr-donut-center">
              <div className="n">{sdr.calls}</div>
              <div className="d">Calls</div>
            </div>
          </div>
          <div className="sdr-legend">
            <div className="sdr-legend-row">
              <span className="sdr-legend-dot" style={{ background: "var(--c-connected)" }} />
              <span className="sdr-legend-label">Connected</span>
              <span className="sdr-legend-val">{mix.connected}%</span>
              <MixDelta delta={mix.connectedDelta} />
            </div>
            <div className="sdr-legend-row">
              <span className="sdr-legend-dot" style={{ background: "var(--c-voicemail)" }} />
              <span className="sdr-legend-label">Voicemail</span>
              <span className="sdr-legend-val">{mix.voicemail}%</span>
              <MixDelta delta={mix.voicemailDelta} />
            </div>
            <div className="sdr-legend-row">
              <span className="sdr-legend-dot" style={{ background: "var(--c-other)" }} />
              <span className="sdr-legend-label">Other</span>
              <span className="sdr-legend-val">{mix.other}%</span>
              <MixDelta delta={mix.otherDelta} />
            </div>
          </div>
        </div>

        <div className="sdr-time-block">
          {granularity === "daily" ? (
            <div className="clock-row">
              <div>
                <div className="clock-time">{sdr.clock?.timeLabel}</div>
                <ClockDial start={sdr.clock?.start} end={sdr.clock?.end} idle={sdr.clock?.idle} />
              </div>
              <div className="clock-legend">
                <div className="clock-legend-row"><span className="clock-legend-dot" style={{ background: "var(--c-active)" }} />Active <span className="clock-legend-val">{sdr.clock?.activeHrs}h</span></div>
                <div className="clock-legend-row"><span className="clock-legend-dot" style={{ background: "var(--c-idle)" }} />Idle <span className="clock-legend-val">{sdr.clock?.idleHrs}h</span></div>
              </div>
            </div>
          ) : (
            <SpanBar active={sdr.span8?.active ?? 0} idle={sdr.span8?.idle ?? 0} />
          )}
        </div>
      </div>

      <div className="sdr-stats">
        <div className="stat-box">
          <div className="v" style={{ color: "var(--sdr-2)" }}>{sdr.samples.v}</div>
          <div className="l">Samples</div>
          <DeltaBox delta={sdr.samples.delta} />
        </div>
        <div className="stat-box">
          <div className="v" style={{ color: "var(--c-connected)" }}>{sdr.convert.v}%</div>
          <div className="l">Convert</div>
          <DeltaBox delta={sdr.convert.delta} />
        </div>
        <div className="stat-box">
          <div className="v" style={{ color: "var(--sdr-3)" }}>{sdr.quotes.v}</div>
          <div className="l">Quotes</div>
          <DeltaBox delta={sdr.quotes.delta} />
        </div>
      </div>
    </div>
  );
}
