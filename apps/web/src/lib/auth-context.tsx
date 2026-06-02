// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * Inventario auth context — Slice #6b + #9e K19.
 *
 * K19 update: fetchMe now calls GET /v1/auth/me (extended) instead of
 * GET /v1/me. The extended endpoint returns:
 *   - user: global identity fields
 *   - activeMembership: current org membership with authoritative roles
 *   - availableOrganisations: list for tenant switcher
 *
 * AuthUser.roles is populated from activeMembership.roles so all
 * existing consumers of useAuth().user.roles continue to work
 * with the authoritative per-tenant roles.
 *
 * New context values:
 *   availableOrganisations  — for AppShell tenant switcher (K19)
 *   activeMembership        — current membership details
 *   switchOrg()             — POST /v1/auth/switch-organisation + refresh
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
  roles: string[]; // populated from activeMembership.roles (authoritative)
  isActive: boolean;
  lastLoginAt: string | null;
  preferences: Record<string, unknown>;
  mfaEnabled?: boolean;
}

export interface ActiveMembership {
  membershipId: string;
  organisationId: string;
  roles: string[];
  status: string;
  isDefault: boolean;
}

export interface AvailableOrganisation {
  organisationId: string;
  organisationName: string;
  slug: string;
  /**
   * Brand kit pre runtime CSS override (ADR-0028).
   * Inline — vyhýba import/order konfliktu medzi external/internal type skupinami.
   */
  brandKit: {
    logoUrl: string | null;
    faviconUrl: string | null;
    primary: string | null;
    primaryFg: string | null;
    accent: string | null;
    accentFg: string | null;
    logoDot: string | null;
    fontFamilySans: string | null;
  } | null;
  roles: string[];
  isDefault: boolean;
  lastAccessedAt: string | null;
  membershipId: string;
}

interface AuthMeResponse {
  user: {
    _id: string;
    email: string;
    firstName: string;
    lastName: string;
    displayName: string;
    accountType: string;
    isActive: boolean;
    lastLoginAt: string | null;
    preferences: Record<string, unknown>;
    mfaEnabled: boolean;
  };
  activeMembership: ActiveMembership | null;
  availableOrganisations: AvailableOrganisation[];
}

interface AuthContextValue {
  user: AuthUser | null;
  activeMembership: ActiveMembership | null;
  availableOrganisations: AvailableOrganisation[];
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  switchOrg: (organisationId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const API_BASE_URL = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeMembership, setActiveMembership] = useState<ActiveMembership | null>(null);
  const [availableOrganisations, setAvailableOrganisations] = useState<AvailableOrganisation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const refreshing = useRef(false);

  const fetchMe = useCallback(async (): Promise<void> => {
    if (refreshing.current) return;
    refreshing.current = true;

    try {
      let res = await fetch(`${API_BASE_URL}/v1/auth/me`, {
        credentials: 'include',
        cache: 'no-store',
      });

      if (res.status === 401) {
        try {
          const refreshRes = await fetch(`${API_BASE_URL}/v1/auth/refresh`, {
            method: 'POST',
            credentials: 'include',
          });
          if (refreshRes.ok) {
            res = await fetch(`${API_BASE_URL}/v1/auth/me`, {
              credentials: 'include',
              cache: 'no-store',
            });
          }
        } catch {
          // ignore
        }
      }

      if (res.ok) {
        const data = (await res.json()) as AuthMeResponse;
        const membership = data.activeMembership;
        // Populate roles from activeMembership (authoritative) or fall back to empty
        setUser({
          ...data.user,
          roles: membership?.roles ?? [],
        });
        setActiveMembership(membership);
        setAvailableOrganisations(data.availableOrganisations ?? []);
      } else {
        setUser(null);
        setActiveMembership(null);
        setAvailableOrganisations([]);
      }
    } catch {
      setUser(null);
      setActiveMembership(null);
      setAvailableOrganisations([]);
    } finally {
      refreshing.current = false;
      setIsLoading(false);
    }
  }, []);

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
      // ignore
    } finally {
      setUser(null);
      setActiveMembership(null);
      setAvailableOrganisations([]);
      router.push('/login');
    }
  }, [router]);

  const refresh = useCallback(async (): Promise<void> => {
    await fetchMe();
  }, [fetchMe]);

  const switchOrg = useCallback(
    async (organisationId: string): Promise<void> => {
      const res = await fetch(`${API_BASE_URL}/v1/auth/switch-organisation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ organisationId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Failed to switch organisation');
      }
      // Re-fetch me to get new membership + roles
      await fetchMe();
    },
    [fetchMe],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        activeMembership,
        availableOrganisations,
        isLoading,
        isAuthenticated: user !== null,
        logout,
        refresh,
        switchOrg,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() must be used inside <AuthProvider>.');
  }
  return ctx;
}
