import { useEffect, useState } from "react";
import { api, setToken, clearToken, hasToken } from "./api";
import { formatName, formatEmail, formatPhone, formatState, cityMatches, stateMatches } from "./normalize";

// ── Compact multi-select dropdown (Glove Type, Color — any field_type
// "dropdown" with multiple=true from the Form Builder) ──
function MultiSelect({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  function toggle(opt) {
    onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt]);
  }
  return (
    <div className="ms-wrap" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <div className="ms-trigger" onClick={() => setOpen(o => !o)}>
        <div className="ms-chips">
          {value.map(v => (
            <span className="ms-chip" key={v}>
              {v}
              <button type="button" onClick={(e) => { e.stopPropagation(); toggle(v); }}>✕</button>
            </span>
          ))}
        </div>
        <span className="ms-chevron">▾</span>
      </div>
      {open && (
        <div className="ms-panel open">
          {options.map(opt => (
            <div className="ms-option" key={opt}>
              <input type="checkbox" id={`ms-${opt}`} checked={value.includes(opt)} onChange={() => toggle(opt)} />
              <label htmlFor={`ms-${opt}`}>{opt}</label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── City/State autocomplete input ──
function Autocomplete({ value, onChange, onSelect, matcher, placeholder, renderOption }) {
  const [open, setOpen] = useState(false);
  const matches = matcher(value);
  return (
    <div className="autocomplete-wrap">
      <input
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      <div className={`autocomplete-panel ${open && matches.length > 0 ? "open" : ""}`}>
        {matches.map((m, i) => (
          <div key={i} className="autocomplete-option" onMouseDown={() => { onSelect(m); setOpen(false); }}>
            {renderOption(m)}
          </div>
        ))}
      </div>
    </div>
  );
}

function LoginGate({ onLoggedIn }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.login(code);
      setToken(res.access_token);
      onLoggedIn();
    } catch {
      setError("Incorrect access code.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo"><img src="/Schneider-Direct.png" alt="Schneider Direct" /></div>
        <p className="login-title">Sample Request Access</p>
        <p className="login-sub">Enter the SDR access code to submit a sample request.</p>
        <form onSubmit={submit}>
          <div className="login-field">
            <label>Access code</label>
            <input type="password" value={code} onChange={e => setCode(e.target.value)} placeholder="••••••••" autoFocus />
          </div>
          {error && <div className="login-error">{error}</div>}
          <button className="login-btn" type="submit" disabled={loading}>{loading ? "Checking…" : "Continue"}</button>
        </form>
        <div className="login-footer-rule" />
        <p className="login-footer">Schneider Direct Sample Portal<br />Authorized SDR use only</p>
      </div>
    </div>
  );
}

function CustomField({ field, value, onChange }) {
  if (field.field_type === "dropdown" && field.multiple) {
    return <MultiSelect options={field.options || []} value={value || []} onChange={onChange} />;
  }
  if (field.field_type === "dropdown") {
    return (
      <select value={value || ""} onChange={e => onChange(e.target.value)}>
        <option value="">Select…</option>
        {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (field.field_type === "textarea") {
    return <textarea value={value || ""} onChange={e => onChange(e.target.value)} />;
  }
  return <input type={field.field_type === "number" ? "number" : "text"} value={value || ""} onChange={e => onChange(e.target.value)} />;
}

function RequestForm() {
  const [sdrs, setSdrs] = useState([]);
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [core, setCore] = useState({
    sdr_id: "", contact_name: "", contact_email: "", contact_phone: "",
    business_name: "", address_line: "", city: "", state: "", zip_code: "",
  });
  const [customValues, setCustomValues] = useState({});

  useEffect(() => {
    Promise.all([api.sdrs(), api.formFields()])
      .then(([sdrList, fieldList]) => { setSdrs(sdrList); setFields(fieldList); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function setCoreField(k, v) { setCore(c => ({ ...c, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    if (!core.business_name.trim()) { setError("Business name is required."); return; }
    setSubmitting(true);
    setError(null);
    try {
      await api.submit({
        ...core,
        sdr_id: core.sdr_id || null,
        custom_fields: customValues,
      });
      setSubmitted(true);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setSubmitted(false);
    setCore({ sdr_id: "", contact_name: "", contact_email: "", contact_phone: "", business_name: "", address_line: "", city: "", state: "", zip_code: "" });
    setCustomValues({});
  }

  const fieldLabel = (field) => field.label.toLowerCase();
  const isNotesField = (field) => field.field_key === "custom_requirement" || fieldLabel(field).includes("requirement") || fieldLabel(field).includes("note");
  const gloveFields = fields.filter(field => !isNotesField(field));
  const noteFields = fields.filter(isNotesField);

  if (loading) return <div className="wrap"><p>Loading…</p></div>;

  if (submitted) {
    return (
      <div className="wrap">
        <div className="success">
          <div className="check">✓</div>
          <h2>Request submitted</h2>
          <p>{core.business_name} has been added to the queue for brand assignment.</p>
          <button onClick={resetForm}>Submit another request</button>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="page-header">
        <p className="page-title">Request a Sample</p>
        <p className="page-sub">Fill this out for a prospect you're sending a sample to. Marketing will assign the brand and handle fulfillment.</p>
      </div>

      <form className="data-card" onSubmit={submit}>
        {error && <div className="error-banner">{error}</div>}

        <p className="form-section-label">Requested by</p>
        <div className="form-grid form-grid-2">
          <div className="form-field">
            <label>Your name</label>
            <select value={core.sdr_id} onChange={e => setCoreField("sdr_id", e.target.value)}>
              <option value="">None</option>
              {sdrs.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label>Date <span className="hint">auto-filled</span></label>
            <input value={new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} disabled />
          </div>
        </div>

        <p className="form-section-label">Contact & business</p>
        <div className="form-grid form-grid-2">
          <div className="form-field">
            <label>Contact full name</label>
            <input value={core.contact_name} onChange={e => setCoreField("contact_name", e.target.value)}
              onBlur={e => { if (e.target.value.trim()) setCoreField("contact_name", formatName(e.target.value)); }} placeholder="Jane Alvarez" />
          </div>
          <div className="form-field">
            <label>Email</label>
            <input value={core.contact_email} onChange={e => setCoreField("contact_email", e.target.value)}
              onBlur={e => { if (e.target.value.trim()) setCoreField("contact_email", formatEmail(e.target.value)); }} placeholder="jane@company.com" />
          </div>
          <div className="form-field">
            <label>Phone</label>
            <input value={core.contact_phone} onChange={e => setCoreField("contact_phone", e.target.value)}
              onBlur={e => { if (e.target.value.trim()) setCoreField("contact_phone", formatPhone(e.target.value)); }} placeholder="(555) 123-4567" />
          </div>
          <div className="form-field">
            <label>Business name</label>
            <input value={core.business_name} onChange={e => setCoreField("business_name", e.target.value)} placeholder="Alvarez Manufacturing" />
          </div>
          <div className="form-field full">
            <label>Address</label>
            <input value={core.address_line} onChange={e => setCoreField("address_line", e.target.value)} placeholder="Street address" />
          </div>
          <div className="form-field">
            <label>City</label>
            <Autocomplete
              value={core.city}
              onChange={v => setCoreField("city", v)}
              onSelect={(m) => { setCoreField("city", m.c); setCoreField("state", m.s); }}
              matcher={cityMatches}
              placeholder="City"
              renderOption={(m) => <>{m.c} <span className="ac-state">{m.s}</span></>}
            />
          </div>
          <div className="form-field">
            <label>State</label>
            <Autocomplete
              value={core.state}
              onChange={v => setCoreField("state", v)}
              onSelect={(m) => setCoreField("state", m.abbr)}
              matcher={stateMatches}
              placeholder="CA"
              renderOption={(m) => <>{m.name} <span className="ac-state">{m.abbr}</span></>}
            />
          </div>
          <div className="form-field">
            <label>Zip code</label>
            <input value={core.zip_code} onChange={e => setCoreField("zip_code", e.target.value)} placeholder="90001" />
          </div>
        </div>

        {gloveFields.length > 0 && (
          <>
            <p className="form-section-label">Glove specs</p>
            <div className="form-grid form-grid-2">
              {gloveFields.map(field => {
                const full = field.multiple || field.field_type === "textarea";
                return (
                  <div className={`form-field ${full ? "full" : ""}`} key={field.field_key}>
                    <label>{field.label}{field.required && " *"}</label>
                    <CustomField
                      field={field}
                      value={customValues[field.field_key]}
                      onChange={v => setCustomValues(c => ({ ...c, [field.field_key]: v }))}
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}

        {noteFields.length > 0 && (
          <>
            <p className="form-section-label">Notes</p>
            {noteFields.map(field => (
              <div className="form-field full" key={field.field_key}>
                <label>{field.label}{field.required && " *"} <span className="hint">visible to admin during brand assignment</span></label>
                <CustomField
                  field={field}
                  value={customValues[field.field_key]}
                  onChange={v => setCustomValues(c => ({ ...c, [field.field_key]: v }))}
                />
              </div>
            ))}
          </>
        )}

        <div className="form-footer">
          <button className="btn-primary" type="submit" disabled={submitting}>{submitting ? "Submitting…" : "Submit Request"}</button>
        </div>
      </form>
    </div>
  );
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(hasToken());

  if (!loggedIn) return <LoginGate onLoggedIn={() => setLoggedIn(true)} />;

  return (
    <div>
      <div className="app-topbar">
        <img src="/Schneider-Direct.png" alt="Schneider Direct" className="topbar-logo-img" />
        <span className="app-topbar-title">Sample Request</span>
      </div>
      <RequestForm />
    </div>
  );
}
