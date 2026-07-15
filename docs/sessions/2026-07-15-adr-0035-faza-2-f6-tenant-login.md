<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-07-15 (siedme pokračovanie) — ADR-0035 Fáza 2: F6 /tenant-login stránka

## Kontext

Po overení F5 (Janika lokálne, 63/63 testov, po ceste opravená Zod
`.regex()`/`.toLowerCase()` poradová chyba) sme pokračovali do F6 —
stránka `/tenant-login`, ktorú `apps/web/middleware.ts` (F4) rewrituje
pre registrovanú vlastnú doménu.

Pred implementáciou dve architektonické rozhodnutia (AskUserQuestion,
Janika zvolila odporúčaný variant v oboch):

1. **OAuth `?org=` hint na vlastnej doméne** — `login-context` (F1)
   nevracal `slug`, len branding/allowedAuthProviders. Riešenie: doplniť
   `slug` do response (bezpečné, slug je verejný údaj už dnes v
   `?org=<slug>` odkazoch) — jednoduchšie než prerábať OAuth routing na
   `?domain=` hint priamo.
2. **Štruktúra stránky** — nová samostatná `/tenant-login` stránka so
   zdieľanou logikou vytiahnutou z `LoginPage.tsx`, nie rozšírenie
   `LoginPage.tsx` o `?domain=`.

Mimoriadka počas session: Janika nahlásila Zebra tlač "Load failed" v
Safari (screenshot). Diagnostika (subagent, read-only): Safari blokuje
`http://localhost:9100` z HTTPS stránky ako mixed content (Chrome/Edge
to tolerujú); kód aj docs boli testované len na Chrome/Edge, Safari
nikdy zohľadnená. Janika sa rozhodla nič v kóde nemeniť — len odporúčať
Chrome/Edge pre Zebra tlač (existujúci návod to už robí).

## F6a — `slug` do login-context response

`apps/api/src/modules/organisations/public-login-context.routes.ts` —
nové pole `slug` v `PublicLoginContextResponseSchema` aj vo `view`
objekte. Rozšírený whitelist test (`public-login-context.test.ts`) +
nový test overujúci `slug` v response.

## F6b — zdieľaná login logika

Vytiahnuté z pôvodnej `LoginPage.tsx`:

- **`apps/web/src/lib/useOrgAwareLogin.ts`** — hook parametrizovaný
  `OrgHint` (`{ kind: 'slug' | 'domain', value: string }`), vracia
  loginContext, form state, `handleEmailLogin`/`handlePasskeyLogin`/
  `handleSso`. Prijíma `redirectAfterLogin` callback — `/login` používa
  `router.push` (same-origin SPA), `/tenant-login` plnú navigáciu.
  `handleSso` teraz vždy použije `loginContext.slug` pre `?org=` hint
  (funguje aj keď sme sa pýtali cez `?domain=`).
- **`apps/web/src/components/OrgAwareLoginForm.tsx`** — prezentačná
  komponenta (branding, formulár, SSO tlačidlá), `showRegisterLink`
  prop (vypnuté na `/tenant-login`).
- **`apps/web/src/lib/loginErrorMessages.ts`** — zdieľaná `?error=`
  mapa (predtým len v `LoginPage.tsx`).

`LoginPage.tsx` je teraz tenký wrapper (banners + `useOrgAwareLogin` s
`?org=` hintom).

## F6c — `/tenant-login` stránka

`apps/web/src/components/TenantLoginPage.tsx` + `apps/web/src/app/
tenant-login/page.tsx`. Číta `?domain=` (doplnené middlewarom pri
rewrite), `redirectAfterLogin` robí `window.location.href` na
`NEXT_PUBLIC_CANONICAL_APP_URL` (default `https://app.inventario.
estate`) — appka sa pod vlastnou doménou nikdy priamo nevykresľuje.
OAuth callback (`oauth.routes.ts`) vždy presmeruje na canonical
`FRONTEND_BASE_URL/login?error=...`, nikdy na `/tenant-login` — banner
tam ponechaný len pre konzistenciu/priamy odkaz.

## Testy a overenie

Rozšírený `public-login-context.test.ts` (F6a). `tsc --noEmit`,
`eslint`, `prettier --check` čisté na celom F6 changesete (backend aj
frontend). `vitest` v sandboxe sa nedá spustiť (známy limit).

## Čo zostáva urobiť lokálne (Janika)

```bash
pnpm --filter api test tests/integration/public-login-context.test.ts
```

Manuálne end-to-end overenie `/tenant-login` (email/heslo + branding
pre `majetok.futbalsfz.sk`) nie je možné v sandboxe — vyžaduje reálny
DNS/Vercel doménový setup z F4, ktorý je na Janikinej strane.

## Čo zostáva (F7–F8)

- **F7** — end-to-end testy F4–F6 (F4 má jednotkové testy resolvera,
  F5/F6a majú integration testy na PATCH/GET, chýba skutočný
  cross-origin/middleware-rewrite test).
- **F8** — docs (user-guide vlastná doména, zatvoriť TODO #26 úplne).

Nezačaté, čaká na Janikino potvrdenie po otestovaní F6a.
