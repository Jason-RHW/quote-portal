import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import "../../components/shared.css";
import "./spiff.css";

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month) {
  const [year, m] = month.split("-").map(Number);
  const start = `${year}-${String(m).padStart(2, "0")}-01`;
  const endDate = new Date(year, m, 0);
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
  return { start, end };
}

function money(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedMoney(value) {
  const n = Number(value || 0);
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function bonusBreakdown(details = [], total = 0) {
  if (details.length > 0) return details.map(item => money(item.amount)).join(" + ");
  return money(total);
}

function recordFormula(records = [], baseRate) {
  const baseCount = records.filter(record => !record.spiff_applied).length;
  const spiffGroups = records
    .filter(record => record.spiff_applied)
    .reduce((acc, record) => {
      const amount = Number(record.amount || 0);
      acc[amount] = (acc[amount] || 0) + 1;
      return acc;
    }, {});
  return {
    baseCount,
    spiffParts: Object.entries(spiffGroups).map(([amount, count]) => ({ amount: Number(amount), count })),
  };
}

function ruleLabel(rule) {
  const labels = {
    base_commission: "Default commission",
    applied_spiff: "SPIFF applied",
    flat_rate: "Flat rate",
    threshold_bonus: "Threshold bonus",
    first_to_target: "First to target",
    first_to_targets: "First to milestones",
    leaderboard: "Leaderboard",
    flat_plus_threshold: "Flat + threshold",
  };
  return labels[rule?.rule_type] || "Rule";
}

function entityLabel(rule) {
  if (rule?.entity_type === "quote") return "quotes";
  if (rule?.entity_type === "both") return "samples and quotes";
  return "samples";
}

function rateText(rule) {
  const parts = [];
  if (rule?.entity_type !== "quote" && rule?.amount_per_sample != null) parts.push(`${money(rule.amount_per_sample)} per sample`);
  if (rule?.entity_type !== "sample" && rule?.amount_per_quote != null) parts.push(`${money(rule.amount_per_quote)} per quote`);
  return parts.join(" and ");
}

function ruleSummary(rule) {
  const rates = rateText(rule);
  if (rates) return rates;
  if (rule?.rule_type === "threshold_bonus") return `${money(rule.bonus_amount)} bonus if ${rule.target_count} ${entityLabel(rule)}`;
  if (rule?.rule_type === "first_to_target") return `${money(rule.bonus_amount)} first to ${rule.target_count} ${entityLabel(rule)}`;
  if (rule?.rule_type === "first_to_targets") return `${rule.first_to_targets?.length || 0} first-to-target milestone(s)`;
  return ruleLabel(rule);
}

function plainUnderstanding(rule) {
  if (!rule) return "";
  const quoteCondition = rule.quote_value_min != null ? ` Only quotes with value greater than ${money(rule.quote_value_min)} count.` : "";
  if (rule.rule_type === "flat_rate") {
    return `From ${rule.start_date} to ${rule.end_date}, pay each SDR ${rateText(rule)}. This replaces the default $1/sample + $3/quote commission for records in this SPIFF period.${quoteCondition}`;
  }
  if (rule.rule_type === "threshold_bonus") {
    if (rule.qualification_scope === "team") {
      return `From ${rule.start_date} to ${rule.end_date}, if the team reaches ${rule.target_count} total eligible ${entityLabel(rule)}, pay ${money(rule.bonus_amount)} to each SDR who was active as of that date.`;
    }
    return `From ${rule.start_date} to ${rule.end_date}, pay each SDR ${money(rule.bonus_amount)} if they reach ${rule.target_count} eligible ${entityLabel(rule)}.`;
  }
  if (rule.rule_type === "first_to_target") {
    return `From ${rule.start_date} to ${rule.end_date}, pay ${money(rule.bonus_amount)} to the first SDR to reach ${rule.target_count} eligible ${entityLabel(rule)}.`;
  }
  if (rule.rule_type === "first_to_targets") {
    const milestones = (rule.first_to_targets || []).map(item => `first to ${item.target_count} gets ${money(item.bonus_amount)}`).join("; ");
    return `From ${rule.start_date} to ${rule.end_date}, run multiple first-to-target milestones for ${entityLabel(rule)}: ${milestones}.`;
  }
  return `From ${rule.start_date} to ${rule.end_date}, apply a ${ruleLabel(rule).toLowerCase()} SPIFF to eligible ${entityLabel(rule)}.`;
}

function exampleCalculation(rule) {
  if (!rule) return [];
  if (rule.rule_type === "flat_rate") {
    const sampleRate = Number(rule.amount_per_sample || 0);
    const quoteRate = Number(rule.amount_per_quote || 0);
    const sampleCount = rule.entity_type === "quote" ? 0 : 4;
    const quoteCount = rule.entity_type === "sample" ? 0 : 2;
    const lines = [];
    if (sampleCount) lines.push(`4 samples x ${money(sampleRate)} = ${money(4 * sampleRate)}`);
    if (quoteCount) lines.push(`2 quotes x ${money(quoteRate)} = ${money(2 * quoteRate)}`);
    lines.push(`Total = ${money((sampleCount * sampleRate) + (quoteCount * quoteRate))}`);
    return lines;
  }
  if (rule.rule_type === "threshold_bonus") {
    if (rule.qualification_scope === "team") {
      return [`If the team reaches ${rule.target_count} total eligible ${entityLabel(rule)}, each active SDR gets ${money(rule.bonus_amount)}.`];
    }
    return [`If an SDR has ${rule.target_count} eligible ${entityLabel(rule)}, total SPIFF = ${money(rule.bonus_amount)}.`];
  }
  if (rule.rule_type === "first_to_target") {
    return [`The first SDR to reach ${rule.target_count} eligible ${entityLabel(rule)} gets ${money(rule.bonus_amount)}.`];
  }
  if (rule.rule_type === "first_to_targets") {
    return (rule.first_to_targets || []).map(item => `First SDR to ${item.target_count} eligible ${entityLabel(rule)} gets ${money(item.bonus_amount)}.`);
  }
  return ["Review the applied real-data preview below before confirming."];
}

function campaignTitle(campaign) {
  const rule = campaign.rule;
  return `${rule.start_date} to ${rule.end_date} · ${ruleSummary(rule)}`;
}

function newTraditionalLayer() {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sdrs: [],
    amount: 5,
    appliesTo: "sample",
    conditionType: "none",
    conditionValue: "",
  };
}

function buildTraditionalRule(layer, start, end, index) {
  const amount = Number(layer.amount || 0);
  const appliesTo = layer.appliesTo;
  const isQuote = appliesTo === "quote";
  const isBonus = appliesTo === "bonus";
  const base = {
    name: `Traditional SPIFF layer ${index + 1}`,
    rule_type: isBonus ? "threshold_bonus" : "flat_rate",
    start_date: start,
    end_date: end,
    date_field: "created_at",
    entity_type: isQuote ? "quote" : "sample",
    threshold_entity_type: layer.conditionType === "quote_value_gt" ? "quote" : "sample",
    qualification_scope: "individual",
    active_filter: "none",
    eligible_statuses: ["requested", "sent", "delivered"],
    amount_per_sample: isQuote || isBonus ? null : amount,
    amount_per_quote: isQuote ? amount : null,
    quote_value_min: null,
    target_count: isBonus ? 0 : null,
    bonus_amount: isBonus ? amount : null,
    first_to_targets: [],
    max_winners: null,
    leaderboard_prizes: [],
    included_sdr_names: layer.sdrs || [],
    tie_behavior: "N/A",
    assumptions: [],
    missing_info: [],
  };

  if (isBonus && layer.conditionType === "none") {
    return base;
  }

  if (layer.conditionType === "first_to_samples") {
    return {
      ...base,
      rule_type: "first_to_target",
      entity_type: "sample",
      threshold_entity_type: "sample",
      amount_per_sample: null,
      amount_per_quote: null,
      target_count: Number(layer.conditionValue || 0),
      bonus_amount: amount,
      max_winners: 1,
    };
  }
  if (layer.conditionType === "quote_value_gt") {
    return {
      ...base,
      entity_type: "quote",
      threshold_entity_type: "quote",
      amount_per_sample: null,
      amount_per_quote: amount,
      quote_value_min: Number(layer.conditionValue || 0),
    };
  }
  return base;
}

export default function SpiffMockPage() {
  const [month, setMonth] = useState(monthKey());
  const [dashboard, setDashboard] = useState(null);
  const [appliedRuleReport, setAppliedRuleReport] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [stagedPreview, setStagedPreview] = useState(null);
  const [stagedRules, setStagedRules] = useState([]);
  const [detailRow, setDetailRow] = useState(null);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [hoverReason, setHoverReason] = useState(null);
  const [ruleTab, setRuleTab] = useState("ai");
  const [sdrOptions, setSdrOptions] = useState([]);
  const [traditionalLayers, setTraditionalLayers] = useState([newTraditionalLayer()]);
  const [{ start, end }, setDates] = useState(monthBounds(monthKey()));
  const [ruleText, setRuleText] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    const bounds = monthBounds(month);
    setDates(bounds);
    setAppliedRuleReport(null);
    setStagedPreview(null);
    setDetailRow(null);
    setLoading(true);
    setError("");
    Promise.all([api.spiff.monthly(month), api.spiff.campaigns(month)])
      .then(([base, savedCampaigns]) => {
        if (ignore) return null;
        setDashboard(base);
        setCampaigns(savedCampaigns || []);
        if (savedCampaigns.length > 0) {
          return api.spiff.apply({ month, rules: savedCampaigns.map(campaign => campaign.rule) })
            .then(result => {
              if (!ignore) setAppliedRuleReport(result);
            });
        }
        return null;
      })
      .catch(e => {
        if (!ignore) setError(e.message);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [month]);

  useEffect(() => {
    api.sdrs.list(false)
      .then(rows => setSdrOptions(rows || []))
      .catch(() => setSdrOptions([]));
  }, []);

  const report = appliedRuleReport || dashboard;
  const rows = useMemo(() => report?.results || [], [report]);
  const isRuleApplied = Boolean(appliedRuleReport);
  const sampleTotal = report?.totals?.sample_count || 0;
  const quoteTotal = report?.totals?.quote_count || 0;
  const payoutTotal = report?.totals?.payout_amount || 0;

  async function runPreview() {
    setPreviewLoading(true);
    setError("");
    setStagedPreview(null);
    setStagedRules([]);
    try {
      if (ruleTab === "ai") {
        const result = await api.spiff.preview({ start_date: start, end_date: end, prompt: ruleText });
        setStagedPreview(result);
        setStagedRules([result.rule]);
      } else {
        const rules = traditionalLayers.map((layer, index) => buildTraditionalRule(layer, start, end, index));
        const result = rules.length === 1
          ? await api.spiff.previewRules({ rules })
          : await api.spiff.apply({ month, rules: [...campaigns.map(campaign => campaign.rule), ...rules] });
        setStagedPreview(result);
        setStagedRules(rules);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function confirmPreview() {
    if (!stagedPreview || stagedRules.length === 0) return;
    setPreviewLoading(true);
    setError("");
    try {
      const createdCampaigns = stagedRules.map((rule, index) => ({
          prompt: ruleTab === "ai" ? ruleText.trim() : `Traditional rule layer ${index + 1}`,
          rule,
      }));
      const nextCampaigns = await api.spiff.createCampaigns(month, { campaigns: createdCampaigns });
      const result = await api.spiff.apply({ month, rules: nextCampaigns.map(campaign => campaign.rule) });
      setCampaigns(nextCampaigns);
      setAppliedRuleReport(result);
      setShowRuleModal(false);
      setDetailRow(null);
      setStagedPreview(null);
      setStagedRules([]);
      setRuleText("");
      setTraditionalLayers([newTraditionalLayer()]);
      setDates(monthBounds(month));
    } catch (e) {
      setError(e.message);
    } finally {
      setPreviewLoading(false);
    }
  }

  function closeRuleModal() {
    setShowRuleModal(false);
    setStagedPreview(null);
    setStagedRules([]);
  }

  async function clearAppliedRule() {
    setLoading(true);
    setError("");
    try {
      await api.spiff.clearCampaigns(month);
    } catch (e) {
      setError(e.message);
      setLoading(false);
      return;
    }
    setCampaigns([]);
    setAppliedRuleReport(null);
    setStagedPreview(null);
    setDetailRow(null);
    setHoverReason(null);
    setLoading(false);
  }

  async function deleteCampaign(id) {
    setLoading(true);
    setError("");
    let nextCampaigns;
    try {
      nextCampaigns = await api.spiff.deleteCampaign(id);
    } catch (e) {
      setError(e.message);
      setLoading(false);
      return;
    }
    setCampaigns(nextCampaigns || []);
    setDeleteCandidate(null);
    setDetailRow(null);
    setHoverReason(null);
    if (!nextCampaigns || nextCampaigns.length === 0) {
      setAppliedRuleReport(null);
      setLoading(false);
      return;
    }
    try {
      const result = await api.spiff.apply({ month, rules: nextCampaigns.map(campaign => campaign.rule) });
      setAppliedRuleReport(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function openNewRule() {
    const bounds = monthBounds(month);
    setDates(bounds);
    setRuleText("");
    setStagedPreview(null);
    setStagedRules([]);
    setRuleTab("ai");
    setTraditionalLayers([newTraditionalLayer()]);
    setShowRuleModal(true);
  }

  return (
    <div className="spiff-page">
      <div className="page-header">
        <div>
          <p className="page-title">SDR Commission Dashboard</p>
          <p className="page-sub">Base: $1/Sample, $3/Quote</p>
        </div>
        <div className="page-header-actions">
          <label className="spiff-month-filter">
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
          </label>
          <button className="btn-secondary" onClick={() => setShowCampaignModal(true)}>
            Applied SPIFF Rules ({campaigns.length})
          </button>
          <button className="btn-primary" onClick={openNewRule}>New SPIFF Rule</button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="summary-cards spiff-summary">
        <div className="summary-card accent">
          <div className="s-label">Eligible SDRs</div>
          <div className="s-value">{report?.totals?.sdr_count || 0}</div>
        </div>
        <div className="summary-card accent">
          <div className="s-label">Samples</div>
          <div className="s-value">{sampleTotal}</div>
        </div>
        <div className="summary-card accent">
          <div className="s-label">Quotes</div>
          <div className="s-value">{quoteTotal}</div>
        </div>
      </div>

      <div className="data-card spiff-results-card">
        <div className="spiff-results-header">
          <div>
            <div className="spiff-table-title">SDR Breakdown</div>
            <div className="spiff-card-sub">
              {isRuleApplied ? "Full month with SPIFF adjustment applied" : "Default monthly commission"}
            </div>
          </div>
        </div>
        <div className="spiff-table-scroll">
          {loading ? (
            <div className="empty-state">Loading commission dashboard...</div>
          ) : rows.length === 0 ? (
            <div className="empty-state">No SDR activity found for this period.</div>
          ) : (
            <table className="data-table spiff-table">
              <thead>
                <tr>
                  <th>SDR</th>
                  <th>Samples</th>
                  <th>Quotes</th>
                  <th>Commission</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.sdr_id}>
                    <td className="col-name">{row.sdr_name}</td>
                    <td>{row.eligible_sample_count || 0}</td>
                    <td>{row.eligible_quote_count || 0}</td>
                    <td><CommissionAmount row={row} setHoverReason={setHoverReason} /></td>
                    <td>
                      <button className="row-action-btn" onClick={() => setDetailRow(row)}>View list</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="spiff-total-line">
          <span>Total Commission</span>
          <strong>{money(payoutTotal)}</strong>
        </div>
      </div>

      {hoverReason && <ReasonCard data={hoverReason} />}

      {showCampaignModal && (
        <div className="modal-overlay">
          <div className="modal-box spiff-campaign-modal">
            <div className="modal-header">
              <div>
                <p className="modal-title">Applied SPIFF Rules</p>
                <p className="modal-subtitle">{campaigns.length} layer{campaigns.length === 1 ? "" : "s"} applied to {month}</p>
              </div>
              <button className="modal-close" onClick={() => setShowCampaignModal(false)}>x</button>
            </div>
            <div className="modal-body">
              {campaigns.length === 0 ? (
                <div className="spiff-empty">No SPIFF campaigns applied to this month.</div>
              ) : (
                <div className="spiff-campaign-list">
                  {campaigns.map(campaign => (
                    <div className="spiff-campaign-row" key={campaign.id}>
                      <div>
                        <strong>{campaignTitle(campaign)}</strong>
                        <span>{campaign.prompt || plainUnderstanding(campaign.rule)}</span>
                      </div>
                      <button className="row-action-btn danger" onClick={() => setDeleteCandidate(campaign)}>Delete</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {campaigns.length > 0 && (
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => { clearAppliedRule(); setShowCampaignModal(false); }}>
                  Clear all SPIFFs
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {deleteCandidate && (
        <div className="modal-overlay">
          <div className="modal-box spiff-confirm-modal">
            <div className="modal-header">
              <div>
                <p className="modal-title">Delete SPIFF Campaign?</p>
                <p className="modal-subtitle">{campaignTitle(deleteCandidate)}</p>
              </div>
              <button className="modal-close" onClick={() => setDeleteCandidate(null)}>x</button>
            </div>
            <div className="modal-body">
              <div className="spiff-empty">This removes the layer from {month} and recalculates commission with the remaining campaigns.</div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setDeleteCandidate(null)}>Cancel</button>
              <button className="btn-primary" onClick={() => deleteCampaign(deleteCandidate.id)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {detailRow && (
        <div className="modal-overlay">
          <div className="modal-box spiff-detail-modal">
            <div className="modal-header">
              <div>
                <p className="modal-title">{detailRow.sdr_name}</p>
                <p className="modal-subtitle">
                  {detailRow.eligible_sample_count || 0} samples, {detailRow.eligible_quote_count || 0} quotes
                </p>
              </div>
              <button className="modal-close" onClick={() => setDetailRow(null)}>x</button>
            </div>
            <div className="modal-body spiff-detail-body">
              <RecordTable title="Samples" rows={detailRow.samples || []} />
              <RecordTable title="Quotes" rows={detailRow.quotes || []} />
            </div>
          </div>
        </div>
      )}

      {showRuleModal && (
        <div className="modal-overlay">
          <div className="modal-box spiff-rule-modal">
            <div className="modal-header">
              <div>
                <p className="modal-title">SPIFF Rule Preview</p>
                <p className="modal-subtitle">Preview the rule explanation, then confirm to apply it to real local data.</p>
              </div>
              <button className="modal-close" onClick={closeRuleModal}>x</button>
            </div>
            <div className="modal-body">
              <div className="spiff-form-grid">
                <div className="form-field">
                  <label>Start date</label>
                  <input type="date" value={start} onChange={e => setDates(prev => ({ ...prev, start: e.target.value }))} />
                </div>
                <div className="form-field">
                  <label>End date</label>
                  <input type="date" value={end} onChange={e => setDates(prev => ({ ...prev, end: e.target.value }))} />
                </div>
              </div>
              <div className="spiff-tabs">
                <button className={ruleTab === "ai" ? "active" : ""} onClick={() => { setRuleTab("ai"); setStagedPreview(null); setStagedRules([]); }}>
                  <span className="spiff-tab-icon">✦</span> AI SPIFF Configurator
                </button>
                <button className={ruleTab === "traditional" ? "active" : ""} onClick={() => { setRuleTab("traditional"); setStagedPreview(null); setStagedRules([]); }}>
                  Manual SPIFF Configurator
                </button>
              </div>
              {ruleTab === "ai" ? (
                <div className="form-field">
                  <label>SPIFF Rule</label>
                  <textarea
                    className="spiff-rule-input"
                    value={ruleText}
                    onChange={e => setRuleText(e.target.value)}
                    placeholder="e.g. pay $5 per submitted samples"
                  />
                </div>
              ) : (
                <div className="spiff-traditional-panel">
                  <div className="spiff-traditional-header">
                    <div className="spiff-table-title">SPIFF Layers</div>
                    <button className="row-action-btn" onClick={() => setTraditionalLayers(prev => [...prev, newTraditionalLayer()])}>Add Layer</button>
                  </div>
                  <div className="spiff-traditional-table">
                    {traditionalLayers.map(layer => (
                      <TraditionalLayerRow
                        key={layer.id}
                        layer={layer}
                        sdrOptions={sdrOptions}
                        canRemove={traditionalLayers.length > 1}
                        onChange={next => setTraditionalLayers(prev => prev.map(item => item.id === layer.id ? next : item))}
                        onRemove={() => setTraditionalLayers(prev => prev.filter(item => item.id !== layer.id))}
                      />
                    ))}
                  </div>
                </div>
              )}

              {stagedPreview && (
                <div className="spiff-preview-panel">
                  <div className="spiff-table-title">Preview Rule Explanation</div>
                  <div className="spiff-plain-box">
                    <strong>Plain-language understanding</strong>
                    <span>{plainUnderstanding(stagedPreview.rule)}</span>
                  </div>
                  <div className="spiff-example-box">
                    <strong>Example calculation</strong>
                    {exampleCalculation(stagedPreview.rule).map(line => <span key={line}>{line}</span>)}
                  </div>
                  <div className="spiff-applied-preview">
                    <div className="spiff-table-title">Applied to real data preview</div>
                    <table className="data-table spiff-preview-table">
                      <thead>
                        <tr>
                          <th>SDR</th>
                          <th>Samples</th>
                          <th>Sample $</th>
                          <th>Quotes</th>
                          <th>Quote $</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stagedPreview.results.slice(0, 6).map(row => (
                          <tr key={row.sdr_id}>
                            <td>{row.sdr_name}</td>
                            <td>{row.eligible_sample_count || 0}</td>
                            <td>{money(row.sample_payout || 0)}</td>
                            <td>{row.eligible_quote_count || 0}</td>
                            <td>{money(row.quote_payout || 0)}</td>
                            <td>{money(row.payout_amount || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="spiff-preview-total">
                    Preview total: <strong>{money(stagedPreview.totals.payout_amount)}</strong>
                  </div>
                  {stagedPreview.rule.assumptions?.length > 0 && (
                    <div className="spiff-note"><strong>Assumptions</strong><ul>{stagedPreview.rule.assumptions.map(item => <li key={item}>{item}</li>)}</ul></div>
                  )}
                  {stagedPreview.rule.missing_info?.length > 0 && (
                    <div className="spiff-note warning"><strong>Needs review</strong><ul>{stagedPreview.rule.missing_info.map(item => <li key={item}>{item}</li>)}</ul></div>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={closeRuleModal}>Cancel</button>
              <button className="btn-secondary" onClick={runPreview} disabled={previewLoading || !start || !end || (ruleTab === "ai" && !ruleText.trim())}>
                {previewLoading ? "Previewing..." : "Preview Rule"}
              </button>
              <button className="btn-primary" onClick={confirmPreview} disabled={!stagedPreview || previewLoading}>
                {previewLoading && stagedPreview ? "Applying..." : "Confirm & Apply"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TraditionalLayerRow({ layer, sdrOptions, canRemove, onChange, onRemove }) {
  const [sdrOpen, setSdrOpen] = useState(false);

  function update(field, value) {
    onChange({ ...layer, [field]: value });
  }

  function toggleSdr(name) {
    const selected = new Set(layer.sdrs || []);
    if (selected.has(name)) {
      selected.delete(name);
    } else {
      selected.add(name);
    }
    update("sdrs", Array.from(selected));
  }

  function sdrLabel() {
    if (!layer.sdrs?.length) return "All SDRs";
    if (layer.sdrs.length === 1) return layer.sdrs[0];
    return `${layer.sdrs.length} SDRs selected`;
  }

  return (
    <div className="spiff-traditional-row">
      <div className="spiff-layer-field spiff-sdr-field">
        <label>Applied to SDR</label>
        <button type="button" className="spiff-sdr-dropdown-btn" onClick={() => setSdrOpen(open => !open)}>
          <span>{sdrLabel()}</span>
          <span>⌄</span>
        </button>
        {sdrOpen && (
          <div className="spiff-sdr-menu">
            <label className="spiff-sdr-option">
              <input type="checkbox" checked={!layer.sdrs?.length} onChange={() => update("sdrs", [])} />
              <span>All SDRs</span>
            </label>
            {sdrOptions.map(sdr => (
              <label className="spiff-sdr-option" key={sdr.id}>
                <input
                  type="checkbox"
                  checked={(layer.sdrs || []).includes(sdr.full_name)}
                  onChange={() => toggleSdr(sdr.full_name)}
                />
                <span>{sdr.full_name}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="spiff-layer-field">
        <label>SPIFF Dollar Amount</label>
        <input
          type="number"
          min="0"
          step="1"
          value={layer.amount}
          onChange={e => update("amount", e.target.value)}
        />
      </div>
      <div className="spiff-layer-field">
        <label>Applied to</label>
        <select value={layer.appliesTo} onChange={e => update("appliesTo", e.target.value)}>
          <option value="sample">Per Sample</option>
          <option value="quote">Per Quote</option>
          <option value="bonus">Bonus</option>
        </select>
      </div>
      <div className="spiff-layer-field spiff-condition-cell">
        <label>Condition</label>
        <div className="spiff-condition-inputs">
          <select value={layer.conditionType} onChange={e => update("conditionType", e.target.value)}>
            <option value="none">No condition</option>
            <option value="first_to_samples">First reach X samples</option>
            <option value="quote_value_gt">Quote value greater than X</option>
          </select>
          {layer.conditionType !== "none" && (
            <input
              type="number"
              min="0"
              step="1"
              value={layer.conditionValue}
              onChange={e => update("conditionValue", e.target.value)}
              placeholder="X"
            />
          )}
        </div>
      </div>
      <div className="spiff-layer-remove">
        <label>&nbsp;</label>
        <button className="row-action-btn danger" onClick={onRemove} disabled={!canRemove}>Remove</button>
      </div>
    </div>
  );
}

function CommissionAmount({ row, setHoverReason }) {
  function showReason(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverReason({
      row,
      left: rect.left + rect.width / 2,
      top: rect.top - 8,
    });
  }

  return (
    <div className="spiff-money-wrap" onMouseEnter={showReason} onMouseLeave={() => setHoverReason(null)}>
      <span className="spiff-money">{money(row.payout_amount)}</span>
    </div>
  );
}

function ReasonCard({ data }) {
  const { row, left, top } = data;
  const sampleFormula = recordFormula(row.samples, 1);
  const quoteFormula = recordFormula(row.quotes, 3);
  return (
    <div className="spiff-reason-card" style={{ left, top }}>
      <div className="spiff-reason-title">Calculation</div>
      <div>
        <span className="sample-chip">Samples</span>
        <span> = $1 x {sampleFormula.baseCount}</span>
        {sampleFormula.spiffParts.map(part => (
          <span key={part.amount}> + <span className="spiff-dollar">SPIFF {money(part.amount)} x {part.count}</span></span>
        ))}
        <span> = </span>
        <span className="sample-dollar">{money(row.sample_payout || 0)}</span>
      </div>
      <div>
        <span className="quote-chip">Quotes</span>
        <span> = $3 x {quoteFormula.baseCount}</span>
        {quoteFormula.spiffParts.map(part => (
          <span key={part.amount}> + <span className="spiff-dollar">SPIFF {money(part.amount)} x {part.count}</span></span>
        ))}
        <span> = </span>
        <span className="quote-dollar">{money(row.quote_payout || 0)}</span>
      </div>
      {(row.spiff_payout || 0) > 0 && (
        <div>
          <span className="spiff-chip">Overall SPIFF</span>
          <span> = </span>
          <span className="spiff-dollar">{bonusBreakdown(row.spiff_bonus_details || [], row.spiff_payout)}</span>
        </div>
      )}
    </div>
  );
}

function RecordTable({ title, rows }) {
  return (
    <section className="spiff-record-section">
      <div className="spiff-table-title">{title}</div>
      {rows.length === 0 ? (
        <div className="spiff-empty">No {title.toLowerCase()} in this period.</div>
      ) : (
        <table className="data-table spiff-record-table">
          <thead>
            <tr>
              <th>Index</th>
              <th>Date</th>
              <th>Business Name</th>
              <th>Dollar Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td>{row.date || "No date"}</td>
                <td>{row.business_name}</td>
                <td className={row.spiff_applied ? "spiff-record-amount adjusted" : "spiff-record-amount"}>
                  {money(row.amount || 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
