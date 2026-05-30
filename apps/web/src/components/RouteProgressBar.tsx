// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { useIsFetching } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import type { JSX } from 'react';

/**
 * RouteProgressBar — thin indeterminate progress bar pinned below the
 * header. Visible whenever *any* TanStack Query request is in flight.
 *
 * Why this exists:
 *   It's the global safety net for perceived performance. Individual
 *   pages show skeletons for their main content, but this bar guarantees
 *   the user always sees "something is happening" — even on a page that
 *   forgot to wire a local loader, or during a background refetch where
 *   stale data is still on screen (so no skeleton shows).
 *
 * Anti-flicker:
 *   A fast request (< ~120ms) shouldn't flash the bar — that reads as a
 *   glitch, not feedback. We delay showing the bar by 120ms, and once
 *   shown keep it up for at least 240ms so it never blinks. Both timers
 *   are cleared on unmount / state change.
 *
 * Cosmetic-only:
 *   `aria-hidden` — fetch states are announced by the regions that own
 *   them (tables use aria-busy, StatCard uses aria-live). A global bar
 *   narrating every background refetch would be noise for screen readers.
 */

const SHOW_DELAY_MS = 120;
const MIN_VISIBLE_MS = 240;

export function RouteProgressBar(): JSX.Element | null {
  const fetching = useIsFetching();
  const [visible, setVisible] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAt = useRef<number>(0);

  useEffect(() => {
    if (fetching > 0) {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      if (!visible && !showTimer.current) {
        showTimer.current = setTimeout(() => {
          shownAt.current = Date.now();
          setVisible(true);
          showTimer.current = null;
        }, SHOW_DELAY_MS);
      }
    } else {
      if (showTimer.current) {
        clearTimeout(showTimer.current);
        showTimer.current = null;
      }
      if (visible && !hideTimer.current) {
        const elapsed = Date.now() - shownAt.current;
        const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
        hideTimer.current = setTimeout(() => {
          setVisible(false);
          hideTimer.current = null;
        }, remaining);
      }
    }

    return () => {
      // timers cleaned up on the next effect run / unmount
    };
  }, [fetching, visible]);

  useEffect(() => {
    return () => {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-full z-50 h-0.5 overflow-hidden bg-brand-primary/15"
    >
      <div className="route-progress-bar h-full w-2/5 bg-brand-primary" />
    </div>
  );
}
