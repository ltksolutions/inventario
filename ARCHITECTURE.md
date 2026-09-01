# ARCHITECTURE.md — mapa kódu

> Kde čo v repe býva, ako tečú dáta a kde sú hranice. High-level obrázok
> systému, dátový model a MCP špecifikácia sú v
> [`docs/architecture/`](docs/architecture/README.md) — tento súbor ich
> nenahrádza, dopĺňa ich pohľadom do kódu.

## Hranice balíkov

```
apps/api ──────► packages/shared-types ◄────── apps/web
    │                                              │
    │            packages/design-tokens ◄──────────┤
    │                                              │
    └──► MongoDB Atlas          OpenAPI 3.1 ───────┘
                                (generovaný kontrakt)
```

| Balík                    | Zodpovednosť                                     | Na čom závisí                        |
| ------------------------ | ------------------------------------------------ | ------------------------------------ |
| `apps/api`               | REST API, autorizácia, doménová logika, migrácie | `shared-types`                       |
| `apps/web`               | Next.js 15 App Router UI                         | `shared-types`, `design-tokens`, API |
| `apps/docs`              | Nextra dokumentácia (`docs.inventario.estate`)   | —                                    |
| `packages/shared-types`  | Zod schémy, enumy, typy entít                    | —                                    |
| `packages/design-tokens` | brand kit schéma, Tailwind preset, CSS tokeny    | —                                    |

**Pravidlo**: `apps/web` nikdy neimportuje z `apps/api`. Kontrakt medzi
nimi je OpenAPI dokument — `apps/api/openapi.json` sa generuje z Fastify
schém a z neho sa generuje `apps/web/src/lib/api-types.ts` (v `.gitignore`,
teda vždy len build artefakt). Zdieľané typy idú cez `shared-types`.

## `apps/api` — vrstvy

```
index.ts / api/index.ts     vstupný bod (lokálne / Vercel funkcia)
  └─ server.ts              zloženie appky, poradie registrácie pluginov
       ├─ plugins/          infraštruktúra (viď tabuľka nižšie)
       ├─ modules/<domena>/ routes → service → repository
       ├─ lib/              čisté funkcie bez závislosti na Fastify
       └─ migrations/       jednorazové migrácie + runner
```

| Plugin                          | Čo rieši                                                                  |
| ------------------------------- | ------------------------------------------------------------------------- |
| `config.ts`                     | **Zod schéma všetkých env premenných** — zdroj pravdy, nie `.env.example` |
| `mongo.ts`                      | jediné pripojenie na Atlas, connection pool                               |
| `auth.ts`                       | `requireAuth`, `loadCurrentUser`, `requireRole`, `requireMinRole`         |
| `error-handler.ts`              | **jediné miesto, kde vzniká telo chybovej odpovede**                      |
| `inventario-jwt.ts`             | vydávanie a verifikácia vlastných access tokenov                          |
| `email.ts` + `email-providers/` | Ecomail / Resend / stub                                                   |
| `swagger.ts`                    | OpenAPI 3.1 dokument, `operationId`, spoločné chybové odpovede            |

Doménové moduly: `assets`, `asset-conditions`, `attachments`, `audit`,
`auth`, `categories`, `dashboard`, `health`, `invitations`, `labels`,
`loans`, `locations`, `memberships`, `organisations`, `protocols`,
`stock`, `system`, `users`.

Modul má typicky tri súbory: `*.routes.ts` (schéma + preHandler +
handler), `*.service.ts` (doménová logika) a `*.repository.ts` (dotazy do
Mongo). Routy nechodia do Mongo priamo.

## Tok requestu

```
request
  └─ @fastify/rate-limit          globálne 100/min/IP
  └─ CORS + helmet
  └─ preHandler:
       requireAuth                inv_access cookie → JWT claims        401
       loadCurrentUser            tenant + user + membership + GDPR čl.18  401/403
       requireRole/requireMinRole RBAC z Membership.role                403
  └─ validácia vstupu             Zod (params, querystring, body)       400
  └─ handler → service → repository
  └─ serializácia odpovede        Zod response schéma (!)
  └─ error handler                { statusCode, error, message }
```

Dve veci, ktoré sa dajú prehliadnuť:

1. **Response schéma je zároveň serializér.** `server.ts` registruje
   `serializerCompiler` z `fastify-type-provider-zod`, takže Fastify podľa
   `response` schémy odpoveď formátuje a neznáme kľúče zahodí. Pridanie
   response schémy je zmena runtime chovania, nielen dokumentácie.
2. **Chybové odpovede v OpenAPI nevznikajú v routách.** Dopĺňa ich
   `plugins/swagger.ts` až pri generovaní dokumentu — preto sa dajú
   pridať bez rizika, že sa dotknú serializácie.

## Multi-tenancy

Tenant je `Organisation`. Príslušnosť používateľa k tenantovi drží
`Membership` (ADR-0015), ktorý zároveň nesie **jednu autoritatívnu rolu**
(ADR-0029). `loadCurrentUser` z JWT (`tid`/`org`, `sub`, `mid`) rozloží
tenant, používateľa a členstvo na `request`.

**Každý dotaz do Mongo obsahuje `organisationId` filter** a `deletedAt:
null`. Cross-tenant čítanie má presne dve výnimky, obidve verejné a
zámerné: `GET /v1/public/scan/:publicToken` (lost & found, ADR-0021) a
`GET /v1/public/organisations/login-context` (branding pre login,
ADR-0035). Obidve vracajú whitelist polí, nie výrez dokumentu.

Tenanti môžu mať vlastnú doménu; `apps/web/src/middleware.ts` ju overuje
proti `login-context` endpointu (ADR-0035).

## `apps/web` — štruktúra

```
src/app/          App Router — route segmenty, layouty, stránky
src/components/   UI komponenty
src/lib/          klientske hooky, API klient, generované api-types.ts
src/middleware.ts overenie vlastnej tenant domény
```

Branding tenanta sa aplikuje cez CSS premenné z `design-tokens`
(`:root[data-tenant=…]`, ADR-0028).

## Dáta a stav

- **MongoDB Atlas** — kolekcie a indexy sú zdokumentované v
  [`docs/architecture/data-model.md`](docs/architecture/data-model.md).
- **Migrácie** — súbory v `apps/api/src/migrations/` registrované
  v `runner.ts`, idempotentné, stav v kolekcii `migrations`.
  V produkcii ich spúšťa `POST /v1/system/migrations/run` po deployi.
- **Indexy** — v produkcii sa pri cold starte **nevytvárajú** (bolo to 18
  sériových round-tripov pred prvým requestom). Vytvára ich
  `POST /v1/system/indexes/ensure` po migráciách.
- **Retencia** — `POST /v1/system/retention/run`, mesačný Vercel cron.

Postupy k všetkým trom sú v [`RUNBOOK.md`](RUNBOOK.md).

## Čo tu ešte nie je

- **MCP server** — špecifikácia je v
  [`docs/architecture/mcp-server.md`](docs/architecture/mcp-server.md),
  implementácia je plánovaná (Slice #10).
- **Mobilná appka** (Flutter) — fáza 3.
- **MinIO v `infra/docker-compose.yml`** sa lokálne spúšťa (konzola na
  `:9001`), ale žiadny kód ho nepoužíva. Prílohy a logá tenantov idú do
  **Vercel Blob** (`@vercel/blob`, token `BLOB_READ_WRITE_TOKEN`,
  ADR-0028) — viď `modules/attachments/attachments.routes.ts`. MinIO
  a `STORAGE_*` premenné boli pôvodný plán; premenné z `.env.example`
  vypadli 2026-09-01, kontejner v compose zostal.
