// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

import type { JSX, ReactNode } from 'react';

import { AuthProvider } from '@/lib/auth-context';

/**
 * Client-side provider tree — Slice #6b.
 *
 * Replaces the previous MsalProvider setup with the Inventario JWT
 * cookie flow:
 *
 *   <QueryClientProvider>   ← TanStack Query cache
 *     <AuthProvider>        ← reads GET /v1/me, exposes useAuth()
 *       {children}
 *     </AuthProvider>
 *   </QueryClientProvider>
 *
 * QueryClientProvider wraps AuthProvider so the authenticated route
 * tree can call TanStack hooks, while AuthProvider itself uses plain
 * fetch internally (no circular hook dependency).
 *
 * The QueryClient is held in component state (not module scope) so
 * Next.js Fast Refresh doesn't share it across HMR boundaries.
 */
export function AppProviders({ children }: { children: ReactNode }): JSX.Element {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
