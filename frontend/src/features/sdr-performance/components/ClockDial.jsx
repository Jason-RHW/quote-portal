// Segmented clock dial — one wedge per 15-minute chunk of an SDR's call
// span for the day. Green if that chunk had a call, amber if not. This is
// a React port of the same polar-coordinate math used in the standalone
// mockup (and originally reverse-engineered from sdr-daily-report's
// chart_svg.py, which draws the identical chart for the email PDF).

const SIZE = 120;
const CX = SIZE / 2;
const CY = SIZE / 2;
const FACE_R = SIZE / 2 - 4;
const TRACK_R = FACE_R - 16;
const THICKNESS = 13;

function polar(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180; // 0deg = 12 o'clock, clockwise
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, a1, a2) {
  const p1 = polar(cx, cy, r, a1);
  const p2 = polar(cx, cy, r, a2);
  const large = ((a2 - a1 + 360) % 360) > 180 ? 1 : 0;
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
}

/**
 * @param {number} start - decimal hour, e.g. 7.9167 = 7:55 AM
 * @param {number} end - decimal hour
 * @param {number[]} idle - indices of inactive 15-min chunks
 */
export default function ClockDial({ start, end, idle = [] }) {
  if (start == null || end == null) {
    return <div className="clock-dial clock-dial-empty" aria-hidden="true" />;
  }

  const startAngle = ((start % 12) / 12) * 360;
  const endAngle = ((end % 12) / 12) * 360;
  const spanAngle = (endAngle - startAngle + 360) % 360;
  const spanMinutes = (((end - start) + 24) % 24) * 60;
  const numSegs = Math.max(1, Math.round(spanMinutes / 15));
  const segAngle = spanAngle / numSegs;
  const idleSet = new Set(idle);

  const hourMarks = Array.from({ length: 12 }, (_, h) => {
    const a = h * 30;
    const t1 = polar(CX, CY, FACE_R - 3, a);
    const t2 = polar(CX, CY, FACE_R - 7, a);
    const np = polar(CX, CY, TRACK_R - 12, a);
    return { key: h, t1, t2, np, label: h === 0 ? "12" : h };
  });

  const segments = Array.from({ length: numSegs }, (_, i) => {
    const a1 = startAngle + i * segAngle;
    const a2 = startAngle + (i + 1) * segAngle;
    return {
      key: i,
      d: arcPath(CX, CY, TRACK_R, a1, a2),
      color: idleSet.has(i) ? "var(--c-idle)" : "var(--c-active)",
    };
  });

  const startDot = polar(CX, CY, TRACK_R, startAngle);
  const endDot = polar(CX, CY, TRACK_R, endAngle);

  return (
    <svg className="clock-dial" viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE}>
      <circle cx={CX} cy={CY} r={FACE_R} fill="#FAFAFB" stroke="#E5E7EB" strokeWidth="1" />
      {hourMarks.map((h) => (
        <g key={h.key}>
          <line x1={h.t1.x} y1={h.t1.y} x2={h.t2.x} y2={h.t2.y} stroke="#D1D5DB" strokeWidth="1" />
          <text x={h.np.x} y={h.np.y + 3} textAnchor="middle" fontSize="9" fill="#9CA3AF">{h.label}</text>
        </g>
      ))}
      <circle cx={CX} cy={CY} r={TRACK_R} fill="none" stroke="#F0F1F3" strokeWidth={THICKNESS} />
      {segments.map((s) => (
        <path key={s.key} d={s.d} fill="none" stroke={s.color} strokeWidth={THICKNESS} strokeLinecap="butt" />
      ))}
      <circle cx={startDot.x} cy={startDot.y} r="3.2" fill="#111827" />
      <circle cx={endDot.x} cy={endDot.y} r="3.2" fill="#111827" />
    </svg>
  );
}
