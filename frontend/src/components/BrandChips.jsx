import { useState } from "react";

const BRAND_STYLES = {
  TitanFlex:  { bg: "#FAF5FF", color: "#7E22CE" },
  SwiftGrip:  { bg: "#FFF7ED", color: "#C2410C" },
  Schneider:  { bg: "#EFF6FF", color: "#1D4ED8" },
  SwiftLite:  { bg: "#F0FDF4", color: "#15803D" },
};

function Chip({ brand }) {
  const style = BRAND_STYLES[brand] || { bg: "#F1F5F9", color: "#475569" };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 500,
      background: style.bg,
      color: style.color,
      whiteSpace: "nowrap",
    }}>
      {brand}
    </span>
  );
}

export default function BrandChips({ lineItems = [] }) {
  const [open, setOpen] = useState(false);
  const brands = lineItems.map((item) => item.brand).filter(Boolean);

  if (brands.length === 0) return <span style={{ color: "#94A3B8", fontSize: 13 }}>—</span>;
  if (brands.length === 1) return <Chip brand={brands[0]} />;

  return (
    <div
      style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 5 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Chip brand={brands[0]} />
      <span style={{
        background: "#F1F5F9", color: "#475569",
        padding: "2px 7px", borderRadius: 4,
        fontSize: 11, fontWeight: 500, cursor: "default",
      }}>
        +{brands.length - 1} more
      </span>

      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          left: 0,
          zIndex: 50,
          background: "#fff",
          border: "0.5px solid #E2E8F0",
          borderRadius: 6,
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          whiteSpace: "nowrap",
        }}>
          {brands.map((b) => <Chip key={b} brand={b} />)}
        </div>
      )}
    </div>
  );
}
