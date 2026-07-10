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
    throw new Error(`${res.status}: ${text}`);
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
};
