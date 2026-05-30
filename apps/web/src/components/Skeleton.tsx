// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import type { JSX } from 'react';

import { cn } from '@/lib/cn';

/**
 * Skeleton — shared loading placeholders.
 *
 * Why skeletons over spinners:
 *   A skeleton shows the *shape* of the content that's coming, so the
 *   layout doesn't shift when data arrives and the wait feels shorter
 *   (the eye has structure to read). Spinners are reserved for small
 *   inline actions (a saving button), not whole-page loads.
 *
 * Three building blocks:
 *   - Skeleton      — a single pulsing bar; compose freely.
 *   - TableSkeleton — header + N rows, matches the list tables.
 *   - CardSkeleton  — a card outline with a few lines, for dashboards
 *     and detail panels.
 *
 * All three use the same `animate-pulse` + `bg-surface-subtle` treatment
 * as StatCard so the visual language is consistent across the app.
 * Each carries `aria-hidden` — the surrounding region announces the
 * loading state via `aria-busy` / `aria-live`, so the skeleton itself
 * shouldn't be read out tile by tile.
 */

interface SkeletonProps {
  /** Tailwind width/height/extra classes, e.g. "h-4 w-32". */
  className?: string;
}

export function Skeleton({ className }: SkeletonProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn('block animate-pulse rounded bg-surface-subtle', className)}
    />
  );
}

/**
 * TableSkeleton — placeholder for list tables while the first page
 * loads. Mirrors the real table chrome (rounded card, header strip,
 * divided rows) so the swap to real data is visually seamless.
 */
export function TableSkeleton({
  rows = 6,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}): JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Načítavam dáta"
      className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card shadow-sm"
    >
      <div className="flex gap-4 border-b border-border-subtle bg-surface-subtle px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-border-subtle">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3.5">
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={c} className={cn('h-4 flex-1', c === 0 && 'max-w-[6rem]')} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * CardSkeleton — placeholder for a card-shaped block (dashboard panel,
 * detail section). Shows a title bar and a few content lines.
 */
export function CardSkeleton({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}): JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Načítavam"
      className={cn(
        'rounded-xl border border-border-subtle bg-surface-card p-5 shadow-sm',
        className,
      )}
    >
      <Skeleton className="mb-4 h-5 w-1/3" />
      <div className="space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={cn('h-4', i === lines - 1 ? 'w-2/3' : 'w-full')} />
        ))}
      </div>
    </div>
  );
}
