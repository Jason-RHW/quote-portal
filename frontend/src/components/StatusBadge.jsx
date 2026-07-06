const STYLES = {
  "Fulfilled": { bg: "var(--green-bg)", color: "var(--green)" },
  "In Progress": { bg: "var(--amber-bg)", color: "var(--amber)" },
  "Stalled": { bg: "var(--red-bg)", color: "var(--red)" },
};

export default function StatusBadge({ status }) {
  const style = STYLES[status] || { bg: "var(--steel-200)", color: "var(--ink-muted)" };
  return (
    <span
      style={{
        background: style.bg,
        color: style.color,
        padding: "3px 10px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {status || "—"}
    </span>
  );
}
