// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Shared cookie helpers for Inventario auth routes (K3, K5).
 *
 * Sets httpOnly inv_access (access token) and inv_refresh (refresh token)
 * cookies. In production both cookies are scoped to .inventario.estate.
 * In development no domain is set so localhost works.
 */

import type { FastifyReply } from 'fastify';

export function setAuthCookies(
  reply: FastifyReply,
  accessToken: string,
  refreshToken: string,
  accessTtlSeconds: number,
  refreshTtlDays: number,
): void {
  // Use a dedicated COOKIE_DOMAIN env var rather than NODE_ENV so that
  // devDependencies are not skipped during Vercel builds.
  // Set COOKIE_DOMAIN=.inventario.estate in Vercel production env vars.
  const cookieDomain = process.env['COOKIE_DOMAIN'];
  const isProd = Boolean(cookieDomain);

  reply.setCookie('inv_access', accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
    ...(cookieDomain && { domain: cookieDomain }),
    maxAge: accessTtlSeconds,
  });

  reply.setCookie('inv_refresh', refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/v1/auth/refresh',
    ...(cookieDomain && { domain: cookieDomain }),
    maxAge: refreshTtlDays * 24 * 60 * 60,
  });
}
