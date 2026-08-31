// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import type { JSX, ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * StatCard — small dashboard tile showing a single headline number,
 * a label, and an optional icon. Used in a grid to give the user a
 * one-glance overview of the organisation's inventory.
 *
 * The numeric value can be `undefined` while loading; the card shows
 * a skeleton bar instead so the layout doesn't shift when data
 * arrives. An `error` flag shows a dash + error styling.
 *
 * Designed for ~ 240px column width in a grid; the layout still works
 * down to ~ 180px (mobile) by collapsing the icon to the side.
 */

interface StatCardProps {
  label: string;
  value: number | undefined;
  icon: ReactNode;
  /**
   * Optional subtitle shown below the headline number. Used for
   * context like "1 nová tento týždeň" or "z 50 dostupných".
   */
  hint?: string;
  /** Visual flag — colour the icon background when present. */
  tone?: 'default' | 'success' | 'warning' | 'info';
  isLoading?: boolean;
  isError?: boolean;
}

export function StatCard({
  label,
  value,
  icon,
  hint,
  tone = 'default',
  isLoading,
  isError,
}: StatCardProps): JSX.Element {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-border-subtle bg-surface-card p-5 shadow-sm">
      <span
        aria-hidden="true"
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
          tone === 'default' && 'bg-surface-subtle text-brand-primary',
          tone === 'success' && 'bg-success-bg text-success-fg',
          tone === 'warning' && 'bg-warning-bg text-warning-fg',
          tone === 'info' && 'bg-info-bg text-info-fg',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-secondary">{label}</p>
        <p
          className={cn(
            'mt-1 text-2xl font-bold tabular-nums',
            isError ? 'text-danger-fg' : 'text-text-primary',
          )}
          aria-live="polite"
          aria-busy={isLoading}
        >
          {isLoading ? (
            // `surface-subtle` (paper-50) je na `surface-card` prakticky
            // neviditeľný — skeleton pôsobil ako prázdna karta. `border-subtle`
            // (gray-200) je stále jemný, ale používateľ ho zaregistruje.
            <span
              className="inline-block h-7 w-16 animate-pulse rounded bg-border-subtle"
              aria-label="Načítavam"
            />
          ) : isError ? (
            '—'
          ) : (
            (value ?? 0).toLocaleString('sk-SK')
          )}
        </p>
        {hint && !isLoading && !isError && <p className="mt-0.5 text-xs text-text-muted">{hint}</p>}
        {isError && <p className="mt-0.5 text-xs text-danger-fg">Nepodarilo sa načítať</p>}
      </div>
    </div>
  );
}
