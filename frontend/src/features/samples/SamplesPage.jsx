import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { brandStyle } from "../../config/brandColors";
import SampleDetailDrawer from "./SampleDetailDrawer";
import AddSampleModal from "./AddSampleModal";
import SampleRecordsManagerModal from "./SampleRecordsManagerModal";
import DateFilterCalendar from "./DateFilterCalendar";
import ConfirmModal from "./ConfirmModal";
import FilterDropdown from "../../components/FilterDropdown";
import "../../components/shared.css";
import "./samples.css";

const PAGE_SIZE = 50;

function AddrBadge({ req }) {
  const ranAi = req.address_verification_status === "unverified" && (req.address_verification_note || req.address_verification_confidence != null || req.address_verification_source_url);
  const label = ranAi ? "AI Unverified" : { unverified: "Unverified", ai_verified: "AI Verified", human_verified: "Verified" }[req.address_verification_status] || "Unverified";
  const status = ranAi ? "ai_unverified" : req.address_verification_status;
  return <span className={`addr-badge ${status}`}><span className="addr-dot" />{label}</span>;
}

function StatusBadge({ status }) {
  const label = { requested: "Requested", sent: "Sent", delivered: "Delivered", on_hold: "On hold", rejected: "Rejected" }[status] || status;
  const klass = status === "on_hold" ? "hold" : status;
  return <span className={`status-badge ${klass}`}>{label}</span>;
}

function HubspotBadge({ req }) {
  if (req.status === "sent") {
    return req.hubspot_sent_synced
      ? <span className="status-badge hs-synced">Tracking Synced</span>
      : <span className="status-badge hs-pending">Tracking Not Synced</span>;
  }
  if (req.status === "delivered") {
    return req.hubspot_delivered_synced
      ? <span className="status-badge hs-synced">Delivery Synced</span>
      : <span className="status-badge hs-pending">Delivery Not Synced</span>;
  }
  return <span className="status-badge hs-pending">Not synced</span>;
}

function BrandPills({ req, brandsById }) {
  const brandIds = req.brand_ids || [];
  if (!brandIds || brandIds.length === 0) {
    if (req.assignment_note?.trim()) {
      return <span className="brand-chip-summary special" title={req.assignment_note}>Special Request</span>;
    }
    return <span className="brand-chip-summary unassigned">Needs assignment</span>;
  }
  const brandNames = brandIds.map(id => brandsById[id]?.name).filter(Boolean);
  if (brandNames.length > 1) {
    const first = brandsById[brandIds[0]];
    const s = brandStyle(first?.name || brandNames[0]);
    return (
      <span className="brand-hover-wrap">
        <span className="brand-pill" style={{ background: s.bg, color: s.color }}>{brandNames[0]} +{brandNames.length - 1}</span>
        <span className="brand-hover-popover">
          {brandIds.map(id => {
            const brand = brandsById[id];
            if (!brand) return null;
            const style = brandStyle(brand.name);
            return <span key={id} className="brand-pill" style={{ background: style.bg, color: style.color }}>{brand.name}</span>;
          })}
        </span>
      </span>
    );
  }
  const onlyBrand = brandsById[brandIds[0]];
  if (!onlyBrand) return null;
  const onlyStyle = brandStyle(onlyBrand.name);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
      <span className="brand-pill" style={{ background: onlyStyle.bg, color: onlyStyle.color }}>{onlyBrand.name}</span>
    </div>
  );
}

function daysAgo(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function recordDate(req) {
  return req.created_at?.slice(0, 10) || req.requested_date;
}

function isoLocal(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function monthStartIso() {
  const now = new Date();
  return isoLocal(new Date(now.getFullYear(), now.getMonth(), 1));
}

function weekStartIso() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - start.getDay());
  return isoLocal(start);
}

export default function SamplesPage() {
  const [requests, setRequests] = useState([]);
  const [allRequests, setAllRequests] = useState([]);
  const [brands, setBrands] = useState([]);
  const [sdrs, setSdrs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [statusFilter, setStatusFilter] = useState("");
  const [sdrFilter, setSdrFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [addrFilter, setAddrFilter] = useState("");
  const [dateFilter, setDateFilter] = useState(null);
  const [dateRange, setDateRange] = useState({ from: "", to: "" });
  const [search, setSearch] = useState("");

  const [selectedIds, setSelectedIds] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showManagerModal, setShowManagerModal] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showHsConfirm, setShowHsConfirm] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchAction, setBatchAction] = useState("");
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0 });
  const [notice, setNotice] = useState(null);
  const [openFilter, setOpenFilter] = useState(null);
  const [page, setPage] = useState(1);

  const brandsById = useMemo(() => Object.fromEntries(brands.map(b => [b.id, b])), [brands]);
  const sdrsById = useMemo(() => Object.fromEntries(sdrs.map(s => [s.id, s])), [sdrs]);
  const activeSdrs = useMemo(() => sdrs.filter(s => s.active), [sdrs]);

  const reload = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const [reqs, allReqs, brandList, sdrList] = await Promise.all([
        api.samples.list({
          status: statusFilter || undefined,
          brand_id: brandFilter && brandFilter !== "__special" ? brandFilter : undefined,
          address_status: addrFilter && addrFilter !== "__ai_unverified" ? addrFilter : undefined,
        }),
        api.samples.list(),
        api.brands.list(),
        api.sdrs.list(),
      ]);
      setRequests(reqs);
      setAllRequests(allReqs);
      setBrands(brandList);
      setSdrs(sdrList);
    } catch (e) {
      if (!silent) setError(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [statusFilter, brandFilter, addrFilter]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const id = window.setInterval(() => reload({ silent: true }), 30000);
    return () => window.clearInterval(id);
  }, [reload]);
  useEffect(() => { setPage(1); clearSelection(); }, [statusFilter, sdrFilter, brandFilter, addrFilter, dateFilter, dateRange.from, dateRange.to, search]);

  const visible = useMemo(() => {
    let list = requests;
    if (sdrFilter) list = list.filter(r => (sdrsById[r.sdr_id]?.full_name || "").trim() === sdrFilter);
    if (brandFilter === "__special") list = list.filter(r => !(r.brand_ids || []).length && r.assignment_note?.trim());
    if (addrFilter === "__ai_unverified") {
      list = list.filter(r =>
        r.address_verification_status === "unverified" &&
        (r.address_verification_note || r.address_verification_confidence != null || r.address_verification_source_url)
      );
    }
    if (dateFilter) list = list.filter(r => recordDate(r) === dateFilter);
    if (dateRange.from) list = list.filter(r => recordDate(r) >= dateRange.from);
    if (dateRange.to) list = list.filter(r => recordDate(r) <= dateRange.to);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(r =>
        r.business_name?.toLowerCase().includes(q) ||
        r.contact_name?.toLowerCase().includes(q) ||
        r.tracking_number?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [requests, search, dateFilter, dateRange.from, dateRange.to, sdrFilter, sdrsById, brandFilter, addrFilter]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedVisible = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return visible.slice(start, start + PAGE_SIZE);
  }, [visible, currentPage]);

  const dataDates = useMemo(() => [...new Set(requests.map(recordDate))], [requests]);
  const recordedSdrOptions = useMemo(() => {
    return [...new Set(requests.map(r => (sdrsById[r.sdr_id]?.full_name || "").trim()).filter(Boolean))].sort();
  }, [requests, sdrsById]);
  const statusOptions = [
    { value: "", label: "All statuses" },
    { value: "requested", label: "Requested" },
    { value: "sent", label: "Sent" },
    { value: "delivered", label: "Delivered" },
    { value: "on_hold", label: "On hold" },
    { value: "rejected", label: "Rejected" },
  ];
  const sdrOptions = [{ value: "", label: "All SDRs" }, ...recordedSdrOptions.map(name => ({ value: name, label: name }))];
  const brandOptions = [{ value: "", label: "All brands" }, { value: "__special", label: "Special Request" }, ...brands.map(b => ({ value: b.id, label: b.name }))];
  const addressOptions = [
    { value: "", label: "All addresses" },
    { value: "__ai_unverified", label: "AI Unverified" },
    { value: "unverified", label: "Unverified" },
    { value: "ai_verified", label: "AI Verified" },
    { value: "human_verified", label: "Verified" },
  ];

  const totalSamples = allRequests.length;
  const samplesThisMonth = allRequests.filter(r => recordDate(r) >= monthStartIso()).length;
  const samplesThisWeek = allRequests.filter(r => recordDate(r) >= weekStartIso()).length;

  function toggleSelect(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  function toggleSelectAll() {
    const pageIds = pagedVisible.map(r => r.id);
    setSelectedIds(prev => pageIds.every(id => prev.includes(id))
      ? prev.filter(id => !pageIds.includes(id))
      : [...new Set([...prev, ...pageIds])]
    );
  }
  function clearSelection() { setSelectedIds([]); }

  async function handleArchiveConfirmed() {
    setBatchLoading(true);
    setBatchAction("Archiving selected records");
    try {
      await api.samples.batchArchive(selectedIds, "admin");
      setShowArchiveConfirm(false);
      clearSelection();
      reload();
    } finally {
      setBatchLoading(false);
      setBatchAction("");
    }
  }

  async function handleHsSyncConfirmed() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setBatchLoading(true);
    setBatchAction("Syncing with HubSpot");
    setBatchProgress({ completed: 0, total: ids.length });
    setShowHsConfirm(false);
    let synced = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];
    try {
      for (const id of ids) {
        try {
          const result = await api.samples.batchHubspotSync([id]);
          synced += result?.synced || 0;
          skipped += result?.skipped || 0;
          failed += result?.failed || 0;
          if (result?.errors?.length) errors.push(...result.errors);
        } catch (e) {
          failed += 1;
          const record = requests.find(r => r.id === id);
          errors.push({ id, business_name: record?.business_name || `Record #${id}`, error: e.message });
        } finally {
          setBatchProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
        }
      }
      clearSelection();
      await reload();
      if (failed) {
        const firstError = errors[0];
        setNotice({
          type: "warning",
          title: "HubSpot sync finished with issues",
          message: `Synced ${synced}, skipped ${skipped}, failed ${failed}.${firstError ? ` ${firstError.business_name}: ${firstError.error}` : ""}`,
        });
      } else {
        setNotice({
          type: "success",
          title: "HubSpot sync complete",
          message: `Synced ${synced}, skipped ${skipped}.`,
        });
      }
    } finally {
      setBatchLoading(false);
      setBatchAction("");
      setBatchProgress({ completed: 0, total: 0 });
    }
  }

  async function handleAiAddressVerify() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setBatchLoading(true);
    setBatchAction("Running AI address verification");
    setBatchProgress({ completed: 0, total: ids.length });
    let failed = 0;
    const errors = [];
    try {
      for (const id of ids) {
        try {
          await api.samples.verifyAddress(id);
        } catch (e) {
          failed += 1;
          const record = requests.find(r => r.id === id);
          errors.push(`${record?.business_name || `Record #${id}`}: ${e.message}`);
        } finally {
          setBatchProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
        }
      }
      reload();
      clearSelection();
      if (failed) {
        setNotice({
          type: "warning",
          title: "AI address verification finished with issues",
          message: `${ids.length - failed} completed, ${failed} failed.${errors[0] ? ` ${errors[0]}` : ""}`,
        });
      } else {
        setNotice({
          type: "success",
          title: "AI address verification complete",
          message: `${ids.length} record${ids.length === 1 ? "" : "s"} verified.`,
        });
      }
    } finally {
      setBatchLoading(false);
      setBatchAction("");
      setBatchProgress({ completed: 0, total: 0 });
    }
  }

  const [bulkStatus, setBulkStatus] = useState("");
  async function handleBulkStatus() {
    if (!bulkStatus) return;
    await api.samples.batchStatus(selectedIds, bulkStatus, "admin");
    setBulkStatus("");
    clearSelection();
    reload();
  }

  const selectedNames = requests.filter(r => selectedIds.includes(r.id)).map(r => r.business_name).join(", ");

  return (
    <div className="samples-page">
      <div className="page-header">
        <div>
          <p className="page-title">Sample Records</p>
          <p className="page-sub">Assign brands, track fulfillment, verify addresses.</p>
        </div>
        <div className="page-header-actions">
          <button className="btn-secondary" onClick={() => setShowManagerModal(true)}>Sample Record Management</button>
          <button className="btn-primary" onClick={() => setShowAddModal(true)}>+ Add Sample Request</button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="summary-cards samples-summary">
        <div className="summary-card accent">
          <div className="s-label">Total Samples</div>
          <div className="s-value">{totalSamples}</div>
          <div className="s-sub">all sample records</div>
        </div>
        <div className="summary-card accent">
          <div className="s-label">Samples This Month</div>
          <div className="s-value">{samplesThisMonth}</div>
          <div className="s-sub">requested since month start</div>
        </div>
        <div className="summary-card">
          <div className="s-label">Samples This Week</div>
          <div className="s-value">{samplesThisWeek}</div>
          <div className="s-sub">requested since week start</div>
        </div>
      </div>

      <div className="data-card">
        <div className="toolbar">
          <FilterDropdown value={statusFilter} options={statusOptions} open={openFilter === "status"} onOpenChange={open => setOpenFilter(open ? "status" : null)} onChange={setStatusFilter} />
          <FilterDropdown value={sdrFilter} options={sdrOptions} open={openFilter === "sdr"} onOpenChange={open => setOpenFilter(open ? "sdr" : null)} onChange={setSdrFilter} />
          <FilterDropdown value={brandFilter} options={brandOptions} open={openFilter === "brand"} onOpenChange={open => setOpenFilter(open ? "brand" : null)} onChange={setBrandFilter} />
          <FilterDropdown value={addrFilter} options={addressOptions} open={openFilter === "address"} onOpenChange={open => setOpenFilter(open ? "address" : null)} onChange={setAddrFilter} />

          <DateFilterCalendar
            dataDates={dataDates}
            selectedDate={dateFilter}
            selectedRange={dateRange}
            onSelect={setDateFilter}
            onRangeChange={setDateRange}
            onClear={() => { setDateFilter(null); setDateRange({ from: "", to: "" }); }}
            isOpen={openFilter === "date"}
            onOpenChange={open => setOpenFilter(open ? "date" : null)}
          />

          <button className="btn-secondary samples-export">Export</button>
          <div className="search-wrap samples-search">
            <input placeholder="Search business, contact, tracking #..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {selectedIds.length > 0 && (
          <div className="bulkbar">
            <span className="count">{selectedIds.length} selected</span>
            <div className="sep" />
            <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}>
              <option value="">Change status to...</option>
              <option value="requested">Requested</option>
              <option value="sent">Sent</option>
              <option value="delivered">Delivered</option>
              <option value="on_hold">On hold</option>
              <option value="rejected">Rejected</option>
            </select>
            <button onClick={handleBulkStatus}>Apply</button>
            <div className="sep" />
            <button onClick={handleAiAddressVerify} disabled={batchLoading}>AI Address Verify</button>
            <button onClick={() => setShowHsConfirm(true)} disabled={batchLoading}>Sync to HubSpot</button>
            {batchLoading && (
              <div className="bulk-progress">
                <span>{batchAction || "Working"}</span>
                <div className="bulk-progress-row">
                  <div className="progress-strip determinate">
                    <div style={{ width: `${batchProgress.total ? Math.round((batchProgress.completed / batchProgress.total) * 100) : 0}%` }} />
                  </div>
                  <span className="bulk-progress-count">({batchProgress.completed}/{batchProgress.total} Completed)</span>
                </div>
              </div>
            )}
            <div className="spacer" />
            <button className="danger-outline" onClick={() => setShowArchiveConfirm(true)}>Archive selected</button>
            <button className="clear" onClick={clearSelection}>Clear</button>
          </div>
        )}

        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="empty-state">No sample requests match these filters.</div>
        ) : (
          <div className="sample-record-list-scroll">
            <table className="data-table sample-record-list-table">
              <thead>
                <tr>
                  <th className="checkcol"><input type="checkbox" checked={pagedVisible.length > 0 && pagedVisible.every(r => selectedIds.includes(r.id))} onChange={toggleSelectAll} /></th>
                  <th>SDR</th>
                  <th>Business</th>
                  <th>Brand</th>
                  <th>Address</th>
                  <th>Status</th>
                  <th>HubSpot</th>
                  <th>Tracking #</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {pagedVisible.map(r => {
                  const age = daysAgo(recordDate(r));
                  const stale = (r.status === "requested" || r.status === "on_hold") && age >= 3;
                  return (
                    <tr key={r.id} className={`${stale ? "row-stale" : ""} ${selectedIds.includes(r.id) ? "selected" : ""}`} onClick={() => setOpenId(r.id)}>
                      <td className="checkcol" onClick={e => e.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleSelect(r.id)} /></td>
                      <td>{(sdrsById[r.sdr_id]?.full_name || "—").trim()}</td>
                      <td className="col-name">
                        {r.business_name}
                        <div className="biz-sub">{[r.contact_name, r.city && r.state ? `${r.city}, ${r.state}` : null].filter(Boolean).join(" · ") || "—"}</div>
                      </td>
                      <td className="col-brands"><BrandPills req={r} brandsById={brandsById} /></td>
                      <td><AddrBadge req={r} /></td>
                      <td><StatusBadge status={r.status} /></td>
                      <td><HubspotBadge req={r} /></td>
                      <td className="tracking">{r.tracking_number || "—"}</td>
                      <td>
                        {new Date(recordDate(r) + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        <div className={`age-tag ${stale ? "stale" : ""}`}>{age === 0 ? "today" : `${age}d ago`}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && visible.length > 0 && (
          <div className="table-footer">
            <span className="table-footer-label">
              Showing {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, visible.length)} of {visible.length} sample records
            </span>
            <div className="pagination">
              <button className="pg-btn" disabled={currentPage === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).slice(Math.max(0, currentPage - 3), Math.min(pageCount, currentPage + 2)).map(p => (
                <button key={p} className={`pg-btn ${p === currentPage ? "active" : ""}`} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button className="pg-btn" disabled={currentPage === pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}>Next</button>
            </div>
          </div>
        )}
      </div>
      <div className="footer-note">Archived records are hidden here but kept for history — nothing is permanently deleted from this view.</div>

      {openId && (
        <SampleDetailDrawer
          requestId={openId}
          brands={brands}
          sdrsById={sdrsById}
          onClose={() => setOpenId(null)}
          onChanged={reload}
        />
      )}

      {showAddModal && (
        <AddSampleModal
          sdrs={activeSdrs}
          brands={brands}
          onClose={() => setShowAddModal(false)}
          onCreated={() => { setShowAddModal(false); reload(); }}
        />
      )}

      {showManagerModal && (
        <SampleRecordsManagerModal
          brands={brands}
          sdrsById={sdrsById}
          onClose={() => setShowManagerModal(false)}
          onChanged={reload}
        />
      )}

      {showArchiveConfirm && (
        <ConfirmModal
          icon="⚠" iconTone="warn"
          title={`Archive ${selectedIds.length} records?`}
          subtitle="Hidden from view, kept in history. Nothing is permanently deleted."
          rowList={selectedNames}
          confirmLabel="Archive Records"
          confirmTone="danger"
          loading={batchLoading}
          onCancel={() => setShowArchiveConfirm(false)}
          onConfirm={handleArchiveConfirmed}
        />
      )}

      {showHsConfirm && (
        <ConfirmModal
          icon="↻" iconTone="info"
          title={`Sync ${selectedIds.length} records to HubSpot?`}
          subtitle="Pushes status & tracking number to each contact/company profile."
          rowList={selectedNames}
          confirmLabel="Sync Now"
          confirmTone="primary"
          loading={batchLoading}
          onCancel={() => setShowHsConfirm(false)}
          onConfirm={handleHsSyncConfirmed}
        />
      )}
      {notice && (
        <div className={`app-notice ${notice.type}`}>
          <button type="button" className="app-notice-close" onClick={() => setNotice(null)}>×</button>
          <div className="app-notice-title">{notice.title}</div>
          <div className="app-notice-message">{notice.message}</div>
        </div>
      )}
    </div>
  );
}
