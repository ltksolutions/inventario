<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-07-15 (piate pokračovanie) — ADR-0035 Fáza 2: F4 custom domain middleware + dynamický CORS

## Kontext

Po overení Fázy 1 (12/12 testov u Janiky lokálne) sme pokračovali do
Fázy 2 (`docs/decisions/0035-tenant-custom-domain-login.md`, F4–F8).
Model odporúčaný v ADR pre F4: Opus (bezpečnostne citlivé — host-header a
CORS trust rozhodnutia). Implementoval som priamo (Sonnet), následne
spustil nezávislú bezpečnostnú revíziu cez Task subagenta na Opus modeli
pred commitom.

Vopred vyjasnené s Janikou (AskUserQuestion):

1. Po F4 (najcitlivejšia časť) urobiť pauzu na jej kontrolu pred F5–F8.
2. Vercel doména `majetok.futbalsfz.sk` sa má pridať teraz k projektu
   `inventario-app` — Janika ma opravila, že `inventario-app` je appka,
   `inventario-web` je marketingový web, `inventario-docs` dokumentácia
   (zapísané do pamäte, `janik-vercel-projekty-nazvy.md`). Nemám k
   dispozícii Vercel MCP nástroj na pridanie domény — treba urobiť
   manuálne cez Vercel dashboard (viď nižšie).

## F4a — Dynamický CORS (backend)

Nový súbor `apps/api/src/modules/organisations/dynamic-cors.ts` —
`createDynamicCorsOrigin(app)` vracia `@fastify/cors` v10 async origin
funkciu. Statický zoznam `CORS_ORIGINS`/`'*'` sa kontroluje ako doteraz v
`server.ts`; Origin mimo neho sa navyše overí proti
`Organisation.customDomain` v DB (`findByCustomDomain`, presný `$eq`).

Bezpečnostné pravidlá: presná zhoda hostname (žiadny wildcard), fail
closed pri chybe DB, 60s in-memory cache.

## F4b — Host-aware middleware (frontend)

Nový súbor `apps/web/middleware.ts` (Next.js 15 Edge Middleware).
Kanonické hostname (`app.inventario.estate`, `app.inventario.sportup.sk`,
`*.vercel.app`, dev localhost) prechádzajú bez zásahu. Neznámy `Host` sa
overí cez `GET /v1/public/organisations/login-context?domain=` (rovnaký
endpoint ako F1/F2). Bez zhody → 404. So zhodou: `/` alebo `/tenant-login`
→ rewrite na `/tenant-login` (F6, stránka zatiaľ neexistuje — neškodné,
kým žiadna org nemá `customDomain` nastavený, čiže middleware sa v praxi
správa ako no-op). Akákoľvek iná cesta → redirect na
`app.inventario.estate`.

## Nezávislá bezpečnostná revízia (Opus subagent)

Poslal som oba súbory (plný obsah) + `server.ts` diff + kontext (ADR,
cookie `sameSite: 'none'` na `.inventario.estate`) na review. Zameranie:
host header trust, CORS origin bypass, cache poisoning, fail-open bugy,
DNS-hijack reziduálne riziko, open-redirect v middleware.

**Verdikt: safe to ship with minor fixes.** Should-fix položky opravené:

1. **Rate limit na `login-context`** by mohol middleware (zdieľané Vercel
   edge egress IP pre všetky domény naraz) globálne priškrtiť pre
   legitímne tenanty. Fix: `keyGenerator` kombinuje `${ip}:${slug ?? domain}`
   namiesto čistého per-IP kľúča (`public-login-context.routes.ts`).
2. **CORS porovnával len hostname**, nie schému/port — `http://tenant.sk`
   aj `https://tenant.sk:8443` by prešli pre `customDomain: 'tenant.sk'`.
   Fix: `dynamic-cors.ts` teraz vyžaduje presne `https:` a žiadny port.
3. **Nice-to-have opravené aj tak:** strop veľkosti cache (1000 záznamov,
   jednoduchý clear namiesto LRU) v oboch cache-och; dev hostname
   (`localhost`/`127.0.0.1`) v middleware len mimo `NODE_ENV=production`.
4. **Confirmed non-issue:** `!origin → true` v oboch súboroch (CORS nie je
   autentifikačná hranica), `.vercel.app` suffix check je dot-anchored
   (žiadny `evilvercel.app` bypass), redirect na fixný `CANONICAL_APP_URL`
   nie je open-redirect.
5. **Zdokumentované, nie opravené teraz** (závisí od F5): `customDomain`
   write path musí ukladať lowercase, bez schémy/cesty/portu — presne to,
   čo ADR-0035 F5 už špecifikuje ("žiadny protokol, žiadna cesta,
   lowercase"). Komentár v `dynamic-cors.ts` na to explicitne odkazuje.

## Testy

Nový `apps/api/tests/integration/dynamic-cors.test.ts` — jednotkové testy
priamo na `createDynamicCorsOrigin()` (bez `app.inject`): presná zhoda,
zamietnutie http/neštandardného portu, no-oracle pre neregistrovanú
doménu, soft-deleted org, chýbajúci/nevalidný Origin, žiadne
wildcard/prefix matchovanie, cache funguje (druhé volanie po zmazaní org
z DB stále `true` v rámci TTL).

`tsc --noEmit`, `eslint`, `prettier --check` čisté na všetkých dotknutých
súboroch (backend aj frontend). `vitest` sa v sandboxe nedá spustiť
(rovnaký known limit — chýbajúci `@rollup/rollup-linux-arm64-gnu`).

## Čo zostáva urobiť lokálne (Janika)

```bash
pnpm --filter api test tests/integration/dynamic-cors.test.ts
```

**Manuálny krok mimo kódu** (nemám na to Vercel MCP nástroj): pridať
`majetok.futbalsfz.sk` ako doménu k projektu **`inventario-app`** (nie
`inventario-web`!) cez Vercel dashboard → Project → Settings → Domains →
Add Domain. Vercel po pridaní ukáže presnú CNAME hodnotu na nastavenie v
DNS pre `futbalsfz.sk`. Tento krok môže prebehnúť paralelne s F5/F6 —
DNS/SSL onboarding trvá, kým sa napíše zvyšný kód.

## Čo zostáva (F5–F8)

- **F5** — UI `/settings/auth`: sekcia "Vlastná doména", validácia
  (lowercase, žiadny protokol/cesta), stavový indikátor.
- **F6** — `/tenant-login` stránka (branding + filtrované metódy + OAuth
  linky + email/heslo `fetch` flow + redirect na `app.inventario.estate`
  po úspešnom prihlásení).
- **F7** — testy F4–F6 end-to-end (momentálne má F4 len jednotkové testy
  resolvera, nie skutočný cross-origin/middleware integration test).
- **F8** — docs (user-guide vlastná doména, zatvoriť TODO #26 úplne).

Nezačaté, čaká na Janikino potvrdenie po otestovaní F4.
