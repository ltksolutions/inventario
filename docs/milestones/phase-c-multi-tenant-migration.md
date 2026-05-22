<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Phase C — Multi-tenant Organisation Migration (Completed 2026-05-16)

## Cieľ

Premeniť Inventario backend zo single-tenant na **multi-tenant white-label
platformu**. Každý dokument v tenant-scoped kolekcii teraz nesie
`organisationId`, každá repository operácia automaticky filtruje podľa
aktuálneho tenanta, a auth middleware JIT-provisionuje Organisation row
pri prvom prihlásení používateľa z nového Entra tenantu. Po Phase C je
backend pripravený obslúžiť `sportup.sk`, mestá, kluby aj školy v jednom
deployment — bez vendor lock-inu a s plnou izoláciou dát.

**Vyžaduje slice #3** (categories + locations + users admin) ako
predpoklad. Reuse-ujeme všetko z neho: `provisionUserAs`,
`cleanTestDatabase`, RBAC preHandler chain, audit log service,
`runInTransaction`, FK kontroly.

## Výsledok

✅ **327 testov, lokálne aj CI** (310 existujúcich + 17 cross-tenant
isolation):

| Blok   | Pridáva                                                       | Stav |
| ------ | ------------------------------------------------------------- | ---- |
| Blok 1 | `Organisation` schema + `OrganisationScoped` mixin            | ✅   |
| Blok 2 | Tenant-scoped repositories + `organisation-scoping` util      | ✅   |
| Blok 3 | Organisations modul + auth tenant resolution + users refactor | ✅   |
| Blok 4 | Migration script (default tenant + backfill + legacy indexes) | ✅   |
| Blok 5 | Cross-tenant isolation tests + partial-filter indexes         | ✅   |

✅ **Cross-tenant guarantee** verifikované 17 testami:

- GET /v1/&lt;resource&gt; vráti **iba** rows aktuálneho tenanta
- GET/PATCH/DELETE /v1/&lt;resource&gt;/:id cross-tenant id → **404**
  (nie 403 — existencia row z iného tenanta sa nesmie leaknúť)
- Slug (categories, locations) je **per-tenant** unikátny
- Email (users) je **per-tenant** unikátny
- Inventory number (assets) je **per-tenant** unikátny
- Audit log records nesú `organisationId` aktora

✅ **Endpoints (zmeny oproti slice #3):**

| Endpoint                       | Auth   | RBAC  | Účel                                 |
| ------------------------------ | ------ | ----- | ------------------------------------ |
| `GET /v1/organisations`        | Bearer | ADMIN | List všetkých tenantov (super-admin) |
| `GET /v1/organisations/:id`    | Bearer | ADMIN | Single tenant detail                 |
| `POST /v1/organisations`       | Bearer | ADMIN | Create new tenant manually           |
| `PATCH /v1/organisations/:id`  | Bearer | ADMIN | Update tenant settings, brandKit     |
| `DELETE /v1/organisations/:id` | Bearer | ADMIN | Soft-delete tenant                   |

Pre všetky pôvodné endpointy (`/v1/assets`, `/v1/categories`,
`/v1/locations`, `/v1/users`) sa kontrakt nezmenil — len každá
request-response cesta je teraz automaticky tenant-scoped.

✅ **Performance:**

- Test suite ostáva ~3-5min na lokálnom Atlas Flex
- Žiadne nové indexové scans pri tenant-scoped operáciách (composite
  indexy `{organisationId, X}` su priamočiare lookups)
- JIT tenant resolution v auth middleware: **1 lookup** per request cez
  `entraTenantId_unique_partial` index

## Architektúra

### Stack (žiadne nové npm dependencies)

Phase C je čisto applicational refactor postavený na existujúcom
`mongodb`, `fastify`, `zod`, `@inventario/shared-types`. Pridaný jeden
nový modul (`organisations`) a jedna utility (`lib/organisation-scoping.ts`).

### Štruktúra zmien

```
apps/api/
├── scripts/
│   └── migrate-organisation-id.ts          # NEW: Blok 4 migration
├── src/
│   ├── lib/
│   │   └── organisation-scoping.ts         # NEW: tenant filter helpers
│   ├── modules/
│   │   ├── organisations/                  # NEW MODULE (Blok 3)
│   │   │   ├── organisations.repository.ts
│   │   │   ├── organisations.service.ts
│   │   │   └── organisations.routes.ts
│   │   ├── assets/
│   │   │   ├── assets.repository.ts        # +tenantFilter, +requireTenantId
│   │   │   └── assets.service.ts           # organisationId v audit + writes
│   │   ├── categories/
│   │   │   └── categories.repository.ts    # +tenantFilter, +countByX(tenantId)
│   │   ├── locations/
│   │   │   └── locations.repository.ts     # +tenantFilter
│   │   ├── users/
│   │   │   ├── users.repository.ts         # +findByEntraOid (cross-tenant)
│   │   │   └── users.service.ts            # JIT s tenant resolution
│   │   └── audit-log/
│   │       └── audit-log.service.ts        # +organisationId v records
│   └── plugins/
│       └── auth.ts                         # +tenant resolution chain
└── tests/
    ├── helpers/
    │   └── test-fixtures.ts                # +resolveTestTenantId, +seedTestTenant
    └── integration/
        └── cross-tenant-isolation.test.ts  # NEW: 17 isolation tests
```

### Multi-tenant data model

Každý dokument v týchto kolekciách má pole `organisationId: ObjectId`:

- `assets`
- `categories`
- `locations`
- `users`
- `audit_logs`

Root `organisations` kolekcia sedí **nad** tenant boundary. Jej rows
nemajú `organisationId` (každý je sám sebou tenant root).

Repository pattern (príklad z `assets.repository.ts`):

```ts
async findById(tenantId: string, id: string): Promise<WithId<Asset> | null> {
  if (!ObjectId.isValid(id)) return null;
  return this.collection.findOne({
    ...tenantFilter(tenantId),
    _id: new ObjectId(id),
    deletedAt: null,
  });
}
```

Helper `tenantFilter(tenantId)` vracia `{ organisationId: tenantId }`.
Každá tenant-scoped operácia volá `requireTenantId(tenantId)` ako prvé,
ktorý throw-ne ak `tenantId === null/undefined`. To zabraňuje
nechcenému cross-tenant readu/writu už v compile-time aj runtime.

### Composite indexy (per-tenant uniqueness)

Phase C nahradila každý globálne unique index composite per-tenant
verziou. Migration script v Blok 4 dropol legacy single-field indexy
a `ensureIndexes()` v každom repository vytvorí nové:

| Collection      | Old single-field           | New composite                               |
| --------------- | -------------------------- | ------------------------------------------- |
| `users`         | `{email}` unique           | `{organisationId, email}` unique            |
| `users`         | `{isActive, deletedAt}`    | `{organisationId, isActive, deletedAt}`     |
| `assets`        | `{inventoryNumber}` unique | `{organisationId, inventoryNumber}` unique  |
| `categories`    | `{slug}` unique            | `{organisationId, slug}` unique             |
| `locations`     | `{slug}` unique            | `{organisationId, slug}` unique             |
| `organisations` | `{entraTenantId}` sparse   | `{entraTenantId}` partial (`$type: string`) |
| `organisations` | `{customDomain}` sparse    | `{customDomain}` partial (`$type: string`)  |

Phase C Blok 5 dodatočne nahradila pôvodné **sparse** indexy na
`organisations` collection **partial-filter** ekvivalentmi. Mongo sparse
index v skutočnosti indexuje rows kde je hodnota explicitne `null` (len
`missing` field je preskočený). Náš Zod schema píše `null` ako default,
čiže dva LOCAL tenanti s `customDomain: null` by kolidovali na sparse
unique indexe. Partial filter `{ $type: 'string' }` túto past obchádza.

### Auth middleware tenant resolution

```
┌─────────────────────────────────────────────────────────────┐
│ requireAuth (verifyJWT + scope check)                       │
│   ↓ extracts { oid, tid, ... } from claims                  │
├─────────────────────────────────────────────────────────────┤
│ loadCurrentUser                                             │
│   1. OrganisationsService.findOrProvisionFromClaims(tid)    │
│      → JIT creates Organisation if first login from this    │
│        Entra tenant; otherwise returns existing.            │
│   2. UsersService.findOrProvision(claims, organisation._id) │
│      → JIT creates User in resolved tenant; idempotent.     │
│   3. Reject if user.isActive === false → 401                │
│   4. Stamp request.currentUser + request.currentTenant      │
└─────────────────────────────────────────────────────────────┘
```

JIT pre Organisation aj User je idempotentný cez unique index +
`E11000 duplicate key → re-query` pattern. Concurrent prvé-prihlásenia
toho istého tenanta sú safe.

### Migration script

`apps/api/scripts/migrate-organisation-id.ts` má tri kroky:

1. **Default tenant** — Vytvorí (alebo nájde) row `slug: 'inventario'`
   pre legacy single-tenant production data. Idempotentné.
2. **Backfill** — Updatne každý dokument bez `organisationId` na
   collections `users`, `assets`, `categories`, `locations`,
   `audit_logs` aby dostal default tenant `_id`. Skip-uje rows kde
   `organisationId` už existuje.
3. **Legacy indexes** — Drop-uje legacy single-field unique indexy
   z každej tenant-scoped collection (`email_unique`,
   `inventoryNumber_unique`, `slug_unique` × 2, `isActive_deletedAt`)
   plus obsolete `entraTenantId_unique_sparse` +
   `customDomain_unique_sparse` z `organisations`. Idempotentné —
   skip-uje indexy ktoré už nie sú prítomné.

Migration podporuje `--dry-run` flag pre safe preview pred production
runom. Spúšťa sa cez `pnpm --filter @inventario/api migrate:organisation-id`.

## Decisions

[ADR pending] **404 vs 403 pri cross-tenant access** — 404 vyhráva
lebo 403 by leakovalo informáciu o existencii row v inom tenante.
Implementácia: každá tenant-scoped `findById` vráti `null` ak
`organisationId` nesedí, službová vrstva to surfaceuje ako
`NotFoundError → 404`.

[ADR pending] **JIT tenant provisioning** — Auth middleware
auto-vytvorí Organisation row pri prvom prihlásení používateľa z Entra
tenantu ktorý sme ešte nevideli. Alternatíva (manuálny onboarding)
bola zamietnutá lebo: (a) friction pre B2B trial, (b) Entra tid je
stable identifier ktorý už autentifikuje pôvod tokenu, (c) tenant
môžeme post-hoc rename-ovať / nastaviť brandKit cez admin endpoint.

[DEFER] **Audit log scoping read endpoint** — `AuditLogRepository`
zatial nemá tenant-scoped find/list endpoint. Audit log records
nesú `organisationId` od Bloku 3, ale read API príde s admin
audit-trail endpointom (Phase E alebo neskôr).

[DEFER] **Custom domain routing** — `customDomain` field je v
schéme + partial-filter index je pripravený, ale routing
middleware ho ešte nepoužíva. Plánované pre Q3 2026 spolu s
`api.inventario.sportup.sk` produkčným nasadením.

## Skúsenosti

### Čo fungovalo dobre

**Postupná migrácia (5 blokov)** — Phase C bola príliš veľká na jeden
commit. Rozdelenie na nezávisle merge-ovateľné bloky (schema → repos
→ service+routes → migration → tests) udržalo každý PR rozumný a
testovateľný. Blok 3 (organisations module + auth refactor) je sám
o sebe ~9 files a 2 dni práce; bez postupnosti by sa to dalo ťažko
review-ovať.

**Composite indexy pred backfillom** — Migration script v Blok 4
backfilluje **pred** dropnutím starých indexov. To znamená, že počas
migrácie existujú obe sady (single-field aj composite) a Mongo
sám overí, že composite indexy budú konzistentné po dropne starých.
Ak by sme single-field dropli prvé, krátka okno bez uniqueness by
mohla pripustiť dvojité inserty.

**Sparse → partial filter posun** — Po prvom run cross-tenant testov
zlyhal `seedTestTenant` na `customDomain_unique_sparse` duplicate
key. Identifikoval som že Mongo sparse v skutočnosti indexuje explicit
`null` (len missing skip-uje), a Zod schema píše `null` ako default.
Partial filter `{ $type: 'string' }` je správne riešenie. Lesson learned:
pri `nullable + default(null)` Zod fields **vždy partial filter, nikdy
sparse**.

### Čo bolo bolestivé

**Test fixture migration** — Existujúce direct-insert fixtures
(`insertTestAsset`, `insertTestCategory`, ...) ani neoznačili
`organisationId`. Najprv som ich rozšíril o optional parameter s
default `resolveTestTenantId(app)` — ale dva test súbory mali **inline**
`db.collection().insertOne(...)` ktoré obišli fixture helpers. To
spôsobovalo 4 zo 4 failures pri prvom plnom test runu po pridaní
tenant filteringu. Fix: pridať `organisationId` aj do týchto inline
insertov. Lesson learned: **vždy lint inline DB writes v testoch**,
najmä keď migrujeme schema.

**Test DB legacy indexes** — Test DB má `cleanTestDatabase` ktorý
`deleteMany({})` ale **nedeletes indexes**. Po prvom run s old sparse
indexy ostali tam a kolidovali pri ďalších test runoch s `null`
hodnotami. Manuálne riešenie: spustiť migration script s
`MONGO_DB_NAME=sfz_asset_management_test` raz pre cleanup. Lesson
learned: pri zmene index definícií treba **vždy** updatnúť aj
migration script aby drop staré.

**Auth middleware vs `/v1/me` kontrakt** — Pred Phase C `/v1/me`
používal len `requireAuth` (no `loadCurrentUser`), takže deactivated
user mohol stále vidieť `isActive: false` cez self-lookup. Po Blok 3
sme presunuli `/v1/me` na `[requireAuth, loadCurrentUser]` chain
aby sa tenant resolved pred user JIT. Side effect: deactivated user
teraz dostane 401 aj na `/v1/me`. Trade-off je akceptovateľný lebo
deactivovaný používateľ je už dnes zamknutý na všetkých ostatných
endpointoch, takže jeden ďalší 401 nezmení reálne UX.

## Príklady použitia

### Manuálne overenie multi-tenant izolácie

Otestovať že tenant A nevidí tenant B dáta:

```bash
# 1. Sign in ako prvý user z Entra tenantu A → JIT vytvorí Org A.
# 2. Vytvor asset:
curl -X POST https://api.inventario.estate/v1/assets \
  -H "Authorization: Bearer ${TOKEN_A}" \
  -H "Content-Type: application/json" \
  -d '{"inventoryNumberPrefix":"A","name":"Tenant A asset", ...}'

# 3. Sign in ako prvý user z Entra tenantu B → JIT vytvorí Org B.
# 4. Skús GET asset_A_id ako tenant B aktér:
curl https://api.inventario.estate/v1/assets/${ASSET_A_ID} \
  -H "Authorization: Bearer ${TOKEN_B}"
# → 404 Not Found  (nie 403; existence sa nesmie leaknúť)
```

### Spustenie migration na produkčnej DB

```bash
# Najprv dry-run pre preview:
MONGO_URI=mongodb+srv://prod-cluster.../inventario \
  pnpm --filter @inventario/api migrate:organisation-id --dry-run

# Po review zopakovať bez --dry-run:
MONGO_URI=mongodb+srv://prod-cluster.../inventario \
  pnpm --filter @inventario/api migrate:organisation-id
```

Migration je idempotentná — opakované spustenie hlási 0 updated,
0 dropped.

## Čo je ďalej

Phase C zatvára multi-tenant fundamenty. Ďalšie kroky:

- **Phase D** — EU compliance (OpenAPI 3.1 export, SBOM CycloneDX,
  WCAG 2.1 AA audit, GDPR Art 30 audit log hardening). ~0.5 dňa.
- **Phase E** — Tech debt cleanup (PENDING_TENANT_ID removal,
  category/location Update schemas to shared-types, marketing
  footer link fix, root package.json post-pivot rename). ~1-2 hod.
- **Slice #4** — `apps/web` frontend (Next.js 15 + TanStack Query +
  shadcn/ui + Inventario design tokens). Multi-day work.

Po Slice #4 je Inventario MVP demoable na sportup.sk + minimum jedna
pilot federácia / mestská organizácia.
