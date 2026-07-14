import { createContext, useContext, useState, useEffect } from "react";

const AuthContext = createContext(null);

const TOKEN_KEY   = "portal_token";
const EXPIRY_KEY  = "portal_token_expiry";
const TTL_MS      = 24 * 60 * 60 * 1000; // 24 hours

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    const expiry = localStorage.getItem(EXPIRY_KEY);
    if (stored && expiry && Date.now() < parseInt(expiry, 10)) {
      setToken(stored);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EXPIRY_KEY);
    }
    setReady(true);
  }, []);

  function login(newToken) {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(EXPIRY_KEY, String(Date.now() + TTL_MS));
    setToken(newToken);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
    setToken(null);
  }

  return (
    <AuthContext.Provider value={{ token, authenticated: !!token, login, logout, ready }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
