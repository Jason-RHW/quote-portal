import { useState } from "react";
import { api } from "../../api/client";
import PickSampleRecordModal from "./PickSampleRecordModal";
import "../../components/shared.css";

const STATUS_LABELS = {
  requested: "Requested", sent: "Sent", in_transit: "In Transit", delivered: "Delivered",
  returned: "Returned", delivery_issue: "Delivery issue", on_hold: "On hold", rejected: "Rejected",
};

function fmtAddress(req) {
  return [req.address_line, [req.city, req.state].filter(Boolean).join(", "), req.zip_code].filter(Boolean).join(" · ") || "—";
}

function recordDate(req) {
  return req.created_at?.slice(0, 10) || req.requested_date || "—";
}

function rowKey(label, i) {
  return `${label.source_file}::${label.page_index ?? "single"}::${i}`;
}

function isAlreadyDelivered(row) {
  const { selectedRecord, label } = row;
  return !!(
    selectedRecord &&
    selectedRecord.status === "delivered" &&
    selectedRecord.tracking_number &&
    selectedRecord.tracking_number === label.extracted.tracking_number
  );
}

export default function UploadShippingLabelModal({ onClose, onApplied }) {
  const [files, setFiles] = useState([]);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState(null);
  const [fileErrors, setFileErrors] = useState([]);
  const [rows, setRows] = useState(null); // [{ label, selectedRecord, result: null|'applied'|'error', resultMessage }]
  const [applying, setApplying] = useState(false);
  const [pickerForRow, setPickerForRow] = useState(null);

  function handleFiles(e) {
    const picked = Array.from(e.target.files || []);
    setError(null);
    const bad = picked.find(f => f.type !== "application/pdf");
    if (bad) { setError(`"${bad.name}" isn't a PDF file.`); return; }
    const tooBig = picked.find(f => f.size > 10 * 1024 * 1024);
    if (tooBig) { setError(`"${tooBig.name}" is too large (10MB max).`); return; }
    setFiles(prev => [...prev, ...picked]);
    e.target.value = "";
  }

  function removeFile(i) {
    setFiles(prev => prev.filter((_, idx) => idx !== i));
  }

  async function extract() {
    if (!files.length) { setError("Choose at least one PDF file first."); return; }
    setExtracting(true); setError(null);
    try {
      const data = await api.samples.extractShippingLabels(files);
      setFileErrors(data.file_errors || []);
      setRows((data.labels || []).map(label => ({
        label,
        selectedRecord: label.candidates?.[0] || null,
        result: null,
        resultMessage: null,
      })));
    } catch (e) {
      setError("Couldn't read those labels — you can still mark records as Sent manually. (" + e.message + ")");
    } finally {
      setExtracting(false);
    }
  }

  function setRowRecord(idx, record) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, selectedRecord: record } : r));
    setPickerForRow(null);
  }

  const selectedCount = rows ? rows.filter(r => r.selectedRecord && r.result !== "applied" && !isAlreadyDelivered(r)).length : 0;

  async function confirmAll() {
    if (!rows) return;
    setApplying(true);
    const next = [...rows];
    let succeeded = 0;
    const errors = [];
    for (let i = 0; i < next.length; i++) {
      const row = next[i];
      if (!row.selectedRecord || row.result === "applied" || isAlreadyDelivered(row)) continue;
      const recordLabel = row.selectedRecord?.business_name || row.label.source_file;
      const { tracking_number, carrier, ship_date } = row.label.extracted;
      if (!tracking_number || !ship_date) {
        next[i] = { ...row, result: "error", resultMessage: "Missing tracking number or ship date" };
        errors.push(`${recordLabel}: missing tracking number or ship date`);
        setRows([...next]);
        continue;
      }
      try {
        await api.samples.changeStatus(row.selectedRecord.id, {
          status: "sent",
          tracking_number,
          carrier: carrier || null,
          sent_date: ship_date,
          changed_by: "admin",
        });
        next[i] = { ...row, result: "applied", resultMessage: null };
        succeeded += 1;
      } catch (e) {
        next[i] = { ...row, result: "error", resultMessage: e.message };
        errors.push(`${recordLabel}: ${e.message}`);
      }
      setRows([...next]);
    }
    setApplying(false);
    onApplied({ succeeded, failed: errors.length, errors });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="modal-title">Upload shipping labels</p>
            <p className="modal-subtitle">Upload one or more PDFs — each can contain multiple labels (one per page). We'll find the matching sample request for each one to confirm before marking it Sent.</p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {error && <div className="error-banner">{error}</div>}

          {!rows && (
            <>
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>PDF files</label>
                <input type="file" accept="application/pdf" multiple onChange={handleFiles} />
              </div>
              {files.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  {files.map((f, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "6px 10px", border: "0.5px solid var(--border)", borderRadius: 5, marginBottom: 6 }}>
                      <span>{f.name}</span>
                      <button type="button" className="line-item-remove" onClick={() => removeFile(i)} aria-label="Remove file">×</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {rows && (
            <>
              {fileErrors.length > 0 && (
                <div className="error-banner" style={{ marginBottom: 14 }}>
                  {fileErrors.map((fe, i) => <div key={i}>{fe.source_file}: {fe.error}</div>)}
                </div>
              )}

              {rows.length === 0 && (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No labels could be read from these files.</p>
              )}

              {rows.map((row, idx) => {
                const { label, selectedRecord, result, resultMessage } = row;
                const { extracted, source_file, page_index } = label;
                const alreadyDelivered = isAlreadyDelivered(row);
                return (
                  <div key={rowKey(label, idx)} style={{ border: "0.5px solid var(--border)", borderRadius: 8, padding: 14, marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" }}>
                        {source_file}{page_index != null ? ` — page ${page_index + 1}` : ""}
                      </span>
                      {result === "applied" && <span className="status-badge fulfilled">✓ Marked Sent</span>}
                      {result === "error" && <span className="status-badge rejected">✗ {resultMessage}</span>}
                      {!result && alreadyDelivered && <span className="status-badge fulfilled">✓ Already delivered</span>}
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", fontSize: 13, marginBottom: 12 }}>
                      <div><span style={{ color: "var(--text-secondary)" }}>Tracking #</span><div>{extracted.tracking_number || "—"}</div></div>
                      <div><span style={{ color: "var(--text-secondary)" }}>Carrier</span><div>{extracted.carrier || "—"}</div></div>
                      <div><span style={{ color: "var(--text-secondary)" }}>Ship date</span><div>{extracted.ship_date || "—"}</div></div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <span style={{ color: "var(--text-secondary)" }}>Ship to</span>
                        <div>{[extracted.business_name, extracted.recipient_name].filter(Boolean).join(" · ") || "—"}</div>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "10px 12px", border: "0.5px solid var(--border)", background: "var(--surface-card)", borderRadius: 6 }}>
                      {selectedRecord ? (
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontWeight: 500, fontSize: 13 }}>{selectedRecord.business_name}</span>
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{recordDate(selectedRecord)}</span>
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{selectedRecord.contact_name || "—"}</div>
                          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{fmtAddress(selectedRecord)}</div>
                          <span className="status-badge" style={{ marginTop: 4, display: "inline-block" }}>{STATUS_LABELS[selectedRecord.status] || selectedRecord.status}</span>
                          {alreadyDelivered && !result && (
                            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "6px 0 0" }}>
                              Tracking # already matches this delivered record — no changes needed.
                            </p>
                          )}
                        </div>
                      ) : (
                        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>No match found — pick a record manually.</p>
                      )}
                      <button
                        type="button" className="btn-secondary" style={{ flexShrink: 0 }}
                        disabled={result === "applied"}
                        onClick={() => setPickerForRow(idx)}
                      >
                        Change match
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={applying}>Cancel</button>
          {!rows ? (
            <button type="button" className="btn-primary" onClick={extract} disabled={extracting || !files.length}>
              {extracting ? "Reading labels…" : `Extract & match${files.length ? ` (${files.length})` : ""}`}
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={confirmAll} disabled={applying || selectedCount === 0}>
              {applying ? "Saving…" : `Confirm ${selectedCount}`}
            </button>
          )}
        </div>
      </div>

      {pickerForRow != null && (
        <PickSampleRecordModal
          onClose={() => setPickerForRow(null)}
          onPick={(record) => setRowRecord(pickerForRow, record)}
        />
      )}
    </div>
  );
}
