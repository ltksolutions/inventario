<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-07-15 (ďalšie pokračovanie) — ADR-0035 Fáza 1: org-aware `/login`

## Kontext

Nadväzuje na `docs/TODO.md` #26 (nahlásené Janikou skôr v ten istý deň):
`/login` nezohľadňoval `allowedAuthProviders` organizácie. Janika navrhla
mikro-obrazovku prihlásenia na vlastnej doméne organizácie (napr.
`majetok.futbalsfz.sk`). Návrh spísaný ako
`docs/decisions/0035-tenant-custom-domain-login.md` — dvojfázový plán,
Fáza 1 (org-aware `/login` bez custom domény) ako základ pre Fázu 2
(custom domain host-routing). Po schválení ("poďme do toho") som
implementoval Fázu 1 (F1–F3).

## F1 — `GET /v1/public/organisations/login-context`

Nový súbor `apps/api/src/modules/organisations/public-login-context.routes.ts`
— verejný, neautentifikovaný endpoint, rovnaký vzor ako
`GET /v1/public/scan/:publicToken` (ADR-0021): explicitný whitelist polí,
rate-limited 30/min/IP, 404 no-oracle pre neexistujúci/zmazaný záznam.

- Query: presne jeden z `slug`/`domain` (400 ak oba alebo žiadny).
- Response: `displayName`, `logoUrl`, `brandColors` (primary/primaryFg/
  accent/accentFg), `allowedAuthProviders`, `hasEntraRestriction` (boolean
  — nikdy samotný `entraTenantId`).
- Zaregistrovaný v `server.ts` hneď za `organisationsRoutes`.
- `openapi.json` doplnené ručne (rovnaký dôvod ako v predchádzajúcich
  session — `export-openapi.ts` v sandboxe nejde spustiť, chýba natívny
  `@esbuild/linux-arm64` binár). `openapi-typescript` regen `api-types.ts`
  **funguje** v sandboxe (nepotrebuje esbuild) — spustené priamo.

## F2 — `LoginPage.tsx` org-aware

- Číta `?org=<slug>` z URL. Ak je prítomný, zavolá `login-context`
  endpoint a filtruje zobrazené metódy podľa `allowedAuthProviders`
  (email formulár, passkey tlačidlo, Google/Microsoft tlačidlá,
  divider). Bez `?org=` sa stránka správa presne ako predtým — žiadna
  regresia pre existujúce linky/pozvánky bez hintu.
- Zlyhanie fetchu (404/sieť) sa ticho ignoruje → bezpečný fallback na
  "zobraz všetko", nikdy nikoho nevyzamkáva.
- Branding: znovupoužitý `buildBrandStyle()` z `BrandProvider.tsx`
  (ADR-0028) — vloží rovnaký `:root[data-tenant=...]` CSS override a
  `data-tenant` atribút, takže existujúce `bg-brand-primary`/
  `text-brand-primary-fg` triedy na stránke automaticky použijú farby
  organizácie. Logo (`<img>`, rovnaký vzor ako `AppShell.tsx`) a názov
  organizácie nahradia generický Inventario branding.
- `handleSso()` teraz posiela `?org=` hint aj na OAuth redirect (aktivuje
  existujúci ADR-0031 E4 mechanizmus pre per-tenant Microsoft app).
- Doplnené `ERROR_MESSAGES` pre `provider_not_allowed` a
  `entra_tenant_mismatch` (predtým padali na všeobecné "Nastala chyba").

## F3 — testy

Nový `apps/api/tests/integration/public-login-context.test.ts` — happy
path (slug aj domain lookup, hasEntraRestriction, brandColors s/bez
brandKit), validácia (400 pre 0/2 parametre), privacy (404 no-oracle pre
neexistujúci/zmazaný záznam, whitelist bez `entraTenantId`), bez-auth
kontrola.

`tsc --noEmit`, `eslint`, `prettier --check` čisté na všetkých dotknutých
súboroch (backend aj frontend). `vitest` sa v sandboxe nedá spustiť
(rovnaký known limit — chýbajúci `@rollup/rollup-linux-arm64-gnu`).

## Čo zostáva urobiť lokálne (Janika)

```bash
pnpm --filter api test tests/integration/public-login-context.test.ts
```

Po overení: commit + push (git MCP, ako obvykle), potom manuálne
overiť na `/login?org=<slug-testovacej-org>` v prehliadači, že sa
zobrazia len povolené metódy.

## Čo zostáva (Fáza 2, ADR-0035 F4–F8)

Vlastná doména (`majetok.futbalsfz.sk`) — host-aware middleware v
`apps/web`, UI v `/settings/auth` na nastavenie `customDomain`,
dynamický CORS pre email/heslo cez cudziu doménu. Nezačaté, čaká na
ďalšiu session.
