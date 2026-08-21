import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { brandStyle } from "../../config/brandColors";
import ConfirmModal from "./ConfirmModal";
import "../../components/shared.css";
import "./samples.css";

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const STEPS = ["requested", "sent", "in_transit", "delivered"];

function locationLine(req) {
  const cityStateZip = [
    [req.city, req.state].filter(Boolean).join(", "),
    req.zip_code,
  ].filter(Boolean).join(" ");
  return [req.address_line, cityStateZip].filter(Boolean).join(", ") || "—";
}

const CUSTOM_FIELD_LABELS = {
  glove_type: "Glove type",
  size: "Size",
  color: "Color",
  employee_count: "# Employees using gloves",
  daily_changes: "Daily glove changes / employee",
  current_supplier: "Current brand / supplier",
  custom_requirement: "Custom requirement or note",
};

function customFieldLabel(key) {
  return CUSTOM_FIELD_LABELS[key] || key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function customFieldValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (value == null || value === "") return "—";
  return String(value);
}

function addressVerificationLabel(req) {
  if (req.address_verification_status === "unverified" && (req.address_verification_note || req.address_verification_confidence != null || req.address_verification_source_url)) {
    return "AI Unverified";
  }
  return { unverified: "Unverified", ai_verified: "AI Verified", human_verified: "Verified" }[req.address_verification_status] || "Unverified";
}

function addressVerificationClass(req) {
  return addressVerificationLabel(req) === "AI Unverified" ? "ai_unverified" : req.address_verification_status;
}

function Stepper({ status }) {
  if (status === "on_hold") {
    return <div className="status-badge stalled" style={{ marginBottom: 16 }}>On hold</div>;
  }
  if (status === "rejected") {
    return <div className="status-badge rejected" style={{ marginBottom: 16 }}>Rejected</div>;
  }
  if (status === "returned") {
    return <div className="status-badge rejected" style={{ marginBottom: 16 }}>Returned to sender</div>;
  }
  if (status === "delivery_issue") {
    return <div className="status-badge stalled" style={{ marginBottom: 16 }}>Delivery issue</div>;
  }
  const currentIdx = STEPS.indexOf(status);
  const labels = { requested: "Requested", sent: "Sent", in_transit: "In Transit", delivered: "Delivered" };
  return (
    <div className="stepper">
      {STEPS.map((s, i) => (
        <div key={s} className={`step ${i < currentIdx ? "done" : i === currentIdx ? "current" : ""}`}>
          <div className="connector" />
          <div className="node">{i <= currentIdx ? "✓" : i + 1}</div>
          <div className="lbl">{labels[s]}</div>
        </div>
      ))}
    </div>
  );
}

export default function SampleDetailDrawer({ requestId, brands, sdrsById, onClose, onChanged }) {
  const [req, setReq] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showSentModal, setShowSentModal] = useState(false);
  const [showDeliveredModal, setShowDeliveredModal] = useState(false);
  const [showBrandModal, setShowBrandModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAddressDetails, setShowAddressDetails] = useState(false);
  const [aiChecking, setAiChecking] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [sentTracking, setSentTracking] = useState("");
  const [sentCarrier, setSentCarrier] = useState("");
  const [sentDate, setSentDate] = useState("");
  const [deliveredTracking, setDeliveredTracking] = useState("");
  const [deliveredSentDate, setDeliveredSentDate] = useState("");
  const [deliveredDate, setDeliveredDate] = useState("");
  const [editForm, setEditForm] = useState({
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    business_name: "",
    address_line: "",
    city: "",
    state: "",
    zip_code: "",
  });

  async function load() {
    setLoading(true);
    try {
      const data = await api.samples.get(requestId);
      setReq(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [requestId]); // eslint-disable-line

  function beginEdit() {
    if (!req) return;
    setEditForm({
      contact_name: req.contact_name || "",
      contact_email: req.contact_email || "",
      contact_phone: req.contact_phone || "",
      business_name: req.business_name || "",
      address_line: req.address_line || "",
      city: req.city || "",
      state: req.state || "",
      zip_code: req.zip_code || "",
    });
    setEditMode(true);
  }

  function setEditField(field, value) {
    setEditForm(prev => ({ ...prev, [field]: value }));
  }

  async function saveEdit() {
    if (!editForm.business_name.trim()) {
      alert("Business name is required.");
      return;
    }
    setSavingEdit(true);
    try {
      const updated = await api.samples.update(requestId, {
        ...editForm,
        business_name: editForm.business_name.trim(),
      });
      setReq(updated);
      setEditMode(false);
      onChanged?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await api.samples.batchArchive([requestId], "admin");
      setShowDeleteConfirm(false);
      onChanged?.();
      onClose();
    } catch (e) {
      alert(e.message);
    } finally {
      setDeleting(false);
    }
  }

  function handleStatusSelect(newStatus) {
    if (!req || newStatus === req.status) return;
    if (newStatus === "sent") {
      setSentTracking(req.tracking_number || "");
      setSentCarrier(req.carrier || "");
      setSentDate(req.sent_date || "");
      setShowSentModal(true);
      return;
    }
    if (newStatus === "delivered") {
      setDeliveredTracking(req.tracking_number || "");
      setDeliveredSentDate(req.sent_date || "");
      setDeliveredDate(req.delivered_date || "");
      setShowDeliveredModal(true);
      return;
    }
    applyStatus({ status: newStatus });
  }

  async function applyStatus(payload) {
    try {
      const updated = await api.samples.changeStatus(requestId, { changed_by: "admin", ...payload });
      setReq(updated);
      onChanged?.();
    } catch (e) {
      const jsonStart = e.message.indexOf(": ");
      let detail = e.message;
      if (jsonStart !== -1) {
        try { detail = JSON.parse(e.message.slice(jsonStart + 2)).detail || e.message; } catch { /* not JSON — use raw message */ }
      }
      alert(detail);
    }
  }

  async function confirmSent() {
    if (!sentTracking.trim() || !sentDate) {
      alert("Tracking number and sent date are both required to mark this as Sent.");
      return;
    }
    await applyStatus({ status: "sent", tracking_number: sentTracking.trim(), carrier: sentCarrier.trim() || null, sent_date: sentDate });
    setShowSentModal(false);
  }

  const needsTrackingForDelivered = !req?.tracking_number;
  const needsSentDateForDelivered = !req?.sent_date;

  async function confirmDelivered() {
    if (!deliveredDate) { alert("Delivered date is required to mark this as Delivered."); return; }
    if (needsTrackingForDelivered && !deliveredTracking.trim()) { alert("Tracking number is required since this record was never marked Sent."); return; }
    if (needsSentDateForDelivered && !deliveredSentDate) { alert("Sent date is required since this record was never marked Sent."); return; }
    await applyStatus({
      status: "delivered",
      tracking_number: needsTrackingForDelivered ? deliveredTracking.trim() : undefined,
      sent_date: needsSentDateForDelivered ? deliveredSentDate : undefined,
      delivered_date: deliveredDate,
    });
    setShowDeliveredModal(false);
  }

  async function handleConfirmAddress() {
    if (!window.confirm("Confirm this address is correct? This marks it as manually verified.")) return;
    const updated = await api.samples.confirmAddress(requestId, "admin");
    setReq(updated);
    onChanged?.();
  }

  async function handleRerunAiCheck() {
    setAiChecking(true);
    try {
      const updated = await api.samples.verifyAddress(requestId);
      setReq(updated);
      onChanged?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setAiChecking(false);
    }
  }

  if (loading) return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer open sample-detail-drawer"><div className="empty-state">Loading…</div></div>
    </>
  );
  if (error || !req) return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer open sample-detail-drawer"><div className="error-banner" style={{ margin: 20 }}>{error || "Not found"}</div></div>
    </>
  );

  const customFieldEntries = Object.entries(req.custom_fields || {}).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    return value != null && value !== "";
  });

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer open sample-detail-drawer">
        <div className="drawer-header">
          <div>
            <p className="drawer-title">{req.business_name}</p>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Requested by {sdrsById[req.sdr_id]?.full_name || "—"} · {fmtDate(req.requested_date)}
            </div>
          </div>
          <button className="drawer-close" onClick={onClose}>×</button>
        </div>

        <div className="drawer-body">
          <Stepper status={req.status} />

          {/* Contact & business */}
          <div className="drawer-block">
            <h4>Contact & Business</h4>
            {editMode ? (
              <div className="drawer-edit-grid">
                <div className="form-field"><label>Contact full name</label><input value={editForm.contact_name} onChange={e => setEditField("contact_name", e.target.value)} /></div>
                <div className="form-field"><label>Email</label><input value={editForm.contact_email} onChange={e => setEditField("contact_email", e.target.value)} /></div>
                <div className="form-field"><label>Phone</label><input value={editForm.contact_phone} onChange={e => setEditField("contact_phone", e.target.value)} /></div>
                <div className="form-field"><label>Business</label><input value={editForm.business_name} onChange={e => setEditField("business_name", e.target.value)} /></div>
                <div className="form-field" style={{ gridColumn: "1 / -1" }}><label>Street address</label><input value={editForm.address_line} onChange={e => setEditField("address_line", e.target.value)} /></div>
                <div className="form-field"><label>City</label><input value={editForm.city} onChange={e => setEditField("city", e.target.value)} /></div>
                <div className="form-field"><label>State</label><input value={editForm.state} onChange={e => setEditField("state", e.target.value)} /></div>
                <div className="form-field"><label>Zip code</label><input value={editForm.zip_code} onChange={e => setEditField("zip_code", e.target.value)} /></div>
              </div>
            ) : (
              <div className="drawer-kv">
                <div className="k">Contact</div><div>{req.contact_name || "—"}</div>
                <div className="k">Email</div><div>{req.contact_email || "—"}</div>
                <div className="k">Phone</div><div>{req.contact_phone || "—"}</div>
                <div className="k">Business</div><div>{req.business_name}</div>
                <div className="k">Location</div><div>{locationLine(req)}</div>
              </div>
            )}
          </div>

          {/* Address verification */}
          <div className="drawer-block">
            <h4>Address Verification</h4>
            <button className="addr-badge-trigger" onClick={() => setShowAddressDetails(v => !v)}>
              <span className={`addr-badge ${addressVerificationClass(req)}`}>
                <span className="addr-dot" />
                {addressVerificationLabel(req)}
              </span>
            </button>
            {showAddressDetails && (
              <div className="addr-verify-popout">
                <div className="addr-verify-note">{req.address_verification_note || "Not yet checked."}</div>
                <div className="addr-verify-actions">
                  {req.address_verification_status !== "human_verified" && (
                    <button className="btn-secondary" style={{ flex: 1 }} onClick={handleConfirmAddress}>Confirm Verified</button>
                  )}
                  <button className="btn-secondary" style={{ flex: 1 }} onClick={handleRerunAiCheck} disabled={aiChecking}>
                    {aiChecking ? "Checking…" : "Re-run AI Check"}
                  </button>
                </div>
                {aiChecking && (
                  <div className="inline-progress">
                    <span>Running AI address verification</span>
                    <div className="progress-strip"><div /></div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Requested glove spec — mirrors the request form's Glove Specs + Notes sections. */}
          <div className="drawer-block">
            <h4>Requested Glove Spec</h4>
            {customFieldEntries.length > 0 ? (
              <div className="drawer-kv">
                {customFieldEntries.map(([key, value]) => (
                  <div className="drawer-kv-row" key={key}>
                    <div className="k">{customFieldLabel(key)}</div>
                    <div>{customFieldValue(value)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="drawer-empty-note">No glove specs or notes submitted.</div>
            )}
          </div>

          {/* Brand assignment */}
          <div className="drawer-block">
            <h4>Brand Assignment</h4>
            <div className="brand-assign-summary">
              <div className="brand-assign-chips">
                {(req.brand_ids || []).map(id => {
                  const b = brands.find(x => x.id === id);
                  if (!b) return null;
                  const s = brandStyle(b.name);
                  return <span key={id} style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 500, padding: "2px 9px", borderRadius: 999 }}>{b.name}</span>;
                })}
              </div>
              {req.assignment_note && <div className="brand-assign-note-preview">{req.assignment_note}</div>}
            </div>
            <button className="btn-secondary" style={{ width: "100%", marginTop: 9 }} onClick={() => setShowBrandModal(true)}>Assign Brands</button>
          </div>

          {/* Fulfillment — status select + conditional dates */}
          <div className="drawer-block">
            <h4>Fulfillment</h4>
            <div className="form-field" style={{ marginBottom: 10 }}>
              <label>Status</label>
              <select value={req.status} onChange={e => handleStatusSelect(e.target.value)}>
                <option value="requested">Requested</option>
                <option value="sent">Sent</option>
                {req.status === "in_transit" && <option value="in_transit" disabled>In Transit</option>}
                <option value="delivered">Delivered</option>
                {req.status === "returned" && <option value="returned" disabled>Returned</option>}
                {req.status === "delivery_issue" && <option value="delivery_issue" disabled>Delivery issue</option>}
                <option value="on_hold">On hold</option>
                <option value="rejected">Rejected</option>
              </select>
              {["in_transit", "returned", "delivery_issue"].includes(req.status) && (
                <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "4px 0 0" }}>
                  Set automatically by the daily tracking check.
                </p>
              )}
            </div>
            {req.tracking_number && <div className="drawer-field-value">Tracking #: {req.tracking_number}</div>}
            {req.sent_date && <div className="drawer-field-value">Sent: {fmtDate(req.sent_date)}</div>}
            {req.delivered_date && <div className="drawer-field-value">Delivered: {fmtDate(req.delivered_date)}</div>}
          </div>

          <div className="drawer-block">
            <h4>HubSpot Sync</h4>
            <div className="hubspot-stub"><span className="dotpulse" />Not yet connected — will push status + tracking updates once configured.</div>
          </div>
        </div>
        <div className="drawer-footer">
          {editMode ? (
            <>
              <button className="btn-secondary" onClick={() => setEditMode(false)} disabled={savingEdit}>Cancel</button>
              <button className="btn-primary" onClick={saveEdit} disabled={savingEdit}>{savingEdit ? "Saving…" : "Save Changes"}</button>
            </>
          ) : (
            <>
              <button className="btn-danger" onClick={() => setShowDeleteConfirm(true)}>Delete</button>
              <button className="btn-secondary" onClick={beginEdit}>Edit</button>
            </>
          )}
        </div>
      </div>

      {/* Mark as Sent modal */}
      {showSentModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ width: 380 }}>
            <div className="modal-header">
              <div>
                <p className="modal-title">Mark as Sent</p>
                <p className="modal-subtitle">Tracking number and sent date are required.</p>
              </div>
              <button className="modal-close" onClick={() => setShowSentModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-field" style={{ marginBottom: 12 }}>
                <label>Tracking number *</label>
                <input value={sentTracking} onChange={e => setSentTracking(e.target.value)} placeholder="e.g. 1Z884A12F31" />
              </div>
              <div className="form-field" style={{ marginBottom: 12 }}>
                <label>Carrier</label>
                <input value={sentCarrier} onChange={e => setSentCarrier(e.target.value)} placeholder="usps, ups, fedex…" />
                <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "4px 0 0" }}>
                  Enables automatic daily tracking until delivered.
                </p>
              </div>
              <div className="form-field">
                <label>Sent date *</label>
                <input type="date" value={sentDate} onChange={e => setSentDate(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowSentModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={confirmSent}>Save as Sent</button>
            </div>
          </div>
        </div>
      )}

      {/* Mark as Delivered modal */}
      {showDeliveredModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ width: 380 }}>
            <div className="modal-header">
              <div>
                <p className="modal-title">Mark as Delivered</p>
                <p className="modal-subtitle">
                  {(needsTrackingForDelivered || needsSentDateForDelivered)
                    ? "This record was never marked Sent — tracking and sent date are needed too."
                    : "Delivered date is required."}
                </p>
              </div>
              <button className="modal-close" onClick={() => setShowDeliveredModal(false)}>×</button>
            </div>
            <div className="modal-body">
              {needsTrackingForDelivered && (
                <div className="form-field" style={{ marginBottom: 12 }}>
                  <label>Tracking number *</label>
                  <input value={deliveredTracking} onChange={e => setDeliveredTracking(e.target.value)} placeholder="e.g. 1Z884A12F31" />
                </div>
              )}
              {needsSentDateForDelivered && (
                <div className="form-field" style={{ marginBottom: 12 }}>
                  <label>Sent date *</label>
                  <input type="date" value={deliveredSentDate} onChange={e => setDeliveredSentDate(e.target.value)} />
                </div>
              )}
              <div className="form-field">
                <label>Delivered date *</label>
                <input type="date" value={deliveredDate} onChange={e => setDeliveredDate(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowDeliveredModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={confirmDelivered}>Save as Delivered</button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Brands modal */}
      {showBrandModal && (
        <BrandAssignModal
          req={req}
          brands={brands}
          onClose={() => setShowBrandModal(false)}
          onSaved={(updated) => { setReq(updated); setShowBrandModal(false); onChanged?.(); }}
        />
      )}

      {showDeleteConfirm && (
        <ConfirmModal
          icon="!"
          iconTone="warn"
          title="Delete this sample request?"
          subtitle="This hides the record from the active list but keeps it in history."
          rowList={req.business_name}
          confirmLabel="Delete"
          confirmTone="danger"
          loading={deleting}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={confirmDelete}
        />
      )}
    </>
  );
}

function BrandAssignModal({ req, brands, onClose, onSaved }) {
  const [selected, setSelected] = useState(req.brand_ids || []);
  const [note, setNote] = useState(req.assignment_note || "");
  const [saving, setSaving] = useState(false);

  function toggle(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function save() {
    setSaving(true);
    try {
      const updated = await api.samples.update(req.id, { brand_ids: selected, assignment_note: note || null });
      onSaved(updated);
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ width: 400 }}>
        <div className="modal-header">
          <div>
            <p className="modal-title">Assign Brands</p>
            <p className="modal-subtitle">{req.business_name}</p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="drawer-field-label" style={{ marginBottom: 8 }}>Brands</div>
          <div className="brand-multiselect">
            {brands.map(b => {
              const s = brandStyle(b.name);
              return (
                <div className="brand-option" key={b.id}>
                  <input type="checkbox" id={`ba-${b.id}`} checked={selected.includes(b.id)} onChange={() => toggle(b.id)} />
                  <label htmlFor={`ba-${b.id}`}><span className="brand-dot" style={{ background: s.color }} />{b.name}</label>
                </div>
              );
            })}
          </div>
          <div className="form-field" style={{ marginTop: 16 }}>
            <label>Assignment note <span style={{ color: "var(--text-placeholder)", fontWeight: 400 }}>for special requirements, internal only</span></label>
            <textarea
              style={{ width: "100%", minHeight: 64, padding: "8px 10px", border: "0.5px solid #CBD5E1", borderRadius: 5, fontSize: 13, fontFamily: "inherit", resize: "vertical" }}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Send TitanFlex + Schneider for side-by-side comparison per customer request"
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save Assignment"}</button>
        </div>
      </div>
    </div>
  );
}
