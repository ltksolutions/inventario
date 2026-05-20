// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * Inventario auth context — Slice #6b.
 *
 * Replaces MSAL (Entra ID) with the Inventario JWT cookie flow.
 *
 * The `inv_access` cookie is httpOnly — the browser sends it automatically
 * with every same-origin request (`credentials: 'include'`). This
 * AuthProvider reads the current user + session state by calling
 * GET /v1/me on mount.
 *
 * AuthProvider sits INSIDE QueryClientProvider in providers.tsx so it can
 * be above the route tree while QueryClientProvider sits above it — but
 * it uses plain `fetch` internally (not TanStack Query) to avoid the
 * circular dependency of needing context to create context.
 *
 * Usage:
 *   const { user, isAuthenticated, isLoading, logout } = useAuth();
 */

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import type { JSX, ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthUser {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  accountType: string;
  roles: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  preferences: Record<string, unknown>;
  createdAt: string;
}

interface AuthContextValue {
  /** Currently authenticated user, or null when not logged in / loading. */
  user: AuthUser | null;
  /** True while the initial /v1/me check is in flight. */
  isLoading: boolean;
  /** True when user is non-null and session is valid. */
  isAuthenticated: boolean;
  /**
   * POST /v1/auth/logout — clears cookies server-side, resets state,
   * and navigates to /login.
   */
  logout: () => Promise<void>;
  /**
   * Re-fetch the current user from the API. Call after operations that
   * change the user's own data (role change, password reset, etc.).
   */
  refresh: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const API_BASE_URL = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

/**
 * Wraps the app with the auth state. Must be rendered inside
 * QueryClientProvider (so children can use TanStack hooks) but above
 * the authenticated page tree (so AuthGate and AppShell can read auth
 * state before rendering).
 */
export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Track if a refresh is already in flight so we don't fire two at once.
  const refreshing = useRef(false);

  const fetchMe = useCallback(async (): Promise<void> => {
    if (refreshing.current) return;
    refreshing.current = true;

    try {
      let res = await fetch(`${API_BASE_URL}/v1/me`, {
        credentials: 'include',
        cache: 'no-store',
      });

      // Access token expired — try a silent refresh before giving up.
      // This covers the page-load case where the user had a valid
      // refresh token but the access token expired while the tab was
      // in the background.
      if (res.status === 401) {
        try {
          const refreshRes = await fetch(`${API_BASE_URL}/v1/auth/refresh`, {
            method: 'POST',
            credentials: 'include',
          });
          if (refreshRes.ok) {
            // New cookie set — retry the /v1/me call.
            res = await fetch(`${API_BASE_URL}/v1/me`, {
              credentials: 'include',
              cache: 'no-store',
            });
          }
        } catch {
          // Refresh network error — fall through to the null path below.
        }
      }

      if (res.ok) {
        const data = (await res.json()) as AuthUser;
        setUser(data);
      } else {
        // 401 even after refresh (or 403/5xx) — no valid session.
        setUser(null);
      }
    } catch {
      // Network error — treat as unauthenticated.
      setUser(null);
    } finally {
      refreshing.current = false;
      setIsLoading(false);
    }
  }, []);

  // Fetch once on mount.
  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await fetch(`${API_BASE_URL}/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignore network errors on logout — we still want to clear local
      // state and redirect so the user ends up on the login screen.
    } finally {
      setUser(null);
      router.push('/login');
    }
  }, [router]);

  const refresh = useCallback(async (): Promise<void> => {
    await fetchMe();
  }, [fetchMe]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: user !== null,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Access the auth context. Throws if called outside <AuthProvider>.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() must be used inside <AuthProvider>.');
  }
  return ctx;
}
