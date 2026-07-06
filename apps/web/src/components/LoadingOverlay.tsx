// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { Layers, Loader2 } from 'lucide-react';

import type { JSX } from 'react';

import { cn } from '@/lib/cn';

interface LoadingOverlayProps {
  /** Visible + announced label under the spinner. Defaults to "Načítavam…". */
  label?: string;
  /** Extra classes on the outer overlay wrapper. */
  className?: string;
}

/**
 * LoadingOverlay — THE single loading visual for Inventario (2026-07-06).
 *
 * Fixed, dead-centre of the viewport regardless of scroll position, on a
 * translucent blurred backdrop: Inventario wordmark + spinner + label.
 * Deliberately unmissable.
 *
 * History: unifies two previously separate patterns that people reported
 * not noticing —
 *   - AuthGate's old plain text-only screen during the initial /v1/me
 *     check (no spinner, no motion, blended into the background).
 *   - A thin 2px bar pinned under the header (`RouteProgressBar`, now
 *     `GlobalFetchOverlay`) shown for every in-flight query — too subtle,
 *     people scrolled straight past it.
 *
 * Used directly by AuthGate (initial auth check) and by
 * GlobalFetchOverlay (every other query in flight app-wide) — one
 * component, one look, wherever "Inventario is doing something" needs
 * to be shown to the user.
 */
export function LoadingOverlay({
  label = 'Načítavam…',
  className,
}: LoadingOverlayProps): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed inset-0 z-[100] flex flex-col items-center justify-center',
        'bg-surface-page/60 backdrop-blur-sm',
        className,
      )}
    >
      {/*
       * Vlastná nepriehľadná karta pod obsahom — bez nej text/logo sedeli
       * priamo na rozmazanom pozadí a nad pestrejším obsahom (napr. tabuľky)
       * boli zle čitateľné. Karta dáva spoľahlivý kontrast bez ohľadu na to,
       * čo presvitá spod blur efektu.
       */}
      <div className="flex flex-col items-center gap-4 rounded-2xl bg-surface-card px-10 py-8 shadow-xl ring-1 ring-border-subtle">
        <div className="flex items-center gap-2 text-brand-primary">
          <Layers aria-hidden="true" className="h-8 w-8" />
          <span className="text-2xl font-bold">Inventario</span>
        </div>
        <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin text-brand-primary" />
        <span className="text-sm text-text-secondary">{label}</span>
      </div>
    </div>
  );
}
