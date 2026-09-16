import { useState } from "react";
import { api } from "../../api/client";
import ConfirmModal from "../samples/ConfirmModal";
import { statusBadgeClass } from "./FormFillsPage";
import "../../components/shared.css";
import "../samples/samples.css";
import "./formfills.css";

const OUTREACH_STATUS_OPTIONS = ["Email + Webform", "Email", "Webform", "To Call", "DQ"];

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function websiteUrl(domain) {
  if (!domain) return null;
  return domain.startsWith("http") ? domain : `https://${domain}`;
}

// Pulls the Email:/Web Form:/Status:/Notes-Reason: lines back out of the
// stored plain-text note for display as its own small section — same
// template SDRs started using 2026-09-11 (see hubspot_formfill_ingest_service
// on the backend, which parses this the same way to derive outreach_status).
function parseOutreachNote(noteText) {
  if (!noteText) return null;
  const emailMatch = noteText.match(/^\s*Email\s*:\s*(.+)$/im);
  const webFormMatch = noteText.match(/^\s*Web Form\s*:\s*(.+)$/im);
  const statusMatch = noteText.match(/^\s*Status\s*:\s*(.+)$/im);
  const reasonMatch = noteText.match(/^\s*Notes\/Reason\s*:\s*([\s\S]+?)(?:\n\n———|\n\n[A-Za-z]|$)/im);
  if (!emailMatch && !statusMatch) return null;
  return {
    email: emailMatch ? emailMatch[1].trim() : null,
    webForm: webFormMatch ? webFormMatch[1].trim() : null,
    status: statusMatch ? statusMatch[1].trim() : null,
    reason: reasonMatch ? reasonMatch[1].trim() : null,
  };
}

export default function FormFillDetailDrawer({ fill, sdrs, onClose, onChanged }) {
  const [sdrId, setSdrId] = useState(fill.sdr_id || "");
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    company_name: fill.company_name || "",
    company_domain: fill.company_domain || "",
    note_text: fill.note_text || "",
    outreach_status: fill.outreach_status || "",
    fill_date: fill.fill_date || "",
  });

  async function handleReassign(newSdrId) {
    setSdrId(newSdrId);
    setSaving(true);
    try {
      await api.formFills.update(fill.id, { sdr_id: newSdrId || null });
      onChanged?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  function beginEdit() {
    setEditForm({
      company_name: fill.company_name || "",
      company_domain: fill.company_domain || "",
      note_text: fill.note_text || "",
      outreach_status: fill.outreach_status || "",
      fill_date: fill.fill_date || "",
    });
    setEditMode(true);
  }

  function setEditField(field, value) {
    setEditForm(prev => ({ ...prev, [field]: value }));
  }

  async function saveEdit() {
    if (!editForm.company_name.trim()) {
      alert("Company name is required.");
      return;
    }
    if (!editForm.fill_date) {
      alert("Date is required.");
      return;
    }
    setSavingEdit(true);
    try {
      await api.formFills.update(fill.id, {
        company_name: editForm.company_name.trim(),
        company_domain: editForm.company_domain.trim() || null,
        note_text: editForm.note_text,
        outreach_status: editForm.outreach_status || null,
        fill_date: editForm.fill_date,
      });
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
      await api.formFills.remove(fill.id);
      setShowDeleteConfirm(false);
      onChanged?.();
      onClose();
    } catch (e) {
      alert(e.message);
    } finally {
      setDeleting(false);
    }
  }

  const url = websiteUrl(fill.company_domain);
  const outreach = parseOutreachNote(fill.note_text);

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer open form-fill-detail-drawer">
        <div className="drawer-header">
          <div>
            <p className="drawer-title">{fill.company_name || "Untitled"}</p>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {fmtDate(fill.fill_date)}
              {fill.outreach_status && <> · <span className={`status-badge ${statusBadgeClass(fill.outreach_status)}`}>{fill.outreach_status}</span></>}
            </div>
          </div>
          <button className="drawer-close" onClick={onClose}>×</button>
        </div>

        <div className="drawer-body">
          <div className="drawer-block">
            <h4>Company</h4>
            {editMode ? (
              <div className="drawer-edit-grid">
                <div className="form-field"><label>Company name</label><input value={editForm.company_name} onChange={e => setEditField("company_name", e.target.value)} /></div>
                <div className="form-field"><label>Website / domain</label><input value={editForm.company_domain} onChange={e => setEditField("company_domain", e.target.value)} /></div>
                <div className="form-field"><label>Date</label><input type="date" value={editForm.fill_date} onChange={e => setEditField("fill_date", e.target.value)} /></div>
                <div className="form-field">
                  <label>Status</label>
                  <select value={editForm.outreach_status} onChange={e => setEditField("outreach_status", e.target.value)}>
                    <option value="">— None —</option>
                    {OUTREACH_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            ) : (
              <div className="drawer-kv">
                <div className="k">Company</div><div>{fill.company_name || "—"}</div>
                <div className="k">Website</div>
                <div>{url ? <a href={url} target="_blank" rel="noreferrer">{fill.company_domain}</a> : "—"}</div>
                <div className="k">HubSpot ID</div><div>{fill.hubspot_company_id || "—"}</div>
              </div>
            )}
          </div>

          <div className="drawer-block">
            <h4>SDR</h4>
            <div className="form-field">
              <label>Assigned to</label>
              <select value={sdrId} onChange={e => handleReassign(e.target.value)} disabled={saving}>
                <option value="">— Unassigned —</option>
                {sdrs.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
          </div>

          {outreach && !editMode && (
            <div className="drawer-block">
              <h4>Outreach</h4>
              <div className="drawer-kv">
                <div className="k">Email</div><div>{outreach.email || "—"}</div>
                <div className="k">Web Form</div><div>{outreach.webForm || "—"}</div>
                <div className="k">Status</div><div>{outreach.status || "—"}</div>
                <div className="k">Reason</div><div>{outreach.reason || "—"}</div>
              </div>
            </div>
          )}

          <div className="drawer-block">
            <h4>Note</h4>
            {editMode ? (
              <textarea
                className="form-fill-note-edit"
                value={editForm.note_text}
                onChange={e => setEditField("note_text", e.target.value)}
                rows={14}
              />
            ) : fill.note_text ? (
              <div className="form-fill-note-full">{fill.note_text}</div>
            ) : (
              <div className="drawer-empty-note">No note content.</div>
            )}
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

      {showDeleteConfirm && (
        <ConfirmModal
          icon="!"
          iconTone="warn"
          title="Delete this form fill?"
          subtitle="This removes it from the list and from commission calculations."
          rowList={fill.company_name || "This entry"}
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
