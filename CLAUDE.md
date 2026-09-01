# CLAUDE.md — Inventario

> Konvencie tohto repozitára. Globálne pravidlá (jazyk, plánovanie, zákaz
> mazania súborov, rituály „Zorientuj sa / Poupratuj / Odovzdaj /
> Rozhodni") sú v mojich Instructions for Claude a tu sa neopakujú.

## 1. Čo to je a ako to rozbehať

Inventario je multi-tenant white-label platforma na **evidenciu a
vypožičiavanie majetku** (nie účtovný systém) so systémom žiadostí.
Produkcia beží, SFZ pilot je live.

- **Monorepo**: pnpm workspaces + Turborepo
  - `apps/api` — **Fastify** + TypeScript, REST, OpenAPI 3.1, beží na Vercel
  - `apps/web` — Next.js 15 App Router + React 19 + Tailwind 3
  - `apps/docs` — Nextra dokumentácia
  - `packages/shared-types` — Zod schémy a typy zdieľané API ↔ web
  - `packages/design-tokens` — brand kit, Tailwind preset, CSS tokeny
- **Databáza**: MongoDB Atlas, oficiálny `mongodb` driver, **bez ODM**
- **Hosting**: Vercel, 4 projekty nad tým istým repom — `inventario-api`,
  `inventario-app`, `inventario-web`, `inventario-docs`
- **Testy**: Vitest

Lokálny beh (detaily v `README.md` a `infra/README.md`):

```bash
pnpm install
docker compose -f infra/docker-compose.yml up -d   # Mongo, Mongo Express, MailHog
pnpm --filter @inventario/api dev                  # API + /docs (Swagger)
pnpm --filter @inventario/web dev                  # web
pnpm test                                          # celé monorepo cez turbo
```

**Verzie sú pribité**: Node `24.15.0`, pnpm `9.12.0` (`engines`
v `package.json`, `NODE_VERSION` v CI). Novšie Node lokálne zhodí `pnpm`
na `ERR_PNPM_UNSUPPORTED_ENGINE` — nezvyšuj `engines`, aby to „prešlo",
bez rozhovoru so mnou.

**Premenné prostredia**: zdroj pravdy je Zod schéma v
`apps/api/src/plugins/config.ts`; `.env.example` je jej zrkadlo
(zosynchronizované 2026-09-01). Nový kľúč doplň na **tri** miesta:
`config.ts`, `.env.example` a `turbo.json` → `globalEnv` — bez tretieho
ho Turborepo do buildu nepustí.

## 2. Kánon súborov

| Súbor / adresár                       | Na čo je                                         |
| ------------------------------------- | ------------------------------------------------ |
| `README.md`                           | Čo to je + rozbehanie                            |
| `CLAUDE.md`                           | Konvencie repa (tento súbor)                     |
| `ARCHITECTURE.md`                     | Mapa kódu — moduly, dátové toky, hranice balíkov |
| `docs/architecture/`                  | High-level architektúra, dátový model, MCP       |
| `docs/decisions/NNNN-nazov.md`        | ADR — jedno rozhodnutie = jeden súbor            |
| `docs/sessions/NEXT.md`               | Otvorené veci a ďalšie kroky                     |
| `docs/sessions/NEXT-archiv.md`        | Uzavreté body z NEXT.md                          |
| `docs/sessions/YYYY-MM-DD-<topic>.md` | Session log = devlog                             |
| `CHANGELOG.md`                        | Keep a Changelog + SemVer                        |
| `RUNBOOK.md`                          | Deploy, rollback, čo robiť keď to spadne         |
| `CONTRIBUTING.md`                     | Pravidlá pre externých prispievateľov, DCO       |
| `.env.example`                        | Kľúče bez hodnôt (pozri varovanie v sekcii 1)    |

Zdroj pravdy pri rozpore: **kód → git log → ADR → NEXT.md → session log**
(vyhráva ľavá strana). NEXT.md a session logy môžu byť zastarané — pred
tvrdením „toto je ešte otvorené" over v `git log`.

## 3. Git

- **Ja (maintainer) commitujem priamo do `main`**, push robím ručne cez
  GitHub Desktop alebo si ho vyžiadam. Claude commituje do `main` len keď
  to v danej úlohe výslovne dohodneme.
- **`main` je vždy nasaditeľný** — každý push do `main` spúšťa produkčný
  deploy na Vercel.
- **Externí prispievatelia idú cez vetvu + PR + squash merge** podľa
  `CONTRIBUTING.md` (`feat/`, `fix/`, `docs/`, `refactor/`).
- Commity podľa Conventional Commits: `feat:`, `fix:`, `docs:`,
  `refactor:`, `chore:`, `test:`, `ci:`. Jeden commit = jedna logická
  zmena. Telo commitu odpovedá na **prečo**, nie na čo (to je v diffe).
- **DCO**: každý commit má `Signed-off-by:` (`git commit -s`). GitHub
  Action `dco-check` to vyžaduje v PR; drž to aj pri commitoch do `main`,
  nech je história jednotná.
- Zakázané bez môjho súhlasu: `force push`, rebase zdieľanej vetvy,
  mazanie vetvy.

### Commitlint — dve pasce

Obidve som už raz zaplatil, nezopakuj ich:

1. **Riadok v tele začínajúci `Slovo:`** sa parsuje ako footer token a
   commit padne na `footer-leading-blank`. Namiesto `NEXT.md:` napíš
   „Z NEXT.md ide von …".
2. **`Fix:` ako prefix bulletu** rozbije parsing z rovnakého dôvodu.

## 4. Session log (devlog)

Jeden súbor na session: `docs/sessions/YYYY-MM-DD-<topic>.md`, SPDX
hlavička `CC-BY-4.0`. Sekcia „Nefungovalo / zamietnuté" je povinná, keď
sa niečo zamietlo — to sa z git logu nikdy nedá vyčítať a pre kolegu je
to najcennejšia časť.

Do session logu patria **zmerané čísla**, nie dojmy: koľko warningov,
koľko testov, koľko milisekúnd, pred a po.

## 5. ADR (`docs/decisions/`)

- Kostra je v `docs/decisions/template.md` — **Kontext → Možnosti →
  Rozhodnutie → Dôsledky**, s hlavičkou Status / Dátum / Autori /
  Súvisiace ADR. Použi ju, nevymýšľaj vlastnú.
- Číslovanie priebežné, nikdy sa nerecykluje (aktuálne po `0036`).
- ADR sa needituje. Zmena rozhodnutia = nové ADR; v starom sa `Status`
  prepne na `Superseded by [ADR-XXXX]`.

## 6. Licencie a REUSE

Repo je **REUSE 3.3 compliant** a CI to overuje (`reuse` job v `ci.yml`).
Každý nový súbor potrebuje SPDX hlavičku:

- kód (`.ts`, `.js`, `.json`, konfigy) → `EUPL-1.2`
- dokumentácia (`.md`) → `CC-BY-4.0`

```ts
// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2
```

Generované súbory (`apps/api/openapi.json`, `docs/api/openapi.yaml`,
`apps/web/src/lib/api-types.ts`) sa needitujú ručne — regeneruj ich
skriptom.

## 7. Konvencie kódu

- Identifikátory (súbory, funkcie, typy, premenné, komponenty, kolekcie
  a polia v Mongu, pnpm skripty, URL a query kľúče) sú **anglicky**.
- Komentáre a texty pre používateľa sú **slovensky**.
- **i18n zatiaľ neexistuje** — texty sú v komponentoch po slovensky.
  Nezavádzaj i18n knižnicu ani nerozbíjaj texty do kľúčov bez toho, aby
  sme sa na tom dohodli a vzniklo ADR.
- Komentár vysvetľuje **prečo**, nie čo. Netriviálne rozhodnutie v kóde
  má pri sebe vetu s dôvodom — v tomto repe je to zaužívané a chcem to
  udržať.
- Rozhranie: **mobile-first**, overené na úzkom viewporte pred označením
  za hotové.

## 8. Stack — konvencie

### Fastify API (`apps/api`)

- Štruktúra: `plugins/` (infra: config, mongo, auth, error-handler,
  swagger, email), `modules/<domena>/` (routes + service + repository),
  `lib/` (čisté funkcie), `migrations/`.
- **`response` schéma nie je len dokumentácia.** `server.ts` registruje
  `serializerCompiler` z `fastify-type-provider-zod`, takže Fastify podľa
  nej odpoveď **serializuje** a neznáme kľúče zahodí. Pridanie
  `response: { 4xx: … }` mení runtime chovanie — pozri
  `docs/sessions/2026-09-01-openapi-chybove-odpovede.md`.
- Chybové odpovede skladá **centrálny** `plugins/error-handler.ts`.
  Handler nehádže vlastný `reply.send({ message })` — vyhodí
  `NotFoundError` / `BadRequestError` / `UnauthorizedError` /
  `ForbiddenError`. Tvar tela je `{ statusCode, error, message }`
  (+ voliteľné `details`, `issues`), Zod podoba je
  `src/lib/error-response.ts`.
- Chybové odpovede v OpenAPI sa **nedopisujú do rout** — dopĺňa ich
  `plugins/swagger.ts` pri generovaní dokumentu podľa značiek na
  `preHandler` hookoch, deklarovaného `security`, vstupnej schémy
  a parametra v ceste.
- Autorizácia je vždy `preHandler`: `requireAuth` → `loadCurrentUser` →
  `requireRole` / `requireMinRole`. Nikdy nie kontrola v tele handlera.
- Po zmene rout **vždy** `pnpm --filter @inventario/api openapi:sync`
  a `npx @redocly/cli lint docs/api/openapi.yaml`. CI job `openapi`
  overuje, že `openapi.json` v gite súhlasí s vygenerovaným, a `docs.yml`
  lintuje YAML naostro (bez `continue-on-error`).

### MongoDB Atlas

- Pripojenie výhradne cez `plugins/mongo.ts` (Fastify plugin, jeden pool
  na inštanciu). Nezakladaj druhého klienta.
- Typy kolekcií sú v `packages/shared-types`, používajú sa cez
  `db.collection<Asset>('assets')`.
- **Každý dotaz obsahuje tenant filter** (`organisationId`). Bez výnimky,
  aj pri administrátorských operáciách. Tenant scope drží `Membership`
  (ADR-0015), rola je na `Membership` (ADR-0029).
- Soft delete: dotazy filtrujú `deletedAt: null`.
- Zoskupovanie a spájanie agregačnou pipeline, nie slučkou v Node.
- `_id` je `ObjectId` interne, na string sa konvertuje až na hranici API.
- Nový index sa zakladá vedome a zapisuje do `docs/architecture/data-model.md`.
  Indexy v produkcii **nevznikajú pri cold starte** — vytvára ich
  `POST /v1/system/indexes/ensure` po deployi (viď `RUNBOOK.md`).
- Migrácie sú súbory v `src/migrations/` registrované v `runner.ts`,
  idempotentné, sledované v kolekcii `migrations`. **Novú migráciu ani
  zmenu schémy nerob bez môjho výslovného súhlasu.**

### Next.js web (`apps/web`)

- Server Components sú default. `"use client"` len tam, kde je naozaj
  potrebná interaktivita, a čo najnižšie v strome.
- `next/image` a `next/font` povinne.
- Typy API sa **generujú** z OpenAPI do `src/lib/api-types.ts`
  (`pnpm --filter @inventario/web generate:api-types`) a nie sú v gite —
  needituj ich ručne.
- Žiadne `any` v props ani v návratových typoch.
- Cachovanie sa nastavuje vedome (`revalidate`, `cache`). Zmena cache
  stratégie patrí do session logu.

### Vercel

- Prostredia: **Production** (`main`) + **Preview** (každý PR).
- Env premenné len cez Vercel dashboard a `.env.example` v repe. Nikdy
  hodnoty v kóde ani v gite.
- Preview nesmie siahať na produkčné dáta.
- `ignoreCommand` vo `vercel.json` preskočí build, keď sa zmenilo len
  `docs/` — nezabudni, že zmena čisto v dokumentácii nenasadí nič.
- Cron joby, limity funkcií a build nastavenia sú v `RUNBOOK.md`.

### Vitest

- Testy nie sú vedľa zdroja: `apps/api/tests/{unit,integration}`,
  `apps/web/tests/unit`.
- Integračné testy API bežia proti **in-memory Mongo**
  (`tests/helpers/test-app.ts`), nikdy proti Atlasu.
- Povinne pokryté: čisté funkcie v `lib/` (oprávnenia, tenant filtre,
  dátumy, parsovanie), route handlery aspoň happy path + kontrola
  autentifikácie, autorizácie a tenanta.
- **Každý opravený bug dostane test, ktorý ho najprv reprodukuje.**
  Najprv padajúci test, potom oprava.
- Runtime chovanie sa overuje **skutočným requestom**, nie čítaním kódu.
- `pnpm test` musí prejsť pred commitom.

## 9. Čo nesmieš bez môjho výslovného súhlasu

- DB migrácie a zmeny schém
- Zásahy do `.env`, CI, `vercel.json` a produkčných nastavení
- Mazanie, prepis, presun a premenovanie súborov
- Inštalácia nových závislostí, zvyšovanie `engines`
- Breaking change v API (premenovanie endpointu, zmena tvaru odpovede)
- Zmeny mimo dohodnutého rozsahu úlohy

## 10. Definition of Done

`pnpm lint`, `pnpm typecheck`, `pnpm test` a `pnpm format:check` prejdú →
oprava bugu má reprodukujúci test → pri zmene API je `openapi:sync`
spustený a `redocly lint` čistý → rozhranie overené mobile-first → nový
súbor má SPDX hlavičku (`reuse lint`) → aktualizovaný
`docs/sessions/NEXT.md`, `CHANGELOG.md` a session log → commit podľa
konvencie so `Signed-off-by:`.

## 11. Špecifiká prostredia

- Produkčné domény (`infra/vercel/DNS-SETUP.md`): marketing
  `inventario.estate` / `www`, appka `app.inventario.estate`, API
  `api.inventario.estate`, docs `docs.inventario.estate`. Tenanti môžu mať
  vlastné domény (ADR-0035). `apps/web/src/middleware.ts` drží vedome aj
  `app.inventario.sportup.sk` ako druhý kanonický host.
- Lokálne repo na mojom Macu: `~/Documents/GitHub/inventario`.
- **Mac má node 26, repo vyžaduje 24.x** → `pnpm` skripty padajú na
  `ERR_PNPM_UNSUPPORTED_ENGINE`. Obchádzka: spúšťať binárky priamo
  (`apps/api/node_modules/.bin/{vitest,tsc,tsx}`,
  `node_modules/.bin/{prettier,eslint}`). Otvorený bod v `NEXT.md`.
- `openapi:sync` používa `EXPORT_ONLY=true` s in-memory Mongom, takže
  nepotrebuje prístup k Atlasu.
- Cowork/Linux VM nedokáže spustiť `node_modules` (sú buildnuté pre
  darwin) — testy a generovanie spúšťaj na Macu.
