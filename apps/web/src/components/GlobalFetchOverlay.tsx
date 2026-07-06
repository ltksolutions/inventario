// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { useIsFetching } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { LoadingOverlay } from './LoadingOverlay';

import type { JSX } from 'react';

/**
 * GlobalFetchOverlay — app-wide "something is happening" indicator.
 *
 * Renamed + redesigned 2026-07-06 from `RouteProgressBar`, which was a
 * thin 2px bar pinned under the header. People reported never noticing
 * it. This now renders the same `LoadingOverlay` used by AuthGate: a
 * centred, unmissable overlay with the Inventario wordmark, a spinner,
 * and a label. Visible whenever *any* TanStack Query request is in
 * flight, anywhere in the app.
 *
 * Why this exists:
 *   The global safety net for perceived performance. Individual pages
 *   show skeletons for their main content, but this overlay guarantees
 *   the user always sees an unmistakable "something is happening" state
 *   — even on a page that forgot to wire a local loader, or during a
 *   background refetch where stale data is still on screen (so no
 *   skeleton shows).
 *
 * Trade-off (accepted deliberately): unlike the old thin bar, this
 * covers the whole viewport — including for background refetches on a
 * page that already has data on screen (e.g. switching tabs). Chosen
 * on purpose: one unmissable loading style everywhere beat a "never
 * interrupt the view" bar that people scrolled straight past.
 *
 * Anti-flicker:
 *   A fast request (< ~120ms) shouldn't flash the overlay — that reads
 *   as a glitch, not feedback. We delay showing it by 120ms, and once
 *   shown keep it up for at least 240ms so it never blinks. Both timers
 *   are cleared on unmount / state change.
 */

const SHOW_DELAY_MS = 120;
const MIN_VISIBLE_MS = 240;

export function GlobalFetchOverlay(): JSX.Element | null {
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

  return <LoadingOverlay />;
}
