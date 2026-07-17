// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { useIsMutating } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { LoadingOverlay } from './LoadingOverlay';

import type { JSX } from 'react';

/**
 * GlobalFetchOverlay — app-wide "saving…" indicator for mutations.
 *
 * History: introduced 2026-07-06 (renamed from `RouteProgressBar`) as a
 * full-viewport overlay tied to `useIsFetching()` — it showed whenever
 * *any* query anywhere was in flight. That turned out to be the root
 * cause of a reported UX problem (2026-07-17): a page load fires several
 * parallel GETs (e.g. /assets + categories + locations + current org).
 * The main list query resolves fast and its data renders, but if any
 * secondary GET lands on a cold serverless instance (~10s), the overlay
 * kept the WHOLE screen covered the entire time — the user saw the data
 * flash behind the blur, then get re-covered for ~10s. Every list page
 * already renders its own skeleton for its main query, so the global
 * full-screen overlay on top of that was both redundant and harmful.
 *
 * Current behaviour (2026-07-17): the overlay tracks `useIsMutating()`
 * only — it shows during writes (save / delete / etc.), where blocking
 * the screen until the server confirms is the right UX. Read fetches no
 * longer trigger it; pages own their loading state via skeletons, and
 * the initial /v1/me auth check is covered separately by AuthGate (which
 * renders LoadingOverlay directly). This deliberately walks back the
 * "one unmissable loading style for every query everywhere" decision —
 * it stays for mutations, not for background/parallel reads.
 *
 * Anti-flicker:
 *   A fast mutation (< ~120ms) shouldn't flash the overlay — that reads
 *   as a glitch, not feedback. We delay showing it by 120ms, and once
 *   shown keep it up for at least 240ms so it never blinks. Both timers
 *   are cleared on unmount / state change.
 */

const SHOW_DELAY_MS = 120;
const MIN_VISIBLE_MS = 240;

export function GlobalFetchOverlay(): JSX.Element | null {
  const mutating = useIsMutating();
  const [visible, setVisible] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAt = useRef<number>(0);

  useEffect(() => {
    if (mutating > 0) {
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
  }, [mutating, visible]);

  useEffect(() => {
    return () => {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  if (!visible) return null;

  return <LoadingOverlay label="Ukladám…" />;
}
