// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { Loader2 } from 'lucide-react';

import type { JSX } from 'react';

import { cn } from '@/lib/cn';

/**
 * Spinner — shared "work in progress" indicator.
 *
 * Centralises the `Loader2 + animate-spin` pattern that was previously
 * copy-pasted inline across ~15 components, so size, colour and the
 * accessibility wiring live in one place.
 *
 * Two entry points:
 *   - `Spinner`     — the bare spinning icon. Use inline (inside a button
 *     while saving, next to a label). Inherits text colour via
 *     `text-current` so it matches whatever it sits in.
 *   - `LoadingState` — a centred spinner + visible label, for focused
 *     surfaces that are fetching data (modals, panels). This is the
 *     "you can clearly see it's loading" variant.
 *
 * Note on the design language (see Skeleton.tsx): list/table and
 * whole-page loads should prefer skeletons so the layout doesn't shift.
 * `LoadingState` is for smaller focused surfaces (a dialog body) where a
 * skeleton of the form is easy to miss and an explicit spinner reads
 * more clearly.
 */

type SpinnerSize = 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
};

interface SpinnerProps {
  /** Icon size. Defaults to `md`. */
  size?: SpinnerSize;
  /** Extra classes (e.g. a colour override). */
  className?: string;
  /**
   * Accessible label announced to screen readers. Defaults to
   * "Načítavam…". Pass a more specific label where it helps.
   */
  label?: string;
}

export function Spinner({
  size = 'md',
  className,
  label = 'Načítavam…',
}: SpinnerProps): JSX.Element {
  return (
    <span role="status" aria-live="polite" className="inline-flex">
      <Loader2
        aria-hidden="true"
        className={cn('animate-spin text-current', SIZE_CLASSES[size], className)}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

interface LoadingStateProps {
  /** Visible + announced label. Defaults to "Načítavam…". */
  label?: string;
  /** Spinner size. Defaults to `lg` for a clearly visible focal point. */
  size?: SpinnerSize;
  /** Extra classes on the wrapper (e.g. min-height, padding). */
  className?: string;
}

/**
 * Centred spinner with a visible label — drop into a dialog body, panel,
 * or any focused surface that is fetching data and should show an
 * unmistakable "loading" state.
 */
export function LoadingState({
  label = 'Načítavam…',
  size = 'lg',
  className,
}: LoadingStateProps): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-10 text-text-muted',
        className,
      )}
    >
      <Loader2
        aria-hidden="true"
        className={cn('animate-spin text-brand-primary', SIZE_CLASSES[size])}
      />
      <span className="text-sm">{label}</span>
    </div>
  );
}
