const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

function getToken() {
  return localStorage.getItem("portal_token");
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });

  if (res.status === 401) {
    localStorage.removeItem("portal_token");
    localStorage.removeItem("portal_token_expiry");
    window.location.reload();
    return;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} failed (${res.status}): ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  auth: {
    login: (password) =>
      request("/auth/token", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
  },
  quotes: {
    list:   (status) => request(`/quotes${status ? `?status=${encodeURIComponent(status)}` : ""}`),
    create: (data)   => request("/quotes",       { method: "POST",  body: JSON.stringify(data) }),
    update: (id, data) => request(`/quotes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id)     => request(`/quotes/${id}`, { method: "DELETE" }),
  },
  pos: {
    list:   ()         => request("/pos"),
    create: (data)     => request("/pos",        { method: "POST",  body: JSON.stringify(data) }),
    update: (id, data) => request(`/pos/${id}`,  { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id)       => request(`/pos/${id}`,  { method: "DELETE" }),
  },
  accounts: {
    list:   ()         => request("/accounts"),
    create: (data)     => request("/accounts",        { method: "POST",  body: JSON.stringify(data) }),
    update: (id, data) => request(`/accounts/${id}`,  { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id)       => request(`/accounts/${id}`,  { method: "DELETE" }),
  },
  dashboard: {
    summary: () => request("/dashboard/summary"),
  },
  sdrPerformance: {
    periods: ()          => request("/sdr-performance/periods"),
    daily:   (dateStr)   => request(`/sdr-performance/daily/${dateStr}`),
    weekly:  (weekKey)   => request(`/sdr-performance/weekly/${weekKey}`),
    monthly: (monthKey)  => request(`/sdr-performance/monthly/${monthKey}`),
  },
  spiff: {
    monthly: (month) => request(`/spiff/mock/monthly/${month}`),
    preview: (data) => request("/spiff/mock/preview", { method: "POST", body: JSON.stringify(data) }),
    previewRules: (data) => request("/spiff/mock/preview-rules", { method: "POST", body: JSON.stringify(data) }),
    apply: (data) => request("/spiff/mock/apply", { method: "POST", body: JSON.stringify(data) }),
    campaigns: (month) => request(`/spiff/campaigns/${month}`),
    createCampaigns: (month, data) => request(`/spiff/campaigns/${month}`, { method: "POST", body: JSON.stringify(data) }),
    deleteCampaign: (id) => request(`/spiff/campaigns/${id}`, { method: "DELETE" }),
    clearCampaigns: (month) => request(`/spiff/campaigns/month/${month}`, { method: "DELETE" }),
  },
  samples: {
    list:   (params = {}) => {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ""));
      const s = qs.toString();
      return request(`/samples${s ? `?${s}` : ""}`);
    },
    get:      (id)         => request(`/samples/${id}`),
    create:   (data)       => request("/samples", { method: "POST", body: JSON.stringify(data) }),
    update:   (id, data)   => request(`/samples/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    changeStatus: (id, data) => request(`/samples/${id}/status`, { method: "POST", body: JSON.stringify(data) }),
    confirmAddress: (id, verifiedBy) => request(`/samples/${id}/confirm-address`, { method: "POST", body: JSON.stringify({ verified_by: verifiedBy }) }),
    events:   (id)         => request(`/samples/${id}/events`),
    batchStatus:  (ids, status, changedBy) => request("/samples/batch/status", { method: "POST", body: JSON.stringify({ ids, status, changed_by: changedBy }) }),
    batchArchive: (ids, changedBy)         => request("/samples/batch/archive", { method: "POST", body: JSON.stringify({ ids, changed_by: changedBy }) }),
    batchHubspotSync: (ids, changedBy)     => request("/samples/batch/hubspot-sync", { method: "POST", body: JSON.stringify({ ids, changed_by: changedBy }) }),
    batchVerifyAddresses: (ids, changedBy) => request("/samples/batch/address-verification", { method: "POST", body: JSON.stringify({ ids, changed_by: changedBy }) }),
    verifyAddress: (id)     => request(`/samples/${id}/verify-address`, { method: "POST" }),
  },
  brands: {
    list:   (includeInactive = true) => request(`/brands?include_inactive=${includeInactive}`),
    create: (data)     => request("/brands", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) => request(`/brands/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  },
  sdrs: {
    list: (includeInactive = true) => request(`/sdrs?include_inactive=${includeInactive}`),
    create: (data)     => request("/sdrs", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) => request(`/sdrs/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  },
  formFields: {
    list:   (includeInactive = false) => request(`/form-fields?include_inactive=${includeInactive}`),
    create: (data)     => request("/form-fields", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) => request(`/form-fields/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id)        => request(`/form-fields/${id}`, { method: "DELETE" }),
  },
};
