import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { createElement, type ReactNode } from 'react';
import { apiFetch } from '../lib/apiClient';

// ── Types ───────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  orgId: string;
}

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<void>;
}

// ── Keys ────────────────────────────────────────────────────────────────────

const TOKEN_KEY = 'qatrial:token';
const REFRESH_KEY = 'qatrial:refresh-token';

function getTokenOrgId(token: string): string | null | undefined {
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as { orgId?: unknown };
    return typeof decoded.orgId === 'string' || decoded.orgId === null ? decoded.orgId : undefined;
  } catch {
    return undefined;
  }
}

// ── Context ─────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthState | null>(null);

// ── Provider ────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  // Do not expose a stored access token before it is validated. Rendering the
  // shell during this gap was what allowed the auth/UI flip-flop.
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isAuthenticated = !!user && !!token;

  // Persist / clear tokens in localStorage
  const storeTokens = useCallback((accessToken: string, refreshToken: string) => {
    localStorage.setItem(TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_KEY, refreshToken);
    setToken(accessToken);
  }, []);

  const clearTokens = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const tokenMatchesUser = useCallback((accessToken: string, authenticatedUser: AuthUser) => {
    const tokenOrgId = getTokenOrgId(accessToken);
    return tokenOrgId !== undefined && tokenOrgId === authenticatedUser.orgId;
  }, []);

  // ── Refresh ─────────────────────────────────────────────────────────────

  const doRefresh = useCallback(async () => {
    const rt = localStorage.getItem(REFRESH_KEY);
    if (!rt) throw new Error('No refresh token');

    const res = await apiFetch<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: rt }),
    });

    storeTokens(res.accessToken, res.refreshToken);
    return res.accessToken;
  }, [storeTokens]);

  // ── Validate existing token on mount ────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const storedToken = localStorage.getItem(TOKEN_KEY);
      if (!storedToken) {
        if (!cancelled) setIsLoading(false);
        return;
      }

      try {
        const res = await apiFetch<{ user: AuthUser }>('/auth/me');
        if (!tokenMatchesUser(storedToken, res.user)) {
          if (!cancelled) clearTokens();
          return;
        }
        if (!cancelled) {
          setToken(storedToken);
          setUser(res.user);
        }
      } catch {
        // One refresh attempt is allowed for an expired token. If it cannot
        // establish a consistent identity, logout is terminal until login.
        try {
          const refreshedToken = await doRefresh();
          const res = await apiFetch<{ user: AuthUser }>('/auth/me');
          if (!tokenMatchesUser(refreshedToken, res.user)) {
            if (!cancelled) clearTokens();
            return;
          }
          if (!cancelled) {
            setToken(refreshedToken);
            setUser(res.user);
          }
        } catch {
          // Clear once and remain logged out. This effect does not retry after
          // logout, so an invalid/stale JWT cannot create an auth loop.
          if (!cancelled) {
            clearTokens();
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    boot();
    return () => { cancelled = true; };
  }, [clearTokens, doRefresh, tokenMatchesUser]);

  // ── Login ───────────────────────────────────────────────────────────────

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch<{
      user: AuthUser;
      accessToken: string;
      refreshToken: string;
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    storeTokens(res.accessToken, res.refreshToken);
    setUser(res.user);
  }, [storeTokens]);

  // ── Register ────────────────────────────────────────────────────────────

  const register = useCallback(async (email: string, password: string, name: string) => {
    const res = await apiFetch<{
      user: AuthUser;
      accessToken: string;
      refreshToken: string;
    }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });

    storeTokens(res.accessToken, res.refreshToken);
    setUser(res.user);
  }, [storeTokens]);

  // ── Logout ──────────────────────────────────────────────────────────────

  const logout = useCallback(() => {
    clearTokens();
  }, [clearTokens]);

  // ── Refresh (public) ────────────────────────────────────────────────────

  const refreshTokenFn = useCallback(async () => {
    const refreshedToken = await doRefresh();
    const res = await apiFetch<{ user: AuthUser }>('/auth/me');
    if (!tokenMatchesUser(refreshedToken, res.user)) {
      clearTokens();
      throw new Error('Session no longer matches your organization');
    }
    setUser(res.user);
  }, [clearTokens, doRefresh, tokenMatchesUser]);

  // ── Value ───────────────────────────────────────────────────────────────

  const value = useMemo<AuthState>(
    () => ({
      user,
      token,
      isAuthenticated,
      isLoading,
      login,
      register,
      logout,
      refreshToken: refreshTokenFn,
    }),
    [user, token, isAuthenticated, isLoading, login, register, logout, refreshTokenFn],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
