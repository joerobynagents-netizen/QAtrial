import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './useAuth';
import { apiFetch } from '../lib/apiClient';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);
const user = { id: 'user-1', email: 'qa@example.invalid', name: 'QA', role: 'qa_manager', orgId: 'org-1' };
const token = `header.${btoa(JSON.stringify({ orgId: user.orgId }))}.signature`;
const refreshed = { accessToken: `${token}-new`, refreshToken: 'new-refresh' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  api.mockReset();
  localStorage.clear();
});
afterEach(cleanup);

async function authenticated() {
  localStorage.setItem('qatrial:token', token);
  localStorage.setItem('qatrial:refresh-token', 'old-refresh');
  api.mockResolvedValueOnce({ user });
  const hook = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(hook.result.current.isAuthenticated).toBe(true));
  return hook;
}

describe('auth session races', () => {
  it('does not restore a session when boot validation completes after logout', async () => {
    localStorage.setItem('qatrial:token', token);
    const me = deferred<{ user: typeof user }>();
    api.mockReturnValueOnce(me.promise);
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    act(() => result.current.logout());
    await act(async () => me.resolve({ user }));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('qatrial:token')).toBeNull();
  });

  it('does not write tokens when refresh completes after logout', async () => {
    const { result } = await authenticated();
    const refresh = deferred<typeof refreshed>();
    api.mockReturnValueOnce(refresh.promise);
    const pending = result.current.refreshToken();
    act(() => result.current.logout());
    await act(async () => { refresh.resolve(refreshed); await pending; });
    expect(result.current.isAuthenticated).toBe(false);
    expect(localStorage.getItem('qatrial:token')).toBeNull();
    expect(localStorage.getItem('qatrial:refresh-token')).toBeNull();
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('does not restore identity if logout happens during refreshed user validation', async () => {
    const { result } = await authenticated();
    const me = deferred<{ user: typeof user }>();
    api.mockResolvedValueOnce(refreshed).mockReturnValueOnce(me.promise);
    const pending = result.current.refreshToken();
    await waitFor(() => expect(api).toHaveBeenCalledTimes(3));
    act(() => result.current.logout());
    await act(async () => { me.resolve({ user }); await pending; });
    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('qatrial:token')).toBeNull();
  });

  it('publishes refreshed tokens only after validating their identity', async () => {
    const { result } = await authenticated();
    const me = deferred<{ user: typeof user }>();
    api.mockResolvedValueOnce(refreshed).mockReturnValueOnce(me.promise);
    const pending = result.current.refreshToken();
    await waitFor(() => expect(api).toHaveBeenCalledTimes(3));
    expect(localStorage.getItem('qatrial:token')).toBe(token);
    expect(api).toHaveBeenLastCalledWith('/auth/me', {
      headers: { Authorization: `Bearer ${refreshed.accessToken}` },
    });
    await act(async () => { me.resolve({ user }); await pending; });
    expect(result.current.token).toBe(refreshed.accessToken);
    expect(localStorage.getItem('qatrial:refresh-token')).toBe(refreshed.refreshToken);
  });

  it('refreshes an expired boot token and validates it before signing in', async () => {
    localStorage.setItem('qatrial:token', token);
    localStorage.setItem('qatrial:refresh-token', 'old-refresh');
    api.mockRejectedValueOnce(new Error('Expired')).mockResolvedValueOnce(refreshed).mockResolvedValueOnce({ user });
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(result.current.token).toBe(refreshed.accessToken);
    expect(api).toHaveBeenLastCalledWith('/auth/me', expect.objectContaining({
      headers: { Authorization: `Bearer ${refreshed.accessToken}` },
    }));
  });

  it('does not refresh an aborted boot request after unmount', async () => {
    localStorage.setItem('qatrial:token', token);
    localStorage.setItem('qatrial:refresh-token', 'old-refresh');
    const me = deferred<{ user: typeof user }>();
    api.mockReturnValueOnce(me.promise);
    const { unmount } = renderHook(useAuth, { wrapper: AuthProvider });
    unmount();
    await act(async () => me.reject(new Error('Aborted')));
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('does not publish an in-flight refresh after unmount', async () => {
    const { result, unmount } = await authenticated();
    const refresh = deferred<typeof refreshed>();
    api.mockReturnValueOnce(refresh.promise);
    const pending = result.current.refreshToken();
    unmount();
    await act(async () => { refresh.resolve(refreshed); await pending; });
    expect(localStorage.getItem('qatrial:token')).toBe(token);
  });

  it.each(['login', 'register'] as const)('does not accept a pending %s response after logout', async (method) => {
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const login = deferred<typeof refreshed & { user: typeof user }>();
    api.mockReturnValueOnce(login.promise);
    const pending = method === 'login'
      ? result.current.login(user.email, 'password')
      : result.current.register(user.email, 'password', user.name);
    act(() => result.current.logout());
    await act(async () => { login.resolve({ ...refreshed, user }); await pending; });
    expect(result.current.isAuthenticated).toBe(false);
    expect(localStorage.getItem('qatrial:token')).toBeNull();
  });
});
