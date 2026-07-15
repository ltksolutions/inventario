// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Unit testy pre `apps/web/middleware.ts` (ADR-0035 F4, doplnené F7) —
 * prvé frontend testy v tomto balíku (žiadna staršia infra existovala,
 * pozri `vitest.config.ts`).
 *
 * Testuje `middleware()` priamo s ručne zostaveným `NextRequest` — bez
 * skutočného Next.js dev servera. `fetch` (volanie na `login-context`)
 * je mockované cez `vi.stubGlobal`, aby test nezávisel na behúcom API.
 *
 * Každý test case používa unikátny hostname, aby sa vyhol kolízii v
 * module-level `domainCache` (60s in-memory cache v `middleware.ts`,
 * zdieľaná medzi test casmi v rámci jedného vitest workera/modulu).
 */

import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { middleware } from '../../middleware';

function buildRequest(hostname: string, pathname = '/', search = ''): NextRequest {
  return new NextRequest(`https://${hostname}${pathname}${search}`, {
    headers: { host: hostname },
  });
}

describe('middleware (ADR-0035 F4/F6 host routing)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('kanonický host (app.inventario.estate) prejde bez zásahu, bez fetch volania', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await middleware(buildRequest('app.inventario.estate'));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('*.vercel.app preview doména prejde bez zásahu, bez fetch volania', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await middleware(
      buildRequest('inventario-app-git-main-ltksolutions-projects.vercel.app'),
    );

    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('neregistrovaná vlastná doména vráti 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const res = await middleware(buildRequest('neexistuje-f7a.example.sk'));

    expect(res.status).toBe(404);
  });

  it('sieťová chyba pri overovaní domény → fail closed, 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const res = await middleware(buildRequest('network-fail-f7a.example.sk'));

    expect(res.status).toBe(404);
  });

  it('registrovaná doména, cesta "/" → rewrite na /tenant-login?domain=', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const hostname = 'majetok-f7a.example.sk';
    const res = await middleware(buildRequest(hostname, '/'));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      `https://${hostname}/tenant-login?domain=${hostname}`,
    );
  });

  it('registrovaná doména, cesta "/tenant-login" → rewrite (idempotentné)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const hostname = 'majetok-f7a-2.example.sk';
    const res = await middleware(buildRequest(hostname, '/tenant-login'));

    expect(res.headers.get('x-middleware-rewrite')).toBe(
      `https://${hostname}/tenant-login?domain=${hostname}`,
    );
  });

  it('registrovaná doména, iná cesta → redirect 307 na app.inventario.estate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const hostname = 'majetok-f7a-3.example.sk';
    const res = await middleware(buildRequest(hostname, '/settings/auth', '?foo=bar'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.inventario.estate/settings/auth?foo=bar');
  });

  it('60s cache — druhé volanie pre rovnaký hostname nevyžaduje nový fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const hostname = 'majetok-f7a-cache.example.sk';
    await middleware(buildRequest(hostname, '/'));
    await middleware(buildRequest(hostname, '/'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
