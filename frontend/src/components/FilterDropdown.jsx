import { useEffect, useRef } from "react";

export default function FilterDropdown({ value, options, open, onOpenChange, onChange }) {
  const active = options.find(option => option.value === value) || options[0];
  const wrapRef = useRef(null);

  useEffect(() => {
    // mousedown + ref-containment instead of onBlur: a blur firing on
    // mousedown (before the option's click event) could unmount the menu
    // before the click ever reaches the option button, silently swallowing
    // the selection. See DateFilterCalendar.jsx for the same fix.
    //
    // Guarding on `open` matters here specifically because several
    // FilterDropdown instances share one mutually-exclusive `openFilter`
    // state in the parent: without this guard, every *closed* instance's
    // listener still fires on any outside mousedown (since the click is
    // "outside" their own wrapRef too) and calls onOpenChange(false) —
    // which collapses the shared state to null on mousedown, unmounting
    // the one dropdown that *is* open before its own option's click event
    // can fire.
    if (!open) return undefined;
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        onOpenChange(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onOpenChange]);

  return (
    <div ref={wrapRef} className="filter-dropdown">
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
