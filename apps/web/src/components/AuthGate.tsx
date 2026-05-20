// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { AppShell } from './AppShell';
import { LoginScreen } from './LoginScreen';

import type { JSX, ReactNode } from 'react';

import { useAuth } from '@/lib/auth-context';

/**
 * Auth gate — Slice #6b.
 *
 * Reads auth state from the Inventario JWT cookie via useAuth().
 * Shows a loading skeleton while the initial /v1/me check is in
 * flight, then either renders the app shell (authenticated) or the
 * login screen (unauthenticated).
 */
export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-screen items-center justify-center bg-surface-page"
      >
        <span className="sr-only">Načítavam Inventario…</span>
        <span className="text-sm text-text-secondary">Načítavam Inventario…</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return <AppShell>{children}</AppShell>;
}
