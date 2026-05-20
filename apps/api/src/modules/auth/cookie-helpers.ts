// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Shared cookie helpers for Inventario auth routes (K3, K5).
 *
 * Sets httpOnly inv_access (access token) and inv_refresh (refresh token)
 * cookies. In production both cookies are scoped to .inventario.sportup.sk.
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
  const isProd = process.env['NODE_ENV'] === 'production';

  reply.setCookie('inv_access', accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    ...(isProd && { domain: '.inventario.sportup.sk' }),
    maxAge: accessTtlSeconds,
  });

  reply.setCookie('inv_refresh', refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/v1/auth/refresh',
    ...(isProd && { domain: '.inventario.sportup.sk' }),
    maxAge: refreshTtlDays * 24 * 60 * 60,
  });
}
