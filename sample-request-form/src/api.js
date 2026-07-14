const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

// Deliberately a different localStorage key than the admin app's "portal_token" —
// this is a separate frontend project with its own auth, and even if somehow
// loaded in the same browser as the admin app, the two tokens must never collide.
const TOKEN_KEY = "sdr_form_token";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function hasToken() {
  return !!getToken();
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
    clearToken();
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
  login: (code) => request("/public/sdr-login", { method: "POST", body: JSON.stringify({ code }) }),
  sdrs: () => request("/public/sdrs"),
  formFields: () => request("/public/form-fields"),
  submit: (data) => request("/public/samples/submit", { method: "POST", body: JSON.stringify(data) }),
};
