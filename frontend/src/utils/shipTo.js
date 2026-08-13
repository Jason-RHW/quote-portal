// Ship To addresses are always displayed in this fixed 5-line format —
// Business Name / Street 1 / Street 2 / City / State Zip — regardless of
// whether the underlying string came from manual entry or AI extraction,
// or when it was saved. splitShipTo/joinShipTo normalize at both save time
// (new records) and render time (old records saved before this existed).

export function joinShipTo(f) {
  const lines = [
    f.ship_to_business_name,
    f.ship_to_address_line1,
    f.ship_to_address_line2,
    f.ship_to_city,
    f.ship_to_state_zip,
  ].map(s => (s || "").trim()).filter(Boolean);
  return lines.length ? lines.join("\n") : "";
}

export function splitShipTo(raw) {
  const blank = { ship_to_business_name: "", ship_to_address_line1: "", ship_to_address_line2: "", ship_to_city: "", ship_to_state_zip: "" };
  if (!raw) return blank;
  const lines = raw.split("\n").map(s => s.trim()).filter(Boolean);
  if (lines.length === 5) {
    return { ship_to_business_name: lines[0], ship_to_address_line1: lines[1], ship_to_address_line2: lines[2], ship_to_city: lines[3], ship_to_state_zip: lines[4] };
  }
  if (lines.length === 4) {
    return { ship_to_business_name: lines[0], ship_to_address_line1: lines[1], ship_to_address_line2: "", ship_to_city: lines[2], ship_to_state_zip: lines[3] };
  }
  // Legacy single-line, comma-joined addresses (e.g. "Acme Co, 123 Main St, Springfield IL 62701) —
  // best-effort split: business name, street, then "City STATE ZIP" (last two tokens = state+zip).
  if (lines.length === 1) {
    const parts = lines[0].split(",").map(s => s.trim()).filter(Boolean);
    if (parts.length === 3) {
      const tokens = parts[2].split(/\s+/);
      if (tokens.length >= 3 && /^\d{5}(-\d{4})?$/.test(tokens[tokens.length - 1])) {
        const stateZip = tokens.slice(-2).join(" ");
        const city = tokens.slice(0, -2).join(" ");
        if (city) return { ship_to_business_name: parts[0], ship_to_address_line1: parts[1], ship_to_address_line2: "", ship_to_city: city, ship_to_state_zip: stateZip };
      }
    }
  }
  return { ...blank, ship_to_address_line1: raw.trim() };
}

// Best-effort normalization for display: re-splits then re-joins so a
// legacy single-line/comma-joined string still renders in the fixed format
// where possible, instead of showing its original raw shape forever.
export function displayShipTo(raw) {
  return joinShipTo(splitShipTo(raw)) || raw || "";
}
