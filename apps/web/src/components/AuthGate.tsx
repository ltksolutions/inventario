// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { AppShell } from './AppShell';
import { LoadingOverlay } from './LoadingOverlay';
import { LoginScreen } from './LoginScreen';

import type { JSX, ReactNode } from 'react';

import { useAuth } from '@/lib/auth-context';

/**
 * Auth gate — Slice #6b.
 *
 * Reads auth state from the Inventario JWT cookie via useAuth().
 * Shows the unified LoadingOverlay while the initial /v1/me check is
 * in flight, then either renders the app shell (authenticated) or the
 * login screen (unauthenticated).
 */
export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingOverlay label="Načítavam Inventario…" />;
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return <AppShell>{children}</AppShell>;
}
