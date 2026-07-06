import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import "./LoginPage.css";

export default function LoginPage() {
  const { login } = useAuth();
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState(null);
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.auth.login(password);
      login(res.access_token);
    } catch {
      setError("Incorrect password. Try again.");
      setPassword("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <img src="/Schneider-Direct.png" alt="Schneider Direct" />
        </div>

        <h1 className="login-title">Quote portal</h1>
        <p className="login-sub">Enter the team password to continue.</p>

        {error && (
          <div className="login-error">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="login-field">
            <label htmlFor="password">Password</label>
            <div className="login-input-wrap">
              <input
                id="password"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter team password"
                autoComplete="current-password"
                autoFocus
              />
              <button
                type="button"
                className="login-toggle-pw"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button type="submit" className="login-btn" disabled={loading || !password}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="login-footer-rule" />
        <p className="login-footer">
          Access is restricted to the Schneider Direct marketing team.
          Your session expires after 24 hours.
        </p>
      </div>

      <p className="login-copyright">Schneider Direct © 2026</p>
    </div>
  );
}
