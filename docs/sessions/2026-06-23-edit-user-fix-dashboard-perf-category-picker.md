<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Edit user 404 fix · preloadery · dashboard perf · zoskupený výber kategórie (2026-06-23)

> **Účel.** Séria opráv a vylepšení nahlásených pri testovaní na `app.inventario.estate`:
> nefunkčný edit používateľa, chýbajúce preloadery, pomalý dashboard, popis príjemcu
> v žiadosti a nový zoskupený autocomplete výber kategórie. Všetko commitnuté a pushnuté
> na `main` (Vercel auto-deploy).

## Čo sa spravilo

### 1. Edit používateľa padal na 404 pre cross-tenant členov (`d084f0a`)

Modal „Upraviť používateľa" visel na nekonečnom loadingu. Príčina (potvrdená cez
Network → `GET /v1/users/:id` = **404**): zoznam (`UsersService.list`) bol migrovaný na
rezolúciu cez **memberships**, ale `getById` aj `update` (PATCH) stále filtrovali cez
`User.organisationId`. Cross-tenant pozvaní používatelia nesú pôvodné `organisationId`,
takže sa v zozname zobrazili, ale detail/uloženie ich nenašli.

- `users.repository.ts`: `findByIdUnscoped` + `updateByIdUnscoped` (bez org filtra).
- `users.service.ts` `getById`/`update`: prístup gated cez **aktívne membership** v tenante
  (zachovaná izolácia — nečlen → 404), načítanie/zápis podľa `_id`.
- `UserEditDialog.tsx`: `isError` sa vyhodnocuje **pred** loading gate — errored query
  (`!initialised` navždy true) inak visela na shimmeri namiesto chyby.
- Latentne ten istý vzor ostáva v `clearMfa`/`setRestriction` (mimo rozsahu).

### 2. Zdieľaný Spinner/LoadingState + plošné nasadenie (`e55525a`, `7c7e376`)

- Nový `Spinner.tsx`: `Spinner` (inline ikona) + `LoadingState` (vystredený spinner +
  viditeľný štítok) — centralizuje dovtedy ~15× kopírovaný `Loader2 + animate-spin`.
- Edit modal: nenápadný shimmer → `LoadingState`.
- Blokové (vystredené/panelové) loadery nahradené `LoadingState` v 7 súboroch
  (AssetDetailContent, SecurityContent, AuthSettingsContent, InvitationsContent,
  MembersContent, ScanPage, AcceptInvitePage). Inline tlačidlové spinnery a `Skeleton`
  zoznamy ponechané zámerne (podľa dizajn-systému).

### 3. Dashboard performance — 1 request namiesto ~10 (`14cf535`, `b78619d`, `26b1778`)

Dashboard strieľal ~10 paralelných requestov (4 count-y + 3× loan-requests + protokoly +
výpožičky), každý cez auth middleware.

- Nový modul `dashboard`: `GET /v1/dashboard/summary` — všetko v jednom `Promise.all`.
  RBAC sa **nezduplikuje**: zoznamy cez existujúci `loansService` (EMPLOYEE len vlastné),
  protokoly cez `participantUserId` (reuse exportovaných helperov z `protocols.routes`),
  counts cez repá. Registrované po `loan-requests` + `protocols`.
- Frontend: `useDashboardSummary()`; `DashboardContent` aj `PendingActionsPanel` čítajú
  z jedného hooku → React Query dedup → 1 sieťový request.
- `openapi.json` regenerovaný (CI `openapi:export --check`).
- Indexy `{organisationId, deletedAt}` na assets/categories/locations (count-y).
- `useMe()` na dashboarde nahradený `useAuth().user` (user už načítaný v auth kontexte) →
  odpadol aj posledný `/v1/me` request.

### 4. Pre-commit hook: auto-refresh `openapi.json` (`1e45370`)

`.husky/pre-commit` — pri zmene `apps/api/src/` automaticky spustí
`openapi:export:offline` (in-process MongoMemoryServer, netreba bežiacu Mongo) a pridá
`apps/api/openapi.json` do commitu. Zabráni padaniu CI kvôli zabudnutej regenerácii.
Preskočiteľné cez `--no-verify`.

### 5. Žiadosť o výpožičku — popis príjemcu (`11fed64`)

Výber osoby nemal viditeľný label. Pridaný nadpis „Pre koho žiadate" + popis, že ide
o príjemcu (predvolene prihlásený používateľ).

### 6. Zoskupený autocomplete výber kategórie (`3b0448b`, `6f30954`)

Plochý `SelectField` (bez hľadania, neusporiadaný, root+child pomiešané, duplicity)
nahradený rozšíreným `Combobox`om:

- `Combobox`: nové voliteľné props `groupOf` (hlavičky skupín, `role="presentation"` —
  klávesnicová navigácia nedotknutá) a `visibleLimit`. Spätne kompatibilné.
- Zdieľaný helper `buildGroupedCategoryOptions` (`category-tree.ts`) — `options` +
  `groupById` (skupina = root), len podkategórie + childless root vyberateľný,
  osamotené → „Ostatné", sk collator.
- Nasadené v **žiadosti** (`LoanRequestContent`) aj **pridaní majetku**
  (`AssetCreateContent`, predtým „cesta" labely `buildCategoryOptions`).
- `buildCategoryOptions`/`categoryPath` ponechané (používa edit formulár majetku).

## Otvorené / follow-up

- `clearMfa` / `setRestriction` v `users.service` majú rovnaký org-scoped vzor ako bol
  `getById` — pri cross-tenant členoch by padli na 404 (nice-to-have fix).
- Edit formulár majetku (`AssetDetailEditForm`) stále používa „cesta" labely
  `buildCategoryOptions` — pre úplnú konzistenciu možno prepnúť na zoskupený picker.
- Voliteľne zahrnúť `user` aj do `dashboard/summary` (teraz rieši `useAuth`).

## Pozn. k prostrediu (Cowork sandbox)

`pnpm`/`vitest`/`tsx` v sandboxe nebežia spoľahlivo — `node_modules` sú pre macOS
(chýba linux `esbuild`/`rollup`), a `fastdl.mongodb.org` je blokovaný allowlistom
(`openapi:export` potrebuje bootnúť API s Mongo). Overovalo sa cez `tsc --noEmit` +
`eslint` (fungujú); `openapi.json` regeneroval Janika lokálne. Commit + push cez git MCP
(GPG signed).

## Commity (2026-06-23)

`d084f0a` · `e55525a` · `7c7e376` · `14cf535` · `b78619d` · `26b1778` · `1e45370` ·
`11fed64` · `3b0448b` · `6f30954` (+ tento „poupratuj" docs commit).
