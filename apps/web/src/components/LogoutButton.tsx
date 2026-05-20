// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { LogOut } from 'lucide-react';

import type { JSX } from 'react';

import { useAuth } from '@/lib/auth-context';

/**
 * Logout button — Slice #6b.
 *
 * Calls useAuth().logout() which POSTs to /v1/auth/logout (clears
 * cookies server-side) then navigates to /login.
 */
export function LogoutButton(): JSX.Element {
  const { logout } = useAuth();

  const handleLogout = (): void => {
    void logout();
  };

  return (
    <button
      type="button"
      onClick={handleLogout}
      aria-label="Odhlásiť sa"
      className="inline-flex items-center gap-2 rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-subtle"
    >
      <LogOut aria-hidden="true" className="h-4 w-4" />
      <span className="hidden sm:inline">Odhlásiť sa</span>
    </button>
  );
}
