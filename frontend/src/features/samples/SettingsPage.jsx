import { useEffect, useState } from "react";
import { api } from "../../api/client";
import "../../components/shared.css";
import "./samples.css";

const CORE_FIELDS = [
  { label: "Requested by (SDR)", type: "Dropdown", required: true },
  { label: "Contact full name", type: "Text", required: true },
  { label: "Email", type: "Text", required: true },
  { label: "Phone", type: "Text", required: false },
  { label: "Business name", type: "Text", required: true },
  { label: "Address, City, State, Zip", type: "Text", required: true },
];

const TYPE_LABELS = { text: "Text", number: "Number", dropdown: "Dropdown", textarea: "Textarea" };

function BrandsTab({ brands, reload }) {
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  async function toggleActive(brand) {
    await api.brands.update(brand.id, { active: !brand.active });
    reload();
  }

  async function addBrand() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await api.brands.create({ name: newName.trim(), color_bg: "#F1F5F9", color_text: "#475569", active: true });
      setNewName("");
      reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="brand-list" style={{ maxWidth: 520 }}>
      {brands.map(b => (
        <div className="brand-row" key={b.id}>
          <span className="brand-swatch" style={{ background: b.color_text || "#475569" }} />
          <span className={`name ${b.active ? "" : "inactive"}`} style={{ flex: 1 }}>{b.name}{!b.active && " (discontinued)"}</span>
          <div className={`switch ${b.active ? "on" : ""}`} onClick={() => toggleActive(b)}><div className="knob" /></div>
        </div>
      ))}
      <div className="add-brand-row">
        <input placeholder="New brand name..." value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && addBrand()} />
        <button className="btn-secondary" onClick={addBrand} disabled={saving}>{saving ? "Adding…" : "Add Brand"}</button>
      </div>
    </div>
  );
}

function SdrsTab({ sdrs, reload }) {
  const [newName, setNewName] = useState("");
  const [newOwnerId, setNewOwnerId] = useState("");
  const [saving, setSaving] = useState(false);

  async function toggleActive(sdr) {
    await api.sdrs.update(sdr.id, { active: !sdr.active });
    reload();
  }

  async function saveOwnerId(sdr, value) {
    const trimmed = value.trim();
    if (trimmed === (sdr.hubspot_owner_id || "")) return;
    await api.sdrs.update(sdr.id, { hubspot_owner_id: trimmed || null });
    reload();
  }

  async function addSdr() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await api.sdrs.create({ full_name: newName.trim(), active: true, hubspot_owner_id: newOwnerId.trim() || null });
      setNewName("");
      setNewOwnerId("");
      reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="brand-list roster-list" style={{ maxWidth: 640 }}>
      {sdrs.map(s => (
        <div className="brand-row" key={s.id}>
          <span className="sdr-avatar">{s.full_name.slice(0, 1).toUpperCase()}</span>
          <span className={`name ${s.active ? "" : "inactive"}`} style={{ flex: 1 }}>{s.full_name}{!s.active && " (inactive)"}</span>
          <input
            placeholder="HubSpot Owner ID"
            title="HubSpot user/owner ID — sets the contact/company owner in HubSpot when this SDR submits a sample request"
            defaultValue={s.hubspot_owner_id || ""}
            onBlur={e => saveOwnerId(s, e.target.value)}
            style={{ width: 150 }}
          />
          <div className={`switch ${s.active ? "on" : ""}`} onClick={() => toggleActive(s)}><div className="knob" /></div>
        </div>
      ))}
      <div className="add-brand-row">
        <input placeholder="New SDR name..." value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && addSdr()} />
        <input placeholder="HubSpot Owner ID (optional)" value={newOwnerId} onChange={e => setNewOwnerId(e.target.value)} onKeyDown={e => e.key === "Enter" && addSdr()} style={{ width: 170 }} />
        <button className="btn-secondary" onClick={addSdr} disabled={saving}>{saving ? "Adding…" : "Add SDR"}</button>
      </div>
    </div>
  );
}

function FormBuilderTab({ fields, reload }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newField, setNewField] = useState({ label: "", field_type: "text", options: "", required: false, multiple: false });

  async function moveField(field, direction) {
    const sorted = [...fields].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex(f => f.id === field.id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const other = sorted[swapIdx];
    await Promise.all([
      api.formFields.update(field.id, { sort_order: other.sort_order }),
      api.formFields.update(other.id, { sort_order: field.sort_order }),
    ]);
    reload();
  }

  async function removeField(field) {
    if (!window.confirm(`Remove "${field.label}" from the SDR form? Historical submissions keep their answers.`)) return;
    await api.formFields.remove(field.id);
    reload();
  }

  async function addField() {
    if (!newField.label.trim()) return;
    const options = newField.field_type === "dropdown" && newField.options.trim()
      ? newField.options.split(",").map(s => s.trim()).filter(Boolean)
      : null;
    await api.formFields.create({
      field_key: newField.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      label: newField.label.trim(),
      field_type: newField.field_type,
      options,
      multiple: newField.multiple,
      required: newField.required,
      sort_order: fields.length,
      active: true,
    });
    setNewField({ label: "", field_type: "text", options: "", required: false, multiple: false });
    setShowAdd(false);
    reload();
  }

  const sorted = [...fields].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <>
      <div className="fb-section">
        <div className="fb-section-head">
          <h3>Core Fields</h3>
          <span className="fb-locked-note">🔒 Locked — these map to HubSpot and power search/filters, so they can't be removed or retyped.</span>
        </div>
        <div className="fb-field-list locked">
          {CORE_FIELDS.map((f, i) => (
            <div className="fb-field-row" key={i}>
              <span className="fb-field-label">{f.label}</span>
              <span className="fb-type-badge">{f.type}</span>
              <span className={`fb-req-badge ${f.required ? "" : "optional"}`}>{f.required ? "Required" : "Optional"}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="fb-section">
        <div className="fb-section-head">
          <h3>Custom Fields</h3>
          <span className="fb-locked-note">Fully editable. New fields here won't sync to HubSpot until that mapping is configured separately.</span>
        </div>
        <div className="fb-field-list">
          {sorted.map(f => (
            <div className="fb-field-row" key={f.id}>
              <span className="fb-drag">⠿</span>
              <span className="fb-field-label">{f.label}{f.multiple && <span style={{ color: "var(--text-placeholder)", fontWeight: 400 }}> (multi-select)</span>}</span>
              <span className="fb-type-badge">{TYPE_LABELS[f.field_type]}</span>
              <span className={`fb-req-badge ${f.required ? "" : "optional"}`}>{f.required ? "Required" : "Optional"}</span>
              <span className="fb-row-actions">
                <button className="fb-icon-btn" onClick={() => moveField(f, -1)} title="Move up">↑</button>
                <button className="fb-icon-btn" onClick={() => moveField(f, 1)} title="Move down">↓</button>
                <button className="fb-icon-btn danger" onClick={() => removeField(f)} title="Remove">✕</button>
              </span>
            </div>
          ))}
        </div>

        <button className="fb-add-field-btn" onClick={() => setShowAdd(s => !s)}>+ Add Field</button>

        {showAdd && (
          <div className="fb-add-field-panel show">
            <div className="form-grid form-grid-2">
              <div className="form-field">
                <label>Field label</label>
                <input value={newField.label} onChange={e => setNewField(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Preferred delivery date" />
              </div>
              <div className="form-field">
                <label>Field type</label>
                <select value={newField.field_type} onChange={e => setNewField(f => ({ ...f, field_type: e.target.value }))}>
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="dropdown">Dropdown</option>
                  <option value="textarea">Textarea</option>
                </select>
              </div>
              {newField.field_type === "dropdown" && (
                <div className="form-field full">
                  <label>Dropdown options <span className="hint">comma-separated</span></label>
                  <input value={newField.options} onChange={e => setNewField(f => ({ ...f, options: e.target.value }))} placeholder="e.g. Nitrile, Latex, Vinyl" />
                </div>
              )}
              <div className="form-field" style={{ display: "flex", alignItems: "center", gap: 7, paddingTop: 18 }}>
                <input type="checkbox" id="newFieldRequired" style={{ width: "auto", height: "auto" }} checked={newField.required} onChange={e => setNewField(f => ({ ...f, required: e.target.checked }))} />
                <label htmlFor="newFieldRequired" style={{ margin: 0 }}>Required field</label>
              </div>
              {newField.field_type === "dropdown" && (
                <div className="form-field" style={{ display: "flex", alignItems: "center", gap: 7, paddingTop: 18 }}>
                  <input type="checkbox" id="newFieldMultiple" style={{ width: "auto", height: "auto" }} checked={newField.multiple} onChange={e => setNewField(f => ({ ...f, multiple: e.target.checked }))} />
                  <label htmlFor="newFieldMultiple" style={{ margin: 0 }}>Allow multiple selections <span className="hint">e.g. Glove Type, Color</span></label>
                </div>
              )}
            </div>
            <div className="fb-add-field-actions">
              <button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn-primary" onClick={addField}>Add Field</button>
            </div>
          </div>
        )}
      </div>

      <div className="fb-preview-note">Changes here update the live SDR request form immediately — preview it on the Sample Request link before rolling out changes mid-week.</div>
    </>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState("brands");
  const [brands, setBrands] = useState([]);
  const [sdrs, setSdrs] = useState([]);
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      const [brandList, sdrList, fieldList] = await Promise.all([api.brands.list(), api.sdrs.list(true), api.formFields.list(true)]);
      setBrands(brandList);
      setSdrs(sdrList);
      setFields(fieldList);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  return (
    <div className="settings-page">
      <div className="page-header">
        <div>
          <p className="page-title">Settings</p>
          <p className="page-sub">Manage brands and the fields SDRs see on the request form.</p>
        </div>
      </div>

      <div className="settings-tabs">
        <button
          onClick={() => setTab("brands")}
          className={`settings-tab ${tab === "brands" ? "active" : ""}`}
        >Brands</button>
        <button
          onClick={() => setTab("sdrs")}
          className={`settings-tab ${tab === "sdrs" ? "active" : ""}`}
        >SDRs</button>
        <button
          onClick={() => setTab("formbuilder")}
          className={`settings-tab ${tab === "formbuilder" ? "active" : ""}`}
        >Form Builder</button>
      </div>

      {loading ? <div className="empty-state">Loading…</div> : (
        tab === "brands"
          ? <BrandsTab brands={brands} reload={reload} />
          : tab === "sdrs"
            ? <SdrsTab sdrs={sdrs} reload={reload} />
            : <FormBuilderTab fields={fields} reload={reload} />
      )}
    </div>
  );
}
