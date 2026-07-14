// Name/email/phone/state normalization + city autocomplete data.
// Ported from the HTML mockup's inline JS — same logic, same honest limits:
// this is a static ~120-city list, not a real geocoding API. True fuzzy/typo
// correction would need the same real address API already scoped for AI
// address verification (see schema-design conversation) — worth reusing
// that instead of building a second lookup service, whenever it's built.

export function formatName(raw) {
  return raw.trim().replace(/\s+/g, " ").split(" ").map(word =>
    word.split("-").map(part =>
      !part ? part : part.split("'").map(seg =>
        seg ? seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase() : seg
      ).join("'")
    ).join("-")
  ).join(" ");
}

export function formatEmail(raw) {
  return raw.trim().toLowerCase();
}

export function formatPhone(raw) {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length === 10) return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
  return raw.trim();
}

const STATE_MAP = {
  alabama: "AL", al: "AL", alaska: "AK", ak: "AK", arizona: "AZ", ariz: "AZ", az: "AZ",
  arkansas: "AR", ark: "AR", ar: "AR", california: "CA", calif: "CA", cali: "CA", ca: "CA",
  colorado: "CO", colo: "CO", co: "CO", connecticut: "CT", conn: "CT", ct: "CT",
  delaware: "DE", del: "DE", de: "DE", florida: "FL", fla: "FL", fl: "FL",
  georgia: "GA", ga: "GA", hawaii: "HI", hi: "HI", idaho: "ID", id: "ID",
  illinois: "IL", ill: "IL", il: "IL", indiana: "IN", ind: "IN", in: "IN",
  iowa: "IA", ia: "IA", kansas: "KS", kans: "KS", ks: "KS", kentucky: "KY", ky: "KY",
  louisiana: "LA", la: "LA", maine: "ME", me: "ME", maryland: "MD", md: "MD",
  massachusetts: "MA", mass: "MA", ma: "MA", michigan: "MI", mich: "MI", mi: "MI",
  minnesota: "MN", minn: "MN", mn: "MN", mississippi: "MS", miss: "MS", ms: "MS",
  missouri: "MO", mo: "MO", montana: "MT", mont: "MT", mt: "MT",
  nebraska: "NE", nebr: "NE", ne: "NE", nevada: "NV", nev: "NV", nv: "NV",
  "new hampshire": "NH", nh: "NH", "new jersey": "NJ", nj: "NJ", "new mexico": "NM", nm: "NM",
  "new york": "NY", ny: "NY", "north carolina": "NC", nc: "NC", "north dakota": "ND", nd: "ND",
  ohio: "OH", oh: "OH", oklahoma: "OK", okla: "OK", ok: "OK", oregon: "OR", oreg: "OR", or: "OR",
  pennsylvania: "PA", penn: "PA", penna: "PA", pa: "PA", "rhode island": "RI", ri: "RI",
  "south carolina": "SC", sc: "SC", "south dakota": "SD", sd: "SD",
  tennessee: "TN", tenn: "TN", tn: "TN", texas: "TX", tex: "TX", tx: "TX",
  utah: "UT", ut: "UT", vermont: "VT", vt: "VT", virginia: "VA", va: "VA",
  washington: "WA", wash: "WA", wa: "WA", "west virginia": "WV", wv: "WV",
  wisconsin: "WI", wisc: "WI", wi: "WI", wyoming: "WY", wyo: "WY", wy: "WY",
  "district of columbia": "DC", "washington dc": "DC", dc: "DC",
};

export function formatState(raw) {
  const key = raw.trim().toLowerCase().replace(/\./g, "");
  if (STATE_MAP[key]) return STATE_MAP[key];
  if (/^[a-zA-Z]{2}$/.test(raw.trim())) return raw.trim().toUpperCase();
  return raw.trim();
}

export const STATE_LIST = [
  { name: "Alabama", abbr: "AL" }, { name: "Alaska", abbr: "AK" }, { name: "Arizona", abbr: "AZ" }, { name: "Arkansas", abbr: "AR" },
  { name: "California", abbr: "CA" }, { name: "Colorado", abbr: "CO" }, { name: "Connecticut", abbr: "CT" }, { name: "Delaware", abbr: "DE" },
  { name: "District of Columbia", abbr: "DC" }, { name: "Florida", abbr: "FL" }, { name: "Georgia", abbr: "GA" }, { name: "Hawaii", abbr: "HI" },
  { name: "Idaho", abbr: "ID" }, { name: "Illinois", abbr: "IL" }, { name: "Indiana", abbr: "IN" }, { name: "Iowa", abbr: "IA" },
  { name: "Kansas", abbr: "KS" }, { name: "Kentucky", abbr: "KY" }, { name: "Louisiana", abbr: "LA" }, { name: "Maine", abbr: "ME" },
  { name: "Maryland", abbr: "MD" }, { name: "Massachusetts", abbr: "MA" }, { name: "Michigan", abbr: "MI" }, { name: "Minnesota", abbr: "MN" },
  { name: "Mississippi", abbr: "MS" }, { name: "Missouri", abbr: "MO" }, { name: "Montana", abbr: "MT" }, { name: "Nebraska", abbr: "NE" },
  { name: "Nevada", abbr: "NV" }, { name: "New Hampshire", abbr: "NH" }, { name: "New Jersey", abbr: "NJ" }, { name: "New Mexico", abbr: "NM" },
  { name: "New York", abbr: "NY" }, { name: "North Carolina", abbr: "NC" }, { name: "North Dakota", abbr: "ND" }, { name: "Ohio", abbr: "OH" },
  { name: "Oklahoma", abbr: "OK" }, { name: "Oregon", abbr: "OR" }, { name: "Pennsylvania", abbr: "PA" }, { name: "Rhode Island", abbr: "RI" },
  { name: "South Carolina", abbr: "SC" }, { name: "South Dakota", abbr: "SD" }, { name: "Tennessee", abbr: "TN" }, { name: "Texas", abbr: "TX" },
  { name: "Utah", abbr: "UT" }, { name: "Vermont", abbr: "VT" }, { name: "Virginia", abbr: "VA" }, { name: "Washington", abbr: "WA" },
  { name: "West Virginia", abbr: "WV" }, { name: "Wisconsin", abbr: "WI" }, { name: "Wyoming", abbr: "WY" },
];

export const CITY_LIST = [
  { c: "Los Angeles", s: "CA" }, { c: "San Diego", s: "CA" }, { c: "San Jose", s: "CA" }, { c: "San Francisco", s: "CA" },
  { c: "Fresno", s: "CA" }, { c: "Sacramento", s: "CA" }, { c: "Long Beach", s: "CA" }, { c: "Oakland", s: "CA" },
  { c: "Bakersfield", s: "CA" }, { c: "Anaheim", s: "CA" }, { c: "Santa Ana", s: "CA" }, { c: "Riverside", s: "CA" },
  { c: "Stockton", s: "CA" }, { c: "Irvine", s: "CA" }, { c: "Ontario", s: "CA" }, { c: "Torrance", s: "CA" },
  { c: "Pasadena", s: "CA" }, { c: "Fullerton", s: "CA" }, { c: "Santa Clara", s: "CA" }, { c: "Santa Monica", s: "CA" },
  { c: "New York", s: "NY" }, { c: "Buffalo", s: "NY" }, { c: "Rochester", s: "NY" },
  { c: "Chicago", s: "IL" }, { c: "Houston", s: "TX" }, { c: "San Antonio", s: "TX" }, { c: "Dallas", s: "TX" },
  { c: "Austin", s: "TX" }, { c: "Fort Worth", s: "TX" }, { c: "El Paso", s: "TX" }, { c: "Phoenix", s: "AZ" },
  { c: "Tucson", s: "AZ" }, { c: "Mesa", s: "AZ" }, { c: "Philadelphia", s: "PA" }, { c: "Pittsburgh", s: "PA" },
  { c: "Jacksonville", s: "FL" }, { c: "Miami", s: "FL" }, { c: "Tampa", s: "FL" }, { c: "Orlando", s: "FL" },
  { c: "Columbus", s: "OH" }, { c: "Cleveland", s: "OH" }, { c: "Cincinnati", s: "OH" }, { c: "Charlotte", s: "NC" },
  { c: "Raleigh", s: "NC" }, { c: "Indianapolis", s: "IN" }, { c: "Seattle", s: "WA" }, { c: "Spokane", s: "WA" },
  { c: "Denver", s: "CO" }, { c: "Colorado Springs", s: "CO" }, { c: "Boston", s: "MA" }, { c: "Detroit", s: "MI" },
  { c: "Nashville", s: "TN" }, { c: "Memphis", s: "TN" }, { c: "Portland", s: "OR" }, { c: "Las Vegas", s: "NV" },
  { c: "Reno", s: "NV" }, { c: "Louisville", s: "KY" }, { c: "Baltimore", s: "MD" }, { c: "Milwaukee", s: "WI" },
  { c: "Albuquerque", s: "NM" }, { c: "Atlanta", s: "GA" }, { c: "Kansas City", s: "MO" }, { c: "St. Louis", s: "MO" },
  { c: "Omaha", s: "NE" }, { c: "Minneapolis", s: "MN" }, { c: "Tulsa", s: "OK" }, { c: "Oklahoma City", s: "OK" },
  { c: "Wichita", s: "KS" }, { c: "New Orleans", s: "LA" }, { c: "Salt Lake City", s: "UT" }, { c: "Honolulu", s: "HI" },
];

export function cityMatches(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return CITY_LIST.filter(item => item.c.toLowerCase().startsWith(q)).slice(0, 8);
}

export function stateMatches(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return STATE_LIST.filter(item => item.name.toLowerCase().startsWith(q) || item.abbr.toLowerCase().startsWith(q)).slice(0, 8);
}
