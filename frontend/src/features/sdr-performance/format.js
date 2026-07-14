export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function dateFromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function weekToMonday(key) {
  const [yearStr, weekStr] = key.split("-W");
  const year = Number(yearStr);
  const week = Number(weekStr);
  const jan4 = new Date(year, 0, 4);
  const day = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - day + 1 + (week - 1) * 7);
  return monday;
}

export function formatDailyLabel(key) {
  return dateFromKey(key).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "2-digit" });
}

export function formatWeeklyLabel(key) {
  const start = weekToMonday(key);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `Week of ${start.toLocaleDateString("en-US", { month: "short", day: "2-digit" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "2-digit" })}`;
}

export function formatMonthlyLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function labelFor(granularity, key) {
  if (!key) return "";
  if (granularity === "daily") return formatDailyLabel(key);
  if (granularity === "weekly") return formatWeeklyLabel(key);
  return formatMonthlyLabel(key);
}
