import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createElement, type ReactNode } from 'react';
import { apiFetch } from '../lib/apiClient';

const AUTH_BOOT_TIMEOUT_MS = 10_000;

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
  bootError: string | null;
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
  const sessionGeneration = useRef(0);
  const [user, setUser] = useState<AuthUser | null>(null);
  // Do not expose a stored access token before it is validated. Rendering the
  // shell during this gap was what allowed the auth/UI flip-flop.
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);

  const isAuthenticated = !!user && !!token;

  // Persist / clear tokens in localStorage
  const storeTokens = useCallback((accessToken: string, refreshToken: string) => {
    localStorage.setItem(TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_KEY, refreshToken);
    setToken(accessToken);
  }, []);

  const clearTokens = useCallback(() => {
    sessionGeneration.current += 1;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    setToken(null);
    setUser(null);
    setIsLoading(false);
    setBootError(null);
  }, []);

  const tokenMatchesUser = useCallback((accessToken: string, authenticatedUser: AuthUser) => {
    const tokenOrgId = getTokenOrgId(accessToken);
    return tokenOrgId !== undefined && tokenOrgId === authenticatedUser.orgId;
  }, []);

  // ── Refresh ─────────────────────────────────────────────────────────────

  const doRefresh = useCallback(async (signal?: AbortSignal) => {
    const rt = localStorage.getItem(REFRESH_KEY);
    if (!rt) throw new Error('No refresh token');

    const res = await apiFetch<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: rt }),
      signal,
    });

    return res;
  }, []);

  // ── Validate existing token on mount ────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    const generation = sessionGeneration.current;
    const isCurrent = () => !cancelled && generation === sessionGeneration.current;
    const bootController = new AbortController();
    let timedOut = false;
    const bootTimer = window.setTimeout(() => {
      timedOut = true;
      bootController.abort();
    }, AUTH_BOOT_TIMEOUT_MS);

    async function boot() {
      const storedToken = localStorage.getItem(TOKEN_KEY);
      if (!storedToken) {
        window.clearTimeout(bootTimer);
        if (isCurrent()) setIsLoading(false);
        return;
      }

      try {
        const res = await apiFetch<{ user: AuthUser }>('/auth/me', { signal: bootController.signal });
        if (!tokenMatchesUser(storedToken, res.user)) {
          if (isCurrent()) clearTokens();
          return;
        }
        if (isCurrent()) {
          setToken(storedToken);
          setUser(res.user);
        }
      } catch {
        if (!isCurrent()) return;
        if (timedOut) {
          setBootError('Sign-in verification timed out after 10 seconds.');
          return;
        }
        // One refresh attempt is allowed for an expired token. If it cannot
        // establish a consistent identity, logout is terminal until login.
        try {
          const refreshed = await doRefresh(bootController.signal);
          if (!isCurrent()) return;
          const res = await apiFetch<{ user: AuthUser }>('/auth/me', {
            signal: bootController.signal,
            headers: { Authorization: `Bearer ${refreshed.accessToken}` },
          });
          if (!tokenMatchesUser(refreshed.accessToken, res.user)) {
            if (isCurrent()) clearTokens();
            return;
          }
          if (isCurrent()) {
            storeTokens(refreshed.accessToken, refreshed.refreshToken);
            setUser(res.user);
          }
        } catch {
          if (timedOut) {
            if (isCurrent()) setBootError('Session refresh timed out after 10 seconds.');
            return;
          }
          // Clear once and remain logged out. This effect does not retry after
          // logout, so an invalid/stale JWT cannot create an auth loop.
          if (isCurrent()) {
            clearTokens();
          }
        }
      } finally {
        window.clearTimeout(bootTimer);
        if (isCurrent()) {
          setIsLoading(false);
        }
      }
    }

    boot();
    return () => {
      cancelled = true;
      sessionGeneration.current += 1;
      window.clearTimeout(bootTimer);
      bootController.abort();
    };
  }, [clearTokens, doRefresh, storeTokens, tokenMatchesUser]);

  // ── Login ───────────────────────────────────────────────────────────────

  const login = useCallback(async (email: string, password: string) => {
    const generation = ++sessionGeneration.current;
    const res = await apiFetch<{
      user: AuthUser;
      accessToken: string;
      refreshToken: string;
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (generation !== sessionGeneration.current) return;
    storeTokens(res.accessToken, res.refreshToken);
    setUser(res.user);
    setIsLoading(false);
    setBootError(null);
  }, [storeTokens]);

  // ── Register ────────────────────────────────────────────────────────────

  const register = useCallback(async (email: string, password: string, name: string) => {
    const generation = ++sessionGeneration.current;
    const res = await apiFetch<{
      user: AuthUser;
      accessToken: string;
      refreshToken: string;
    }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });

    if (generation !== sessionGeneration.current) return;
    storeTokens(res.accessToken, res.refreshToken);
    setUser(res.user);
    setIsLoading(false);
    setBootError(null);
  }, [storeTokens]);

  // ── Logout ──────────────────────────────────────────────────────────────

  const logout = useCallback(() => {
    clearTokens();
  }, [clearTokens]);

  // ── Refresh (public) ────────────────────────────────────────────────────

  const refreshTokenFn = useCallback(async () => {
    const generation = sessionGeneration.current;
    const refreshed = await doRefresh();
    if (generation !== sessionGeneration.current) return;
    const res = await apiFetch<{ user: AuthUser }>('/auth/me', {
      headers: { Authorization: `Bearer ${refreshed.accessToken}` },
    });
    if (generation !== sessionGeneration.current) return;
    if (!tokenMatchesUser(refreshed.accessToken, res.user)) {
      clearTokens();
      throw new Error('Session no longer matches your organization');
    }
    storeTokens(refreshed.accessToken, refreshed.refreshToken);
    setUser(res.user);
  }, [clearTokens, doRefresh, storeTokens, tokenMatchesUser]);

  // ── Value ───────────────────────────────────────────────────────────────

  const value = useMemo<AuthState>(
    () => ({
      user,
      token,
      isAuthenticated,
      isLoading,
      bootError,
      login,
      register,
      logout,
      refreshToken: refreshTokenFn,
    }),
    [user, token, isAuthenticated, isLoading, bootError, login, register, logout, refreshTokenFn],
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
