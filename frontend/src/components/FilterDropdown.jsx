export default function FilterDropdown({ value, options, open, onOpenChange, onChange }) {
  const active = options.find(option => option.value === value) || options[0];
  return (
    <div className="filter-dropdown" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) onOpenChange(false); }}>
      <button type="button" className={`filter-select filter-dropdown-trigger ${open ? "open" : ""}`} onClick={() => onOpenChange(!open)}>
        <span>{active?.label || ""}</span>
        <span className="filter-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="filter-dropdown-menu">
          {options.map(option => (
            <button
              key={String(option.value)}
              type="button"
              className={`filter-dropdown-option ${option.value === value ? "selected" : ""}`}
              onClick={() => { onChange(option.value); onOpenChange(false); }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
