import { useEffect, useMemo, useRef, useState } from "react";
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

function monthLabel(month) {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function money(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysAgo(dateStr) {
  if (!dateStr) return "—";
  const then = new Date(dateStr);
  if (Number.isNaN(then.getTime())) return "—";
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  return days < 0 ? "—" : `${days}d`;
}

// Comma-grouped display for a currency input while still editing/typing —
// e.g. "10000" -> "10,000" — keeps the underlying stored value plain digits
// (no commas) so it parses cleanly as a number on submit.
function formatMoneyInput(value) {
  if (value === "" || value === null || value === undefined) return "";
  const [intPart, decPart] = String(value).split(".");
  const groupedInt = intPart === "" ? "" : Number(intPart).toLocaleString("en-US");
  return decPart !== undefined ? `${groupedInt}.${decPart}` : groupedInt;
}

function parseMoneyInput(value) {
  return value.replace(/,/g, "").replace(/[^0-9.]/g, "");
}

function bonusBreakdown(details = [], total = 0) {
  if (details.length > 0) return details.map(item => money(item.amount)).join(" + ");
  return money(total);
}

function recordFormula(records = []) {
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
    daily_leader_bonus: "Daily top SDR bonus",
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
  if (rule?.rule_type === "daily_leader_bonus") return `${money(rule.bonus_amount)} daily top SDR bonus`;
  return ruleLabel(rule);
}

function dailyLeaderTieText(rule) {
  return (rule?.tie_behavior || "").toLowerCase() === "rollover"
    ? " If there is a tie, that day's SPIFF rolls forward until one SDR clearly leads the accumulated tied window."
    : " Ties are broken by earliest last sample timestamp, then SDR name.";
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
  if (rule.rule_type === "daily_leader_bonus") {
    return `From ${rule.start_date} to ${rule.end_date}, each day the SDR with the most eligible samples gets ${money(rule.bonus_amount)}. The contest resets daily, so the same SDR can win again on another day.${dailyLeaderTieText(rule)}`;
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
  if (rule.rule_type === "daily_leader_bonus") {
    if ((rule.tie_behavior || "").toLowerCase() === "rollover") {
      return [
        `Monday ties, so Monday's ${money(rule.bonus_amount)} is unpaid and rolls forward.`,
        `Tuesday compares Monday+Tuesday totals; the clear leader gets ${money(rule.bonus_amount * 2)}.`,
      ];
    }
    return [
      `Monday: SDR A has 6 samples, SDR B has 4, so SDR A gets ${money(rule.bonus_amount)}.`,
      `Tuesday starts over; if SDR A is top again, SDR A gets another ${money(rule.bonus_amount)}.`,
    ];
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
    tiePolicy: "earliest_last_activity",
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
    eligible_statuses: ["requested", "sent", "delivered", "on_hold"],
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
  if (layer.conditionType === "daily_top_samples") {
    return {
      ...base,
      rule_type: "daily_leader_bonus",
      entity_type: "sample",
      threshold_entity_type: "sample",
      amount_per_sample: null,
      amount_per_quote: null,
      target_count: null,
      bonus_amount: amount,
      max_winners: 1,
      tie_behavior: layer.tiePolicy || "earliest_last_activity",
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
  const [detailTab, setDetailTab] = useState("samples");
  const [showDealModal, setShowDealModal] = useState(false);
  const [quotes, setQuotes] = useState([]);
  const [dealSaving, setDealSaving] = useState(false);
  const [dealError, setDealError] = useState("");
  const [dealSuccess, setDealSuccess] = useState("");
  const [deleteDealCandidate, setDeleteDealCandidate] = useState(null);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [meetingSaving, setMeetingSaving] = useState(false);
  const [meetingError, setMeetingError] = useState("");
  const [meetingSuccess, setMeetingSuccess] = useState("");
  const [deleteMeetingCandidate, setDeleteMeetingCandidate] = useState(null);
  const [showSickDayModal, setShowSickDayModal] = useState(false);
  const [sickDaySaving, setSickDaySaving] = useState(false);
  const [sickDayError, setSickDayError] = useState("");
  const [sickDaySuccess, setSickDaySuccess] = useState("");
  const [deleteSickDayCandidate, setDeleteSickDayCandidate] = useState(null);
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
  const [refreshTick, setRefreshTick] = useState(0);
  const [exporting, setExporting] = useState(false);

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
  }, [month, refreshTick]);

  useEffect(() => {
    api.sdrs.list(true)
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

  // Re-fetches the whole month's report (deals are folded into each SDR's
  // payout_amount server-side) and — unlike clearAppliedRule/deleteCampaign
  // above — keeps the detail modal open, updating just its row in place,
  // since adding/removing one deal is a much smaller-blast-radius action
  // than deleting a whole SPIFF rule.
  async function refreshReportKeepingDetailOpen() {
    const openSdrName = detailRow?.sdr_name;
    let result;
    if (isRuleApplied) {
      result = await api.spiff.apply({ month, rules: campaigns.map(campaign => campaign.rule) });
      setAppliedRuleReport(result);
    } else {
      result = await api.spiff.monthly(month);
      setDashboard(result);
    }
    if (openSdrName) {
      const updatedRow = (result.results || []).find(row => row.sdr_name === openSdrName);
      setDetailRow(updatedRow || null);
    }
  }

  async function openAddDeal() {
    setDealError("");
    setDealSuccess("");
    setShowDealModal(true);
    try {
      const list = await api.quotes.list();
      setQuotes(list || []);
    } catch (e) {
      setDealError(e.message);
    }
  }

  async function submitDeal(dealData) {
    const sdr = sdrOptions.find(s => s.full_name === detailRow?.sdr_name);
    if (!sdr) {
      setDealError("Could not find this SDR's record — try refreshing the page.");
      return;
    }
    setDealSaving(true);
    setDealError("");
    setDealSuccess("");
    try {
      await api.spiff.createDeal({ ...dealData, sdr_id: sdr.id, created_by: "admin" });
      await refreshReportKeepingDetailOpen();
      setDealSuccess(`Saved — ${dealData.business_name} added to ${detailRow?.sdr_name}'s deal commission.`);
    } catch (e) {
      setDealError(e.message);
    } finally {
      setDealSaving(false);
    }
  }

  function closeDealModal() {
    setShowDealModal(false);
    setDealError("");
    setDealSuccess("");
  }

  async function deleteDeal(dealId) {
    setLoading(true);
    setError("");
    try {
      await api.spiff.deleteDeal(dealId);
      setDeleteDealCandidate(null);
      await refreshReportKeepingDetailOpen();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function openAddMeeting() {
    setMeetingError("");
    setMeetingSuccess("");
    setShowMeetingModal(true);
    try {
      const list = await api.quotes.list();
      setQuotes(list || []);
    } catch (e) {
      setMeetingError(e.message);
    }
  }

  async function submitMeeting(meetingData) {
    const sdr = sdrOptions.find(s => s.full_name === detailRow?.sdr_name);
    if (!sdr) {
      setMeetingError("Could not find this SDR's record — try refreshing the page.");
      return;
    }
    setMeetingSaving(true);
    setMeetingError("");
    setMeetingSuccess("");
    try {
      await api.spiff.createMeeting({ ...meetingData, sdr_id: sdr.id, created_by: "admin" });
      await refreshReportKeepingDetailOpen();
      setMeetingSuccess(`Saved — ${meetingData.business_name} added to ${detailRow?.sdr_name}'s meetings.`);
    } catch (e) {
      setMeetingError(e.message);
    } finally {
      setMeetingSaving(false);
    }
  }

  function closeMeetingModal() {
    setShowMeetingModal(false);
    setMeetingError("");
    setMeetingSuccess("");
  }

  async function deleteMeeting(meetingId) {
    setLoading(true);
    setError("");
    try {
      await api.spiff.deleteMeeting(meetingId);
      setDeleteMeetingCandidate(null);
      await refreshReportKeepingDetailOpen();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function openAddSickDay() {
    setSickDayError("");
    setSickDaySuccess("");
    setShowSickDayModal(true);
  }

  async function submitSickDay(sickDayData) {
    const sdr = sdrOptions.find(s => s.full_name === detailRow?.sdr_name);
    if (!sdr) {
      setSickDayError("Could not find this SDR's record — try refreshing the page.");
      return;
    }
    setSickDaySaving(true);
    setSickDayError("");
    setSickDaySuccess("");
    try {
      await api.spiff.createSickDay({ ...sickDayData, sdr_id: sdr.id, created_by: "admin" });
      await refreshReportKeepingDetailOpen();
      setSickDaySuccess(`Saved — day off added for ${detailRow?.sdr_name}.`);
    } catch (e) {
      setSickDayError(e.message);
    } finally {
      setSickDaySaving(false);
    }
  }

  function closeSickDayModal() {
    setShowSickDayModal(false);
    setSickDayError("");
    setSickDaySuccess("");
  }

  async function deleteSickDay(sickDayId) {
    setLoading(true);
    setError("");
    try {
      await api.spiff.deleteSickDay(sickDayId);
      setDeleteSickDayCandidate(null);
      await refreshReportKeepingDetailOpen();
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

  async function handleExportExcel() {
    setExporting(true);
    setError("");
    try {
      await api.spiff.exportExcel(month);
    } catch (e) {
      setError(e.message || "Excel export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="spiff-page">
      <div className="page-header">
        <div>
          <p className="page-title">SDR Commission Dashboard</p>
          <p className="page-sub">Base: $1/Sample, $3/Quote</p>
        </div>
        <div className="page-header-actions">
          <MonthPicker value={month} onChange={setMonth} />
          <button className="btn-secondary" onClick={() => setRefreshTick(tick => tick + 1)} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
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
          <button className="btn-secondary" onClick={handleExportExcel} disabled={exporting}>
            {exporting ? "Exporting..." : "Export to Excel"}
          </button>
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
                      <button className="row-action-btn" onClick={() => { setDetailRow(row); setDetailTab("samples"); }}>View list</button>
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
                  Samples {money(detailRow.sample_payout || 0)} · Quotes {money(detailRow.quote_payout || 0)} · Meetings {money(detailRow.meeting_payout || 0)} · Deal {money(detailRow.deal_payout || 0)} · Bonus {money(detailRow.spiff_payout || 0)}
                </p>
              </div>
              <button className="modal-close" onClick={() => setDetailRow(null)}>x</button>
            </div>
            <div className="spiff-detail-tabs">
              <button className={detailTab === "samples" ? "active" : ""} onClick={() => setDetailTab("samples")}>
                Samples <span>{detailRow.eligible_sample_count || 0}</span>
              </button>
              <button className={detailTab === "quotes" ? "active" : ""} onClick={() => setDetailTab("quotes")}>
                Quotes <span>{detailRow.eligible_quote_count || 0}</span>
              </button>
              <button className={detailTab === "meetings" ? "active" : ""} onClick={() => setDetailTab("meetings")}>
                Meetings <span>{money(detailRow.meeting_payout || 0)}</span>
              </button>
              <button className={detailTab === "deals" ? "active" : ""} onClick={() => setDetailTab("deals")}>
                Deal Commission <span>{money(detailRow.deal_payout || 0)}</span>
              </button>
              <button className={detailTab === "sickdays" ? "active" : ""} onClick={() => setDetailTab("sickdays")}>
                Days Off <span>{(detailRow.sick_days || []).length}</span>
              </button>
              <button className={detailTab === "overall" ? "active" : ""} onClick={() => setDetailTab("overall")}>
                Bonus <span>{money(detailRow.spiff_payout || 0)}</span>
              </button>
            </div>
            <div className="modal-body spiff-detail-body">
              {detailTab === "samples" && <RecordGroups title="Samples" rows={detailRow.samples || []} total={detailRow.sample_payout || 0} />}
              {detailTab === "quotes" && <RecordGroups title="Quotes" rows={detailRow.quotes || []} total={detailRow.quote_payout || 0} />}
              {detailTab === "meetings" && (
                <MeetingSection
                  rows={detailRow.meetings || []}
                  total={detailRow.meeting_payout || 0}
                  onAdd={openAddMeeting}
                  onDelete={row => setDeleteMeetingCandidate(row)}
                />
              )}
              {detailTab === "deals" && (
                <DealCommissionSection
                  rows={detailRow.deals || []}
                  total={detailRow.deal_payout || 0}
                  onAdd={openAddDeal}
                  onDelete={row => setDeleteDealCandidate(row)}
                />
              )}
              {detailTab === "sickdays" && (
                <SickDaySection
                  rows={detailRow.sick_days || []}
                  onAdd={openAddSickDay}
                  onDelete={row => setDeleteSickDayCandidate(row)}
                />
              )}
              {detailTab === "overall" && <OverallSpiffTable rows={detailRow.spiff_bonus_details || []} total={detailRow.spiff_payout || 0} />}
            </div>
          </div>
        </div>
      )}

      {showDealModal && (
        <AddDealModal
          sdrName={detailRow?.sdr_name}
          quotes={quotes}
          saving={dealSaving}
          error={dealError}
          success={dealSuccess}
          onClose={closeDealModal}
          onSubmit={submitDeal}
          onDismissSuccess={() => setDealSuccess("")}
        />
      )}

      {deleteDealCandidate && (
        <div className="modal-overlay">
          <div className="modal-box spiff-confirm-modal">
            <div className="modal-header">
              <div>
                <p className="modal-title">Delete Deal Commission?</p>
                <p className="modal-subtitle">{deleteDealCandidate.business_name} — {money(deleteDealCandidate.amount || 0)}</p>
              </div>
              <button className="modal-close" onClick={() => setDeleteDealCandidate(null)}>x</button>
            </div>
            <div className="modal-body">
              <div className="spiff-empty">This removes the deal commission and recalculates this SDR's total for {month}.</div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setDeleteDealCandidate(null)}>Cancel</button>
              <button className="btn-primary" onClick={() => deleteDeal(deleteDealCandidate.id)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {showMeetingModal && (
        <AddMeetingModal
          sdrName={detailRow?.sdr_name}
          quotes={quotes}
          saving={meetingSaving}
          error={meetingError}
          success={meetingSuccess}
          onClose={closeMeetingModal}
          onSubmit={submitMeeting}
          onDismissSuccess={() => setMeetingSuccess("")}
        />
      )}

      {deleteMeetingCandidate && (
        <div className="modal-overlay">
          <div className="modal-box spiff-confirm-modal">
            <div className="modal-header">
              <div>
                <p className="modal-title">Delete Meeting?</p>
                <p className="modal-subtitle">{deleteMeetingCandidate.business_name} — {money(deleteMeetingCandidate.amount || 0)}</p>
              </div>
              <button className="modal-close" onClick={() => setDeleteMeetingCandidate(null)}>x</button>
            </div>
            <div className="modal-body">
              <div className="spiff-empty">This removes the meeting and recalculates this SDR's total for {month}.</div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setDeleteMeetingCandidate(null)}>Cancel</button>
              <button className="btn-primary" onClick={() => deleteMeeting(deleteMeetingCandidate.id)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {showSickDayModal && (
        <AddSickDayModal
          sdrName={detailRow?.sdr_name}
          saving={sickDaySaving}
          error={sickDayError}
          success={sickDaySuccess}
          onClose={closeSickDayModal}
          onSubmit={submitSickDay}
          onDismissSuccess={() => setSickDaySuccess("")}
        />
      )}

      {deleteSickDayCandidate && (
        <div className="modal-overlay">
          <div className="modal-box spiff-confirm-modal">
            <div className="modal-header">
              <div>
                <p className="modal-title">Delete Day Off?</p>
                <p className="modal-subtitle">
                  {deleteSickDayCandidate.start_date === deleteSickDayCandidate.end_date
                    ? deleteSickDayCandidate.start_date
                    : `${deleteSickDayCandidate.start_date} – ${deleteSickDayCandidate.end_date}`}
                </p>
              </div>
              <button className="modal-close" onClick={() => setDeleteSickDayCandidate(null)}>x</button>
            </div>
            <div className="modal-body">
              <div className="spiff-empty">This removes the day off record for {month}.</div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setDeleteSickDayCandidate(null)}>Cancel</button>
              <button className="btn-primary" onClick={() => deleteSickDay(deleteSickDayCandidate.id)}>Delete</button>
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
            <option value="daily_top_samples">Top SDR each day by samples</option>
            <option value="quote_value_gt">Quote value greater than X</option>
          </select>
          {layer.conditionType !== "none" && layer.conditionType !== "daily_top_samples" && (
            <input
              type="number"
              min="0"
              step="1"
              value={layer.conditionValue}
              onChange={e => update("conditionValue", e.target.value)}
              placeholder="X"
            />
          )}
          {layer.conditionType === "daily_top_samples" && (
            <select value={layer.tiePolicy || "earliest_last_activity"} onChange={e => update("tiePolicy", e.target.value)}>
              <option value="earliest_last_activity">Tie: earliest last sample wins</option>
              <option value="rollover">Tie: roll over to next day</option>
            </select>
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

function MonthPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => Number(value.slice(0, 4)));
  const wrapRef = useRef(null);
  const selectedYear = Number(value.slice(0, 4));
  const selectedMonth = Number(value.slice(5, 7));
  const months = Array.from({ length: 12 }, (_, i) => ({
    number: i + 1,
    label: new Date(viewYear, i, 1).toLocaleDateString("en-US", { month: "short" }),
  }));

  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    setViewYear(Number(value.slice(0, 4)));
  }, [value]);

  function selectMonth(monthNumber) {
    onChange(`${viewYear}-${String(monthNumber).padStart(2, "0")}`);
    setOpen(false);
  }

  return (
    <div className="spiff-month-picker" ref={wrapRef}>
      <button type="button" className="spiff-month-button" onClick={() => setOpen(current => !current)}>
        <span>{monthLabel(value)}</span>
        <span className="spiff-month-caret">▾</span>
      </button>
      {open && (
        <div className="spiff-month-panel">
          <div className="spiff-month-panel-header">
            <button type="button" className="spiff-month-nav" onClick={() => setViewYear(year => year - 1)}>‹</button>
            <span>{viewYear}</span>
            <button type="button" className="spiff-month-nav" onClick={() => setViewYear(year => year + 1)}>›</button>
          </div>
          <div className="spiff-month-grid">
            {months.map(month => {
              const active = viewYear === selectedYear && month.number === selectedMonth;
              return (
                <button
                  type="button"
                  key={month.number}
                  className={`spiff-month-option ${active ? "active" : ""}`}
                  onClick={() => selectMonth(month.number)}
                >
                  {month.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
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
  const sampleFormula = recordFormula(row.samples);
  const quoteFormula = recordFormula(row.quotes);
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
      {(row.deal_payout || 0) > 0 && (
        <div>
          <span className="quote-chip">Deal Commission</span>
          <span> = </span>
          <span className="quote-dollar">{money(row.deal_payout || 0)}</span>
        </div>
      )}
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

function groupRecordRows(rows, title) {
  const groups = new Map();
  rows.forEach(row => {
    const campaigns = row.spiff_campaigns?.length
      ? row.spiff_campaigns.map(campaign => ruleGroupTitle(campaign.name || "SPIFF Rule", campaign))
      : [row.spiff_applied ? "SPIFF adjusted records" : `Base Commission · ${title === "Quotes" ? "$3/quote" : "$1/sample"}`];
    campaigns.forEach(name => {
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(row);
    });
  });
  return Array.from(groups, ([name, groupedRows]) => ({ name, rows: groupedRows }));
}

function ruleGroupTitle(name, rule = {}) {
  const start = rule.start_date || rule.date;
  const end = rule.end_date;
  const cleanName = stripDateFromRuleName(name);
  if (start && end && start !== end) return `${cleanName} · ${start} to ${end}`;
  if (start) return `${cleanName} · ${start}`;
  return cleanName;
}

function stripDateFromRuleName(name = "") {
  return String(name)
    .replace(/\s*(?:on\s+)?[A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{4}\s*$/i, "")
    .replace(/\s*\(?\d{4}-\d{2}-\d{2}\)?\s*$/i, "")
    .trim();
}

function RecordGroups({ title, rows, total }) {
  const groups = groupRecordRows(rows, title);
  return (
    <section className="spiff-record-section">
      <div className="spiff-section-heading">
        <span>{title}</span>
        <strong>{money(total)}</strong>
      </div>
      {rows.length === 0 ? (
        <div className="spiff-empty">No {title.toLowerCase()} in this period.</div>
      ) : (
        <div className="spiff-record-groups">
          {groups.map(group => (
            <div className="spiff-record-group" key={group.name}>
              <div className="spiff-record-group-title">
                <span>{group.name}</span>
                <strong>{money(group.rows.reduce((sum, row) => sum + Number(row.amount || 0), 0))}</strong>
              </div>
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
                  {group.rows.map((row, index) => (
                    <tr key={`${group.name}-${row.id}`}>
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
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function OverallSpiffTable({ rows, total }) {
  const groups = groupOverallSpiffRows(rows);
  return (
    <section className="spiff-record-section">
      <div className="spiff-section-heading">
        <span>Bonus</span>
        <strong>{money(total)}</strong>
      </div>
      {rows.length === 0 ? (
        <div className="spiff-empty">No bonuses in this period.</div>
      ) : (
        <div className="spiff-record-groups">
          {groups.map(group => (
            <div className="spiff-record-group" key={group.name}>
              <div className="spiff-record-group-title">
                <span>{group.name}</span>
                <strong>{money(group.rows.reduce((sum, row) => sum + Number(row.amount || 0), 0))}</strong>
              </div>
              <table className="data-table spiff-record-table spiff-overall-table">
                <thead>
                  <tr>
                    <th>Index</th>
                    <th>Reason</th>
                    <th>Dollar Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row, index) => (
                    <tr key={`${group.name}-${index}`}>
                      <td>{index + 1}</td>
                      <td>{overallSpiffReason(row, group.name)}</td>
                      <td className="spiff-record-amount adjusted">{money(row.amount || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DealCommissionSection({ rows, total, onAdd, onDelete }) {
  return (
    <section className="spiff-record-section">
      <div className="spiff-section-heading">
        <span>Deal Commission</span>
        <strong>{money(total)}</strong>
      </div>
      <div className="spiff-deal-add-row">
        <button className="btn-primary" onClick={onAdd}>Add Deal Commission</button>
      </div>
      {rows.length === 0 ? (
        <div className="spiff-empty">No deal commission in this period.</div>
      ) : (
        <table className="data-table spiff-record-table spiff-deal-table">
          <thead>
            <tr>
              <th>Index</th>
              <th>Date</th>
              <th>Business Name</th>
              <th>Deal Value</th>
              <th>Commission %</th>
              <th>Commission $</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td>{row.date || "No date"}</td>
                <td>{row.business_name}</td>
                <td>{money(row.deal_value || 0)}</td>
                <td>{Number(row.commission_pct || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}%</td>
                <td className="spiff-record-amount">{money(row.amount || 0)}</td>
                <td><button className="row-action-btn danger" onClick={() => onDelete(row)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AddDealModal({ sdrName, quotes, saving, error, success, onClose, onSubmit, onDismissSuccess }) {
  const [mode, setMode] = useState("choose");
  const [quoteSearch, setQuoteSearch] = useState("");
  const [selectedQuoteId, setSelectedQuoteId] = useState(null);
  const [businessName, setBusinessName] = useState("");
  const [dealDate, setDealDate] = useState(new Date().toISOString().slice(0, 10));
  const [dealValue, setDealValue] = useState("");
  const [commissionPct, setCommissionPct] = useState("");
  const [formError, setFormError] = useState("");

  function resetForAnother() {
    setMode("choose");
    setQuoteSearch("");
    setSelectedQuoteId(null);
    setBusinessName("");
    setDealDate(new Date().toISOString().slice(0, 10));
    setDealValue("");
    setCommissionPct("");
    setFormError("");
    onDismissSuccess();
  }

  const sdrQuotes = useMemo(
    () => quotes.filter(q => q.associated_sdr === sdrName),
    [quotes, sdrName]
  );
  const filteredQuotes = useMemo(() => {
    const term = quoteSearch.trim().toLowerCase();
    if (!term) return sdrQuotes;
    return sdrQuotes.filter(q => q.business_name.toLowerCase().includes(term));
  }, [sdrQuotes, quoteSearch]);

  const commissionAmount = (Number(dealValue) || 0) * (Number(commissionPct) || 0) / 100;
  const showForm = mode === "new" || (mode === "choose" && selectedQuoteId);

  function chooseQuote(quote) {
    setSelectedQuoteId(quote.id);
    setBusinessName(quote.business_name);
    setDealValue(String(quote.quote_value || 0));
    if (quote.date_requested) setDealDate(quote.date_requested.slice(0, 10));
  }

  function backToQuoteList() {
    setSelectedQuoteId(null);
  }

  function handleSubmit(e) {
    e.preventDefault();
    setFormError("");
    if (!businessName.trim()) { setFormError("Business name is required."); return; }
    if (!dealDate) { setFormError("Deal date is required."); return; }
    if (!dealValue || Number(dealValue) <= 0) { setFormError("Deal value must be greater than 0."); return; }
    if (!commissionPct || Number(commissionPct) <= 0) { setFormError("Commission % must be greater than 0."); return; }
    onSubmit({
      business_name: businessName.trim(),
      deal_date: dealDate,
      deal_value: Number(dealValue),
      commission_pct: Number(commissionPct),
      source_quote_id: mode === "choose" ? selectedQuoteId : null,
    });
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box spiff-rule-modal">
        <div className="modal-header">
          <div>
            <p className="modal-title">Add Deal Commission</p>
            <p className="modal-subtitle">{sdrName}</p>
          </div>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>
        <div className="modal-body">
          {success ? (
            <>
              <div className="success-banner">{success}</div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={resetForAnother}>Add another</button>
                <button type="button" className="btn-primary" onClick={onClose}>Done</button>
              </div>
            </>
          ) : (
          <>
          {(error || formError) && <div className="error-banner">{error || formError}</div>}
          <div className="spiff-tabs">
            <button className={mode === "choose" ? "active" : ""} onClick={() => { setMode("choose"); setSelectedQuoteId(null); }}>
              Choose Existing Quote
            </button>
            <button className={mode === "new" ? "active" : ""} onClick={() => { setMode("new"); setSelectedQuoteId(null); setBusinessName(""); setDealValue(""); }}>
              Create New Deal
            </button>
          </div>

          {mode === "choose" && !selectedQuoteId && (
            <>
              <div className="form-field">
                <label>Search {sdrName}'s quotes</label>
                <input value={quoteSearch} onChange={e => setQuoteSearch(e.target.value)} placeholder="Business name…" />
              </div>
              {filteredQuotes.length === 0 ? (
                <div className="spiff-empty">No quotes found for {sdrName}.</div>
              ) : (
                <table className="data-table spiff-quote-picker-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Days Ago</th>
                      <th>Business Name</th>
                      <th>Value</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredQuotes.map(quote => (
                      <tr key={quote.id}>
                        <td>{quote.date_requested ? quote.date_requested.slice(0, 10) : "No date"}</td>
                        <td>{daysAgo(quote.date_requested)}</td>
                        <td>{quote.business_name}</td>
                        <td>{money(quote.quote_value || 0)}</td>
                        <td><button className="row-action-btn" onClick={() => chooseQuote(quote)}>Select</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {showForm && (
            <form onSubmit={handleSubmit}>
              {mode === "choose" && (
                <button type="button" className="row-action-btn" onClick={backToQuoteList} style={{ marginBottom: 12 }}>
                  ← Back to quote list
                </button>
              )}
              <div className="spiff-form-grid">
                <div className="form-field">
                  <label>Deal Date</label>
                  <input type="date" value={dealDate} onChange={e => setDealDate(e.target.value)} />
                </div>
                <div className="form-field">
                  <label>SDR</label>
                  <input value={sdrName || ""} disabled />
                </div>
                <div className="form-field">
                  <label>Business Name</label>
                  <input value={businessName} onChange={e => setBusinessName(e.target.value)} disabled={mode === "choose"} />
                </div>
                <div className="form-field">
                  <label>Deal Value</label>
                  <div className="input-affix input-affix-prefix">
                    <span className="input-affix-symbol">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatMoneyInput(dealValue)}
                      onChange={e => setDealValue(parseMoneyInput(e.target.value))}
                      disabled={mode === "choose"}
                    />
                  </div>
                </div>
                <div className="form-field">
                  <label>Commission %</label>
                  <div className="input-affix input-affix-suffix">
                    <input type="number" min="0" step="0.01" value={commissionPct} onChange={e => setCommissionPct(e.target.value)} />
                    <span className="input-affix-symbol">%</span>
                  </div>
                </div>
                <div className="form-field">
                  <label>Commission $</label>
                  <input value={money(commissionAmount)} disabled />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Add Deal Commission"}</button>
              </div>
            </form>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}

function MeetingSection({ rows, total, onAdd, onDelete }) {
  return (
    <section className="spiff-record-section">
      <div className="spiff-section-heading">
        <span>Meetings</span>
        <strong>{money(total)}</strong>
      </div>
      <div className="spiff-deal-add-row">
        <button className="btn-primary" onClick={onAdd}>Add Meeting</button>
      </div>
      {rows.length === 0 ? (
        <div className="spiff-empty">No meetings in this period.</div>
      ) : (
        <table className="data-table spiff-record-table spiff-meeting-table">
          <thead>
            <tr>
              <th>Index</th>
              <th>Date</th>
              <th>Business Name</th>
              <th>Source</th>
              <th>Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td>{row.date || "No date"}</td>
                <td>{row.business_name}</td>
                <td>{row.source_quote_id ? "Quote-Linked" : "Manual"}</td>
                <td className="spiff-record-amount">{money(row.amount || 0)}</td>
                <td><button className="row-action-btn danger" onClick={() => onDelete(row)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AddMeetingModal({ sdrName, quotes, saving, error, success, onClose, onSubmit, onDismissSuccess }) {
  const [mode, setMode] = useState("choose");
  const [quoteSearch, setQuoteSearch] = useState("");
  const [selectedQuoteId, setSelectedQuoteId] = useState(null);
  const [businessName, setBusinessName] = useState("");
  const [meetingDate, setMeetingDate] = useState(new Date().toISOString().slice(0, 10));
  const [formError, setFormError] = useState("");

  function resetForAnother() {
    setMode("choose");
    setQuoteSearch("");
    setSelectedQuoteId(null);
    setBusinessName("");
    setMeetingDate(new Date().toISOString().slice(0, 10));
    setFormError("");
    onDismissSuccess();
  }

  const sdrQuotes = useMemo(
    () => quotes.filter(q => q.associated_sdr === sdrName),
    [quotes, sdrName]
  );
  const filteredQuotes = useMemo(() => {
    const term = quoteSearch.trim().toLowerCase();
    if (!term) return sdrQuotes;
    return sdrQuotes.filter(q => q.business_name.toLowerCase().includes(term));
  }, [sdrQuotes, quoteSearch]);

  const showForm = mode === "new" || (mode === "choose" && selectedQuoteId);

  function chooseQuote(quote) {
    setSelectedQuoteId(quote.id);
    setBusinessName(quote.business_name);
    if (quote.date_requested) setMeetingDate(quote.date_requested.slice(0, 10));
  }

  function backToQuoteList() {
    setSelectedQuoteId(null);
  }

  function handleSubmit(e) {
    e.preventDefault();
    setFormError("");
    if (!businessName.trim()) { setFormError("Business name is required."); return; }
    if (!meetingDate) { setFormError("Meeting date is required."); return; }
    onSubmit({
      business_name: businessName.trim(),
      meeting_date: meetingDate,
      source_quote_id: mode === "choose" ? selectedQuoteId : null,
    });
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box spiff-rule-modal">
        <div className="modal-header">
          <div>
            <p className="modal-title">Add Meeting</p>
            <p className="modal-subtitle">{sdrName}</p>
          </div>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>
        <div className="modal-body">
          {success ? (
            <>
              <div className="success-banner">{success}</div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={resetForAnother}>Add another</button>
                <button type="button" className="btn-primary" onClick={onClose}>Done</button>
              </div>
            </>
          ) : (
          <>
          {(error || formError) && <div className="error-banner">{error || formError}</div>}
          <div className="spiff-tabs">
            <button className={mode === "choose" ? "active" : ""} onClick={() => { setMode("choose"); setSelectedQuoteId(null); }}>
              Choose Existing Quote
            </button>
            <button className={mode === "new" ? "active" : ""} onClick={() => { setMode("new"); setSelectedQuoteId(null); setBusinessName(""); }}>
              Create New Meeting
            </button>
          </div>

          {mode === "choose" && !selectedQuoteId && (
            <>
              <div className="form-field">
                <label>Search {sdrName}'s quotes</label>
                <input value={quoteSearch} onChange={e => setQuoteSearch(e.target.value)} placeholder="Business name…" />
              </div>
              {filteredQuotes.length === 0 ? (
                <div className="spiff-empty">No quotes found for {sdrName}.</div>
              ) : (
                <table className="data-table spiff-quote-picker-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Days Ago</th>
                      <th>Business Name</th>
                      <th>Value</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredQuotes.map(quote => (
                      <tr key={quote.id}>
                        <td>{quote.date_requested ? quote.date_requested.slice(0, 10) : "No date"}</td>
                        <td>{daysAgo(quote.date_requested)}</td>
                        <td>{quote.business_name}</td>
                        <td>{money(quote.quote_value || 0)}</td>
                        <td><button className="row-action-btn" onClick={() => chooseQuote(quote)}>Select</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {showForm && (
            <form onSubmit={handleSubmit}>
              {mode === "choose" && (
                <button type="button" className="row-action-btn" onClick={backToQuoteList} style={{ marginBottom: 12 }}>
                  ← Back to quote list
                </button>
              )}
              <div className="spiff-form-grid">
                <div className="form-field">
                  <label>Meeting Date</label>
                  <input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)} />
                </div>
                <div className="form-field">
                  <label>SDR</label>
                  <input value={sdrName || ""} disabled />
                </div>
                <div className="form-field">
                  <label>Business Name</label>
                  <input value={businessName} onChange={e => setBusinessName(e.target.value)} disabled={mode === "choose"} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Add Meeting"}</button>
              </div>
            </form>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}

function SickDaySection({ rows, onAdd, onDelete }) {
  return (
    <section className="spiff-record-section">
      <div className="spiff-section-heading">
        <span>Days Off</span>
        <strong>{rows.length}</strong>
      </div>
      <div className="spiff-deal-add-row">
        <button className="btn-primary" onClick={onAdd}>Add Day Off</button>
      </div>
      {rows.length === 0 ? (
        <div className="spiff-empty">No days off in this period.</div>
      ) : (
        <table className="data-table spiff-record-table spiff-sickday-table">
          <thead>
            <tr>
              <th>Index</th>
              <th>Start Date</th>
              <th>End Date</th>
              <th>Reason</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td>{row.start_date || "No date"}</td>
                <td>{row.end_date || "No date"}</td>
                <td>{row.reason_note || "—"}</td>
                <td><button className="row-action-btn danger" onClick={() => onDelete(row)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function isoDate(year, month, day) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

// Single-day-or-range calendar for picking sick day(s). Class-based grid
// (cal-header/cal-grid/cal-day, mirroring PeriodPicker's CalendarPanel) for
// easy theming, combined with DateFilterCalendar's mode-toggle + two-click
// range-draft interaction — minus its "only dates with data" gating, since
// any day should be pickable for a sick day.
function SickDayCalendar({ range, onRangeChange }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [mode, setMode] = useState(range.start && range.start !== range.end ? "range" : "single");
  const [draftStart, setDraftStart] = useState(null);

  const monthLabelText = new Date(viewYear, viewMonth, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const startWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);

  function goMonth(delta) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setViewMonth(m);
    setViewYear(y);
  }

  function handleDayClick(day) {
    const iso = isoDate(viewYear, viewMonth, day);
    if (mode === "single") {
      onRangeChange({ start: iso, end: iso });
      setDraftStart(null);
      return;
    }
    if (!draftStart) {
      setDraftStart(iso);
      onRangeChange({ start: iso, end: "" });
      return;
    }
    const [from, to] = iso < draftStart ? [iso, draftStart] : [draftStart, iso];
    onRangeChange({ start: from, end: to });
    setDraftStart(null);
  }

  function isInRange(iso) {
    if (!range.start) return false;
    const end = range.end || draftStart || range.start;
    const [from, to] = end < range.start ? [end, range.start] : [range.start, end];
    return iso >= from && iso <= to;
  }

  return (
    <div className="spiff-sickday-calendar">
      <div className="spiff-sickday-mode-toggle">
        <button
          type="button"
          className={mode === "single" ? "active" : ""}
          onClick={() => { setMode("single"); setDraftStart(null); }}
        >
          Single Day
        </button>
        <button
          type="button"
          className={mode === "range" ? "active" : ""}
          onClick={() => { setMode("range"); setDraftStart(null); }}
        >
          Date Range
        </button>
      </div>
      <div className="cal-header">
        <button type="button" className="cal-nav-btn" onClick={() => goMonth(-1)}>‹</button>
        <span className="cal-header-label">{monthLabelText}</span>
        <button type="button" className="cal-nav-btn" onClick={() => goMonth(1)}>›</button>
      </div>
      <div className="cal-grid">
        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => <div className="cal-weekday" key={`${w}${i}`}>{w}</div>)}
        {cells.map((day, i) => {
          if (day === null) return <div className="cal-day blank" key={`b${i}`} />;
          const iso = isoDate(viewYear, viewMonth, day);
          const inRange = isInRange(iso);
          const isEndpoint = iso === range.start || iso === range.end;
          const cls = `cal-day${inRange ? " in-range" : ""}${isEndpoint ? " active" : ""}`;
          return (
            <div key={iso} className={cls} onClick={() => handleDayClick(day)}>
              {day}
            </div>
          );
        })}
      </div>
      <div className="spiff-sickday-range-label">
        {range.start
          ? (range.end && range.end !== range.start ? `${range.start} – ${range.end}` : range.start)
          : "No date selected"}
      </div>
    </div>
  );
}

function AddSickDayModal({ sdrName, saving, error, success, onClose, onSubmit, onDismissSuccess }) {
  const today = new Date().toISOString().slice(0, 10);
  const [range, setRange] = useState({ start: today, end: today });
  const [reasonNote, setReasonNote] = useState("");
  const [formError, setFormError] = useState("");

  function resetForAnother() {
    setRange({ start: today, end: today });
    setReasonNote("");
    setFormError("");
    onDismissSuccess();
  }

  function handleSubmit(e) {
    e.preventDefault();
    setFormError("");
    if (!range.start) { setFormError("Please select a date."); return; }
    onSubmit({
      start_date: range.start,
      end_date: range.end || range.start,
      reason_note: reasonNote.trim(),
    });
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box spiff-rule-modal">
        <div className="modal-header">
          <div>
            <p className="modal-title">Add Day Off</p>
            <p className="modal-subtitle">{sdrName}</p>
          </div>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>
        <div className="modal-body">
          {success ? (
            <>
              <div className="success-banner">{success}</div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={resetForAnother}>Add another</button>
                <button type="button" className="btn-primary" onClick={onClose}>Done</button>
              </div>
            </>
          ) : (
          <form onSubmit={handleSubmit}>
            {(error || formError) && <div className="error-banner">{error || formError}</div>}
            <SickDayCalendar range={range} onRangeChange={setRange} />
            <div className="form-field">
              <label>Reason Note</label>
              <textarea value={reasonNote} onChange={e => setReasonNote(e.target.value)} rows={3} placeholder="Optional note…" />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Add Day Off"}</button>
            </div>
          </form>
          )}
        </div>
      </div>
    </div>
  );
}

function groupOverallSpiffRows(rows) {
  const groups = new Map();
  rows.forEach(row => {
    const name = ruleGroupTitle(row.name || "Bonus", row);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  });
  return Array.from(groups, ([name, groupedRows]) => ({ name, rows: groupedRows }));
}

function overallSpiffReason(row, groupName) {
  const cleanName = stripDateFromRuleName(row.name || "");
  const cleanGroup = stripDateFromRuleName(groupName || "");
  if (row.reason && stripDateFromRuleName(row.reason) !== cleanGroup) return row.reason;
  if (row.start_date || row.end_date || row.date) return "Bonus applied for this window";
  if (cleanName && cleanName !== cleanGroup) return cleanName;
  return "Bonus applied";
}
