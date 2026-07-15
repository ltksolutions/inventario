<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-07-15 (šieste pokračovanie) — ADR-0035 Fáza 2: F5 UI vlastná doména

## Kontext

Po overení F4 (Janika lokálne, 9/9 testov) pôvodný plán bol pokračovať
priamo do F5 — UI v `/settings/auth` na nastavenie `customDomain`. Počas
implementácie sa ale objavil skutočný konflikt: existujúci kód mal
zámerný komentár, že `customDomain` (spolu s `plan`/`status`/`slug`) je
**platform-operator concern**, nie niečo, čo si tenant ADMIN nastaví sám
cez self-service `/settings/auth`.

Podľa pravidla „vždy sa spýtať pri konflikte/nejasnosti" som prácu
zastavil a položil Janike explicitnú otázku s tromi možnosťami. **Jej
odpoveď: "Tenant ADMIN sám v /settings/auth"** — potvrdila pôvodný plán
ADR-0035 F5, čo si vyžiadalo zmenu existujúceho obmedzenia.

## Zmeny

**Backend** (`organisations.routes.ts`):

- `customDomain` presunuté z platform-operator-only zoznamu do
  `UpdateOwnOrganisationBodySchema` — FQDN regex (lowercase, bez
  protokolu/cesty/portu), `.toLowerCase()` normalizácia, `nullable()`.
- Komentár nad schémou aktualizovaný — vysvetľuje presun a odkazuje na
  kolízny check.

**Backend** (`organisations.service.ts`):

- `updateCurrent()` — nový kolízny check (rovnaký vzor ako
  platform-operator `update()`): ak sa `customDomain` mení a inú
  organizácia už tú doménu má, vráti `400` so správou
  `Vlastná doména "..." je už používaná iným tenantom.` No-op zápis
  (rovnaká hodnota, aká už je) kolíziu nevyhodí.

**Frontend** (`AuthSettingsContent.tsx`):

- Nová karta „Vlastná doména pre prihlásenie" medzi „Entra Tenant ID" a
  „Microsoft aplikácia" — stavový badge (Nastavená/Nenastavená), input s
  klientskou FQDN validáciou, DNS CNAME návod.
- `customDomain` doplnené do `OrgAuthSettings` interface, `loadSettings`,
  `handleSave` (validácia + PATCH body).

## Testy

Rozšírený `apps/api/tests/integration/organisations.test.ts` (blok
`PATCH /v1/organisations/current`), 7 nových testov:

- ADMIN nastaví `customDomain`, GET/current ho vráti.
- Lowercase normalizácia bez ohľadu na vstup.
- Neplatný formát (URL s protokolom/cestou) → 400.
- Kolízia s doménou iného tenanta → 400 so správou obsahujúcou doménu.
- `null` vynuluje nastavenú doménu.
- No-op zápis rovnakej hodnoty neprejde kolíznym checkom.

Drive-by oprava: mojibake v komentári (`ეlen` → `člen`, gruzínsky znak
namiesto slovenského "č" z predchádzajúcej session).

`tsc --noEmit`, `eslint`, `prettier --check` čisté na všetkých dotknutých
súboroch. `vitest` sa v sandboxe nedá spustiť (známy limit — chýbajúci
`@rollup/rollup-linux-arm64-gnu`) — Janika spustí lokálne.

## Čo zostáva urobiť lokálne (Janika)

```bash
pnpm --filter api test tests/integration/organisations.test.ts
```

## Čo zostáva (F6–F8)

- **F6** — `/tenant-login` stránka (branding + filtrované metódy + OAuth
  linky + email/heslo `fetch` flow + redirect na `app.inventario.estate`
  po úspešnom prihlásení). Bez tejto stránky je F4 middleware stále
  no-op v praxi — rewrite cieli na stránku, ktorá ešte neexistuje.
- **F7** — end-to-end testy F4–F6 (F4 má zatiaľ len jednotkové testy
  resolvera, F5 má integration testy na PATCH, chýba skutočný cross-origin
  test cez middleware).
- **F8** — docs (user-guide vlastná doména, zatvoriť TODO #26 úplne).

Nezačaté, čaká na Janikino potvrdenie po otestovaní F5.
