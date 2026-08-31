<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT

Pracovný zoznam — **len to, čo je otvorené alebo plánované**. História
hotových stavov je v `NEXT-archiv.md`.

Pravidlo: keď je vec hotová a nasadená, ide von odtiaľto. Session log
zostáva zdrojom detailov, `CHANGELOG.md` zdrojom toho, čo sa zmenilo.
Dokumentácia je indícia, `git log` je pravda — pred tvrdením „toto je
ešte otvorené" over v gite, či sa to medzitým nevyriešilo.

---

## Najbližšie kroky (kód)

- **Sériová auth reťaz na dashboarde.** Dashboard query čaká na
  `/v1/auth/me` (`enabled: isAuthenticated`), lebo potrebuje vedieť, že
  je používateľ prihlásený. Zisk zo súbežného spustenia by bol ~0,6 s
  (1,84 → ~1,2 s). Otázka je, či to stojí za komplikáciu s obnovou
  vypršaného tokenu. Kontext: `2026-08-31-pomale-nacitanie-dashboardu.md`.
- **Dependabot PR #19** (`actions/setup-node` 6 → 7) — Markdown job je po
  oprave odkazov zelený, Unit Tests tiež. Červený zostáva len OpenAPI
  job, ktorý má `continue-on-error`. PR je pripravený na merge.
- **OpenAPI lint** (`docs.yml`, job `openapi`) — stále
  `continue-on-error: true`, kým sa nedorieši posledná skupina chýb.
  `operationId` je hotový (31. 8., odvodzuje sa v `plugins/swagger.ts`).
  Zostáva **163× `nullable: true`**, čo v OpenAPI 3.1 neexistuje —
  správne je `type: [..., null]`. Nie je to na ručnú opravu: `nullable`
  generuje Zod → JSON Schema konverzia
  (`fastify-type-provider-zod`), takže sa to rieši buď jej konfiguráciou,
  alebo prevodom v `scripts/openapi-to-yaml.ts`. Kým je
  `continue-on-error` zapnuté, job nič nestráži — presne tá istá pasca,
  v akej bol Markdown job do 31. 8.
- **GitHub Discussions** — v repozitári nie sú zapnuté (Settings →
  Features), ale `docs/user-guide/support.md` na ne odkazuje. Odkaz je
  zatiaľ v `ignorePatterns` link checkera; po zapnutí ten pattern
  odstrániť.

## Úklid v kóde (nice-to-have, nie blocker)

- **`apps/web/src/lib/api-hooks.ts`** — dočasné pretypovanie
  `apiClient.GET` / `apiClient.POST` v `useBorrowerBorrowedItems` a
  `useReturnItemsFromBorrower`. Vzniklo, kým `api-types.ts` nepoznalo
  nové endpointy; po `generate:api-types` sa dá zrušiť. Čistý úklid,
  nie funkčná zmena.
- **`DateField`** — klávesnicová navigácia šípkami v mriežke, a11y
  audit, živé odskúšanie flip-up v prehliadači.
- **Vercel function región** — zvážiť pinnutie bližšie k regiónu
  MongoDB Atlas. Pozorované `iad1` / `sfo1` / `fra1`, teda deploy môže
  skončiť aj za oceánom od databázy vo Frankfurte.

## Živé overenie na hardvéri

- **Zebra ZD420 + Browser Print** — softvérové blokácie sú odstránené
  (LNA address space, CORS preflight), fyzický test ešte neprebehol:
  čitateľnosť QR, diakritika, sýtosť. Safari ostáva nepodporované
  (mixed-content blok, vedomé rozhodnutie z 15. 7.).

## Ops mimo kódu (Janika)

- **Atlas** — zmazať cluster `inventario-dev` (M10, prázdny, ~58 USD/mes.);
  zmazať mŕtve repo secrets `MONGO_URI_TEST`, `ENTRA_API_CLIENT_ID_TEST`,
  `ENTRA_TENANT_ID_TEST`; vyriešiť Preview `MONGO_URI` vo Verceli (ukazuje
  na cluster, ktorý sa má zmazať); prekontrolovať projekt `contineo.app`
  (rovnaký M10 podpis, 11,50 → 65,20 USD).
- **Zálohovanie produkcie** — `inventario-prod` je Flex, teda 8 denných
  snapshotov, bez vlastnej politiky, bez on-demand snapshotov a **bez
  Point-in-Time restore**. Reálne RPO až 24 h, vedome prijaté (M10 by
  stálo tých istých ~58 USD/mes.). Otvorené: overiť v Atlas → Backup, že
  snapshoty naozaj existujú; spraviť DR test (restore nanečisto — stály
  otvorený bod od júna); skontrolovať, či `docs/compliance/` netvrdí o
  zálohovaní viac, než Flex reálne poskytuje.
- **Apple Sign-In** — Apple Developer credentials + `APPLE_*` env
  premenné.
- **Bezpečnosť** — rotácia produkčného Mongo hesla; voliteľné vyčistenie
  demo dát z produkcie.

## Pre-GA / neskôr

- `@axe-core/cli` v CI proti nasadenému `apps/web`.
- Súkromné blob URL pre citlivé doklady.
- E2E test protokolov s dvomi účtami.
- `EMAIL_PROVIDER=ecomail` pre Preview; odvolať mail-tester pozvánku.
- CSV export z Audit logu (zámerne mimo v1).
- Bulk invite cez CSV; per-tenant override e-mailového providera.
- `test-jwt-loader` → migrácia na `provisionUser()`.
- MCP server (Slice #10, plánované Q1 2027).

---

## Vedomé rozhodnutia (nie otvorené body)

Veci, ktoré vyzerajú ako nedorobok, ale sú tak zvolené — aby sa
neotvárali dokola.

- **Swagger v produkcii ostáva zapnutý.** Vercel projekt
  `inventario-api` má `ENABLE_SWAGGER` nastavenú explicitne (Production
  - Preview) a prebíja default odvodený od `NODE_ENV` v `config.ts`,
    takže `/docs` na produkčnom API funguje. Swagger stál z cold startu
    ~45 ms — vedľa 1,75 s ušetrených inde je to zanedbateľné — a nič
    neodhaľuje, keďže repo je verejné aj s OpenAPI schémou. Default v
    kóde slúži ako poistka, keby premennú niekto odstránil.
- **`inventario-prod` ostáva na Flex tieri** napriek limitom záloh
  (viď vyššie). M10 by stálo ~58 USD/mes. za funkcie, ktoré pri 4 MB
  dát nepotrebujeme.
- **`apps/api/.env.local` mieri na produkciu.** Vedome prijaté riziko.
- **Safari nepodporuje Zebra tlač** (mixed-content blok). Rozhodnutie
  z 15. 7., nebudeme obchádzať.

---

## Referencie

- Archív hotových stavov: `docs/sessions/NEXT-archiv.md`
- Session logy: `docs/sessions/`
- ADR: `docs/decisions/`
- TODO.md: #18 (legacy roles endpoint)

## Pozn. pre Cowork prostredie

V Cowork beží terminál + filesystem priamo na disku — žiadny
`copy_file_user_to_claude` workaround. `pnpm typecheck` / `pnpm test` /
`pnpm build` možno spúšťať priamo. Git cez MCP alebo GitHub Desktop
(GPG signing).
