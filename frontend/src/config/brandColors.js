// Single source of truth for brand chip colors — used by BrandChips.jsx
// (Quotes) and the Samples feature, so both features render the same
// brand in the same color.
//
// Previously this lived as two separate, duplicated objects (in
// BrandChips.jsx and QuoteDetailDrawer.jsx) that had drifted out of sync
// with each other — TitanFlex was purple in Quotes but orange in the
// Sample Portal design, SwiftGrip was orange in Quotes but pink in
// Sample Portal. Consolidated here using the Sample Portal's palette,
// since that was the more recent, deliberate design decision.
//
// These also match the color_bg/color_text columns seeded on the `brands`
// table (see backend/seed_sample_portal.py) — eventually this file could
// be replaced entirely by GET /api/brands, making brand colors fully
// admin-editable instead of hardcoded here. Not done yet since Quotes
// doesn't fetch brands from the API today (its BRANDS list in
// QuoteFormModal.jsx / QuotesPage.jsx is a separate hardcoded array) —
// worth unifying in a later pass, flagged here rather than silently left.

export const BRAND_COLORS = {
  Schneider: { bg: "#EFF6FF", color: "#1D4ED8" },
  SwiftGrip: { bg: "#FDF2F8", color: "#BE185D" },
  SwiftLite: { bg: "#F0FDF4", color: "#15803D" },
  TitanFlex: { bg: "#FFF7ED", color: "#C2410C" },
  "Cut Resistant Gloves": { bg: "#ECFEFF", color: "#0E7490" },
  "Work Gloves": { bg: "#F5F3FF", color: "#6D28D9" },
  Bandage: { bg: "#FEF2F2", color: "#B91C1C" },
  "Safe & Savvy Cut Resistant Gloves": { bg: "#FFFBEB", color: "#B45309" },
};

export function brandStyle(brand) {
  return BRAND_COLORS[brand] || { bg: "#F1F5F9", color: "#475569" };
}
