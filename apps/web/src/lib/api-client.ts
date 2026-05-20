// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import createClient, { type Middleware } from 'openapi-fetch';

import type { paths } from './api-types';

/**
 * Inventario API client — Slice #6b.
 *
 * Authentication is now cookie-based (Inventario JWT). The `inv_access`
 * httpOnly cookie is set by the backend login / OAuth callback routes
 * and is sent automatically by the browser with every same-origin
 * request when `credentials: 'include'` is set.
 *
 * No MSAL, no Bearer token manipulation — the browser handles it.
 *
 * 401 handling:
 *   When a request returns 401 the middleware redirects to /login so
 *   the user can re-authenticate. This covers both expired access tokens
 *   (server returns 401 on cookie) and the case where the user has no
 *   cookie at all.
 *
 * Usage:
 *   const { data, error } = await apiClient.GET('/v1/assets', {
 *     params: { query: { limit: 50, skip: 0 } },
 *   });
 *
 * For React components prefer the TanStack Query hooks in
 * `src/lib/api-hooks.ts` — they cache, deduplicate, and handle loading
 * states automatically.
 */

const API_BASE_URL = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

/**
 * Redirect to /login on 401 so the user can re-authenticate.
 * Runs only in the browser (middleware fires inside fetch invocations
 * which only happen client-side for our usage pattern).
 */
const unauthorizedMiddleware: Middleware = {
  async onResponse({ response }) {
    if (response.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    return response;
  },
};

export const apiClient = createClient<paths>({
  baseUrl: API_BASE_URL,
  // Cookie-based auth: send the inv_access httpOnly cookie with every request.
  credentials: 'include',
});

apiClient.use(unauthorizedMiddleware);
