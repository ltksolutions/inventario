// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Host-aware middleware — ADR-0035 Fáza 2 (F4).
 *
 * Appka beží kanonicky na `app.inventario.estate` (a jeho Vercel preview
 * doménach). Organizácia si ale môže nastaviť vlastnú doménu pre
 * prihlásenie (napr. `majetok.futbalsfz.sk`, `/settings/auth`, F5) —
 * DNS CNAME smeruje na tento istý Vercel projekt (`inventario-app`), takže
 * requesty s neznámym `Host` header-om sem tiež dorazia.
 *
 * BEZPEČNOSTNÉ PRAVIDLO (ADR-0021 precedens — nikdy nedôveruj hlavičke bez
 * DB overenia): neznámy `Host` sa VŽDY overí proti `Organisation.customDomain`
 * v DB cez verejný `login-context` endpoint (rovnaký, čo používa F2 pre
 * `?org=` hint), nikdy sa neuveria slepo. Bez zhody → 404. So zhodou →
 * rewrite (URL v prehliadači ostáva `majetok.futbalsfz.sk`) LEN na koreňovú
 * cestu, ktorá vykreslí `/tenant-login` (F6). Akákoľvek iná cesta pod
 * vlastnou doménou sa presmeruje na `app.inventario.estate` — appka sa pod
 * cudzou doménou nikdy priamo nevykresľuje (cookie je scoped na
 * `.inventario.estate`, prihlásená appka by tam aj tak nefungovala).
 *
 * Feature je neškodná, kým žiadna organizácia nemá `customDomain` nastavený
 * (F5 ešte nie je implementované) — `isRegisteredTenantDomain()` vždy vráti
 * `false` a middleware sa správa ako no-op (404 pre neznáme domény, ktoré
 * sem aj tak nemajú dôvod smerovať).
 */

import { NextResponse } from 'next/server';

import type { NextRequest } from 'next/server';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';
const CANONICAL_APP_URL =
  process.env['NEXT_PUBLIC_CANONICAL_APP_URL'] ?? 'https://app.inventario.estate';

// Domény, pod ktorými appka beží ako Inventario sama — middleware tu nič
// nerobí, normálny priechod. `.vercel.app` pokrýva preview deploymenty.
// Nezávislá bezpečnostná revízia F4: dev hostname-y (localhost/127.0.0.1)
// sa v produkcii nikdy nemajú vyskytnúť ako reálny Host header, ale
// netreba ich tam zbytočne ponechávať ako "canonical" — v produkčnom
// builde ich jednoducho vynecháme (žiadny funkčný rozdiel, keďže tam by
// aj tak nikdy nedorazili, len menšia plocha na zamyslenie pri auditoch).
const CANONICAL_HOSTS = new Set(
  process.env['NODE_ENV'] === 'production'
    ? ['app.inventario.estate', 'app.inventario.sportup.sk']
    : [
        'app.inventario.estate',
        'app.inventario.sportup.sk',
        'localhost:3001',
        'localhost:3000',
        '127.0.0.1:3001',
      ],
);
const CANONICAL_HOST_SUFFIXES = ['.vercel.app'];

function isCanonicalHost(host: string): boolean {
  if (CANONICAL_HOSTS.has(host)) return true;
  const hostname = host.split(':')[0] ?? host;
  return CANONICAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

// Krátky in-memory cache (per warm edge inštancia) — rovnaký TTL a dôvod
// ako `createDynamicCorsOrigin` na backende (ADR-0035 F4): znižuje záťaž na
// `login-context` endpoint pri opakovaných requestoch z tej istej domény,
// zmena/zrušenie `customDomain` sa prejaví do 60s.
const CACHE_TTL_MS = 60_000;
const domainCache = new Map<string, { found: boolean; expiresAt: number }>();

async function isRegisteredTenantDomain(hostname: string): Promise<boolean> {
  const now = Date.now();
  const cached = domainCache.get(hostname);
  if (cached && cached.expiresAt > now) return cached.found;

  try {
    const res = await fetch(
      `${API_BASE}/v1/public/organisations/login-context?domain=${encodeURIComponent(hostname)}`,
      { headers: { accept: 'application/json' } },
    );
    const found = res.ok;
    domainCache.set(hostname, { found, expiresAt: now + CACHE_TTL_MS });
    return found;
  } catch {
    // Sieťová chyba voči vlastnému backendu — fail closed, nezobraziť
    // appku pod neoverenou doménou.
    domainCache.set(hostname, { found: false, expiresAt: now + CACHE_TTL_MS });
    return false;
  }
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const host = request.headers.get('host') ?? '';

  if (isCanonicalHost(host)) {
    return NextResponse.next();
  }

  const hostname = host.split(':')[0] ?? host;
  const registered = await isRegisteredTenantDomain(hostname);

  if (!registered) {
    return new NextResponse(null, { status: 404 });
  }

  const { pathname, search } = request.nextUrl;

  if (pathname === '/' || pathname === '/tenant-login') {
    const url = request.nextUrl.clone();
    url.pathname = '/tenant-login';
    url.searchParams.set('domain', hostname);
    return NextResponse.rewrite(url);
  }

  return NextResponse.redirect(`${CANONICAL_APP_URL}${pathname}${search}`, 307);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
