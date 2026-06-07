// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import createClient, { type Middleware } from 'openapi-fetch';

import type { paths } from './api-types';

/**
 * Inventario API client — Slice #6b/K19.
 *
 * Authentication: httpOnly `inv_access` cookie, sent automatically by
 * the browser via `credentials: 'include'`.
 *
 * Silent refresh (K19):
 *   When any API call returns 401 (expired access token), the middleware:
 *     1. Calls POST /v1/auth/refresh (browser sends inv_refresh cookie
 *        automatically because it is scoped to /v1/auth/refresh path).
 *     2. On success (204): retries the original request once. The new
 *        inv_access cookie is set by the server and sent on the retry.
 *     3. On failure: redirects to /login.
 *
 * Concurrency guard:
 *   Multiple requests expiring simultaneously would each trigger a
 *   refresh attempt. The backend's refresh-token reuse detection would
 *   interpret the second attempt as a replay attack and revoke ALL
 *   sessions. We prevent this with a module-level singleton promise:
 *   the first 401 fires the refresh; subsequent ones await that same
 *   promise and then retry once it resolves.
 */

const API_BASE_URL = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Singleton refresh coordination
// ---------------------------------------------------------------------------

/**
 * While a refresh is in flight this holds the promise. All concurrent
 * 401 handlers await this instead of firing their own refresh.
 * Cleared to null when the refresh settles (success or failure).
 */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Attempt a silent token refresh. Returns true if the server accepted
 * the refresh token and issued new cookies, false otherwise.
 *
 * Guarantees at most one concurrent refresh request is in flight by
 * reusing the pending promise for any callers that arrive while the
 * first is still running.
 */
async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async (): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE_URL}/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      // Allow the next expiry to start a fresh refresh cycle.
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * WeakMap storing a pre-flight clone of each outgoing Request.
 *
 * Problem: `onResponse` is called AFTER `fetch()` has consumed the
 * request body (ReadableStream). Calling `request.clone()` at that
 * point throws `TypeError: Body is disturbed or locked`.
 *
 * Fix: clone the request in `onRequest` — before the body is read —
 * and store it here. `onResponse` retrieves the clone for the retry.
 * WeakMap ensures entries are GC-d when the Request object itself is
 * collected (no memory leak).
 */
const pendingClones = new WeakMap<Request, Request>();

const silentRefreshMiddleware: Middleware = {
  // Save a clone of the request BEFORE fetch() consumes its body.
  onRequest({ request }) {
    try {
      pendingClones.set(request, request.clone());
    } catch {
      // Body already disturbed (shouldn't happen in onRequest, but be safe).
    }
    // Return undefined — don't modify the request.
    return undefined;
  },

  async onResponse({ request, response }) {
    // Only intercept 401s in the browser. Server-side fetches have no
    // cookies to refresh and no window to redirect.
    if (response.status !== 401 || typeof window === 'undefined') return response;

    // Don't retry auth endpoints — prevents infinite loops and avoids
    // triggering replay-attack detection on consecutive refresh calls.
    if (
      request.url.includes('/v1/auth/refresh') ||
      request.url.includes('/v1/auth/login') ||
      request.url.includes('/v1/auth/logout')
    ) {
      pendingClones.delete(request);
      window.location.href = '/login';
      return response;
    }

    // Attempt silent refresh.
    const refreshed = await tryRefresh();
    if (!refreshed) {
      pendingClones.delete(request);
      window.location.href = '/login';
      return response;
    }

    // Retry using the pre-flight clone (body still readable).
    // The browser automatically attaches the new inv_access cookie
    // (set by the refresh endpoint) because credentials:'include' is
    // in the client options.
    const clonedRequest = pendingClones.get(request);
    pendingClones.delete(request);

    if (!clonedRequest) {
      // Fallback: no clone available — can't retry, send to login.
      window.location.href = '/login';
      return response;
    }

    return fetch(clonedRequest);
  },
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export const apiClient = createClient<paths>({
  baseUrl: API_BASE_URL,
  // Cookie-based auth — inv_access is sent automatically.
  credentials: 'include',
});

apiClient.use(silentRefreshMiddleware);
