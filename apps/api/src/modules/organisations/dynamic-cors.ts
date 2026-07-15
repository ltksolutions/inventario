// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Dynamic CORS origin resolver — ADR-0035 Fáza 2 (F4).
 *
 * Umožňuje `credentials: 'include'` fetch (napr. email/heslo login) z
 * vlastnej domény organizácie (napr. `majetok.futbalsfz.sk`), popri
 * statickom zozname `CORS_ORIGINS` (lokálny dev, staging, `app.inventario.*`).
 *
 * BEZPEČNOSTNÉ PRAVIDLÁ (nemeniť bez rozmyslenia — ADR-0021 precedens
 * "nikdy nedôveruj hlavičke bez DB overenia" platí rovnako pre Origin ako
 * pre Host):
 *
 *   1. PRESNÁ zhoda hostname vs `Organisation.customDomain` v DB — ŽIADNE
 *      wildcard/subdomain/prefix matchovanie. `findByCustomDomain()` robí
 *      presný `$eq` dotaz, nie regex.
 *   2. Chýbajúci/nevalidný Origin header (same-origin volania, curl,
 *      server-to-server) → povolené (`true`) — CORS beží len v prehliadači,
 *      toto nie je autentifikačná kontrola.
 *   3. Chyba pri DB dotaze (napr. výpadok Mongo) → FAIL CLOSED (`false`),
 *      nikdy fail-open.
 *   4. Krátky TTL cache (60s, in-memory, per proces) — znižuje záťaž na
 *      Mongo pri opakovaných preflight requestoch z tej istej domény, a
 *      zároveň zaručuje, že zrušenie/zmena `customDomain` sa prejaví do
 *      rozumného času (žiadny manuálny purge endpoint zatiaľ, viď ADR).
 *
 * ZNÁME REZIDUÁLNE RIZIKO (zdokumentované v ADR-0035, nie blocker): ak by
 * niekto prevzal kontrolu nad DNS tenantovej domény (mimo Vercel), mohol by
 * cudzí server pod tou doménou vyskladať credentialed cross-origin request
 * na naše API a CORS by ho pustil, keďže kontrolujeme len zhodu hostname v
 * DB, nie kto skutočne obsluhuje danú doménu. Rovnaké riziko akceptujú
 * bežné "custom domain" implementácie (Auth0, Okta) — mitigované tým, že
 * skutočný obsah pod doménou (naša /tenant-login stránka) je vždy náš
 * vlastný kód (Vercel host-routing, nie proxy na tenantov server), takže
 * jediná cesta k zneužitiu je buď XSS v našom kóde (rovnaké riziko ako na
 * app.inventario.estate), alebo DNS hijack (mimo nášho vplyvu).
 */

import { OrganisationsRepository } from './organisations.repository.js';

import type { FastifyInstance } from 'fastify';

const CACHE_TTL_MS = 60_000;

// Bezpečnostná poistka proti neobmedzenému rastu (nezávislá bezpečnostná
// revízia F4 — spam náhodných Origin hlavičiek by inak rástol pamäť bez
// stropu). Pri prekročení sa cache jednoducho vyprázdni — jednoduchšie než
// LRU a dostatočné pri realistickom počte tenantov.
const MAX_CACHE_ENTRIES = 1000;

interface CacheEntry {
  allowed: boolean;
  expiresAt: number;
}

/**
 * Fastify `@fastify/cors` async origin function (v10+ signature — vracia
 * Promise<boolean> priamo, bez callbacku).
 *
 * `app.config.CORS_ORIGINS` (statický zoznam / `'*'`) sa kontroluje PRED
 * touto funkciou v `server.ts` — sem sa dostane len Origin, ktorý v
 * statickom zozname nebol.
 */
export function createDynamicCorsOrigin(
  app: FastifyInstance,
): (origin: string | undefined) => Promise<boolean> {
  // Cache žije v uzávere tejto funkcie — jeden per Fastify instance
  // (per serverless invocation/proces), nie globálny singleton.
  const cache = new Map<string, CacheEntry>();

  return async function dynamicCorsOrigin(origin: string | undefined): Promise<boolean> {
    if (!origin) return true;

    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      // Nevalidný Origin header (nemalo by sa stať v praxi, prehliadače
      // posielajú validné Origin) — fail closed.
      return false;
    }

    // Nezávislá bezpečnostná revízia F4: porovnávať LEN hostname (bez
    // schémy/portu) by pripustilo napr. `http://tenant.sk` alebo
    // `https://tenant.sk:8443` pre `customDomain: 'tenant.sk'` — zbytočne
    // rozširuje rezervné riziko (DNS hijack, viď vyššie) aj na nešifrované/
    // neštandardné porty. Vlastná doména je vždy https na štandardnom
    // porte (Vercel-spravovaný TLS cert), takže obe požadujeme striktne.
    if (parsed.protocol !== 'https:' || parsed.port !== '') {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();

    const now = Date.now();
    const cached = cache.get(hostname);
    if (cached && cached.expiresAt > now) {
      return cached.allowed;
    }

    try {
      // `findByCustomDomain` robí presný $eq dotaz — vyžaduje, aby F5
      // (UI na nastavenie `customDomain`) pri zápise ukladalo hodnotu v
      // rovnakom tvare, v akom ju tu porovnávame: lowercase, bez schémy/
      // cesty/portu. Inak legitímna doména nikdy nenájde zhodu (fail
      // closed, ale rozbije funkčnosť pre danú organizáciu).
      const orgsRepo = new OrganisationsRepository(app.mongo.db);
      const org = await orgsRepo.findByCustomDomain(hostname);
      const allowed = org != null;
      if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
      cache.set(hostname, { allowed, expiresAt: now + CACHE_TTL_MS });
      return allowed;
    } catch (err) {
      app.log.error({ err, hostname }, 'Dynamic CORS: findByCustomDomain zlyhalo, fail closed');
      return false;
    }
  };
}
