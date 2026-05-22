<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Slice #3 — Categories + Locations + Users Admin (Completed 2026-05-16)

## Cieľ

Doplniť backend o **referenčné dáta** (kategórie + lokácie) ktoré assety
potrebujú, **FK ochranu** ktorá zabráni dangling referenciám v oboch
smeroch, a **admin endpointy** na správu používateľov. Po slice #3 je
backend funkčne kompletný pre čítanie aj zápis všetkých core entít —
frontend (slice #4) sa môže opierať o stabilný API kontrakt.

**Vyžaduje slice #2c** (vitest infra + pre-commit + CI) ako predpoklad.
Reuse-ujeme všetko: `provisionUserAs`, `cleanTestDatabase`, RBAC
preHandler chain, audit log service, `runInTransaction` pattern.

## Výsledok

✅ **310 testov, lokálne aj CI:**

| K-step  | Pridáva                                  | Tests delta | Total   |
| ------- | ---------------------------------------- | ----------- | ------- |
| K1      | Categories CRUD + slug + audit           | +18         | 118     |
| K2      | Categories cycle detection + max depth   | +14         | 132     |
| K3      | Slug auto-generation z `name`            | +9          | 141     |
| K4      | Hierarchy traversal extracted (`lib/`)   | +11         | 152     |
| K5      | Locations CRUD + audit                   | +27         | 179     |
| K6      | Locations hierarchy + parentId           | +12         | 191     |
| K7      | FK check: assets → categories/locations  | +18         | 209     |
| K8      | Tests for slice #3 paths in audit module | +9          | 218     |
| K9      | FK check: cat/loc delete vs assets       | +39         | 257     |
| **K10** | **Users admin module (GET/PATCH)**       | **+53**     | **310** |

✅ **Endpointy (slice #3 delta nad slice #2b):**

| Endpoint                    | Auth   | RBAC                 | Účel                         |
| --------------------------- | ------ | -------------------- | ---------------------------- |
| `GET /v1/categories`        | Bearer | EMPLOYEE+            | List, paginated, filter      |
| `GET /v1/categories/:id`    | Bearer | EMPLOYEE+            | Single category              |
| `POST /v1/categories`       | Bearer | ASSET_MANAGER, ADMIN | Create (slug auto-derive)    |
| `PATCH /v1/categories/:id`  | Bearer | ASSET_MANAGER, ADMIN | Partial update + diff audit  |
| `DELETE /v1/categories/:id` | Bearer | **ADMIN only**       | Soft delete (FK protected)   |
| `GET /v1/locations`         | Bearer | EMPLOYEE+            | List, paginated, filter      |
| `GET /v1/locations/:id`     | Bearer | EMPLOYEE+            | Single location              |
| `POST /v1/locations`        | Bearer | ASSET_MANAGER, ADMIN | Create                       |
| `PATCH /v1/locations/:id`   | Bearer | ASSET_MANAGER, ADMIN | Partial update + diff audit  |
| `DELETE /v1/locations/:id`  | Bearer | **ADMIN only**       | Soft delete (FK protected)   |
| `GET /v1/users`             | Bearer | **ADMIN only**       | List, paginated, filter, `q` |
| `GET /v1/users/:id`         | Bearer | **ADMIN only**       | Single user                  |
| `PATCH /v1/users/:id`       | Bearer | **ADMIN only**       | Update roles + isActive      |

✅ **FK integrity:**

- POST/PATCH na `assets` validuje že `categoryId` aj `locationId` existujú
  a nie sú soft-deleted (slice #3 K7)
- DELETE na `categories` / `locations` refuses, ak aspoň jeden non-deleted
  asset na ne odkazuje (slice #3 K9)
- Tree integrity: DELETE na category s child kategóriami refused
- Všetky FK checky bežia **v rámci tej istej transakcie** ako write —
  žiadne race conditions

✅ **Test suite performance:**

- Lokálne: ~168s (310 testov, 19 test files, singleFork)
- CI GitHub Actions: ~3-4m (cold Atlas TLS handshakes)
- `pluginTimeout: 30_000` v `buildTestApp` stále stačí

## Architektúra

### Stack (zmeny oproti slice #2c)

Žiadne nové npm dependencies. Slice #3 je čisto applicational rozšírenie
postavené na existujúcom `mongodb`, `fastify`, `zod`, `@inventario/shared-types`.

### Štruktúra zmien

```
apps/api/
├── src/
│   ├── lib/                                  # NEW DIR
│   │   ├── slugify.ts                        # slug derivation + suffix
│   │   └── hierarchy.ts                      # checkHierarchyOnReparent
│   └── modules/
│       ├── categories/                       # NEW MODULE
│       │   ├── categories.repository.ts      # CRUD + countChildren + findBySlug
│       │   ├── categories.service.ts         # transakcie + audit + cycle check
│       │   └── categories.routes.ts          # 5 endpointov
│       ├── locations/                        # NEW MODULE
│       │   ├── locations.repository.ts       # CRUD + countChildren + findBySlug
│       │   ├── locations.service.ts          # transakcie + audit + hierarchy
│       │   └── locations.routes.ts           # 5 endpointov
│       ├── assets/
│       │   ├── assets.repository.ts          # +countByCategory, +countByLocation
│       │   └── assets.service.ts             # +FK check v POST/PATCH (K7)
│       └── users/                            # EXTENDED
│           ├── users.repository.ts           # +findById/list/update/countActiveAdminsExcluding
│           ├── users.service.ts              # +list/getById/update + guardrails
│           └── users.routes.ts               # +GET /v1/users, GET /:id, PATCH /:id
└── tests/
    ├── unit/
    │   ├── slugify.test.ts                   # NEW
    │   └── hierarchy.test.ts                 # NEW
    ├── integration/
    │   ├── categories-post.test.ts           # NEW
    │   ├── categories-patch.test.ts          # NEW
    │   ├── categories-delete.test.ts         # NEW
    │   ├── locations-post.test.ts            # NEW
    │   ├── locations-patch.test.ts           # NEW
    │   ├── locations-delete.test.ts          # NEW
    │   ├── users-list.test.ts                # NEW (K10)
    │   ├── users-get.test.ts                 # NEW (K10)
    │   └── users-patch.test.ts               # NEW (K10)
    └── helpers/
        └── test-fixtures.ts                  # +insertTestCategory/Location/User
```

## Kľúčové vzory

### Slug auto-derivation (K3)

POST `/v1/categories` neprijíma `slug` ako povinný field. Ak je
vynechaný, service ho odvodí z `name`:

```typescript
slugify('IT vybavenie') → 'it-vybavenie'
```

Pri kolízii service automaticky pridáva číselný sufix:

```
'it-vybavenie' už existuje
  → slugWithSuffix('it-vybavenie', 2) → 'it-vybavenie-2'
'it-vybavenie-2' tiež existuje
  → 'it-vybavenie-3'
```

Až do `MAX_ATTEMPTS=100`. Po prekročení (pathological inputs) chyba
`400: Could not derive a free slug from "..." after 100 attempts. Supply
a slug explicitly.`

Strict mode: ak klient slug **pošle** explicitne, kolízia = `400`
(nie silent rename). Server prepisuje len keď bol slug auto-generated.

### Hierarchy traversal (`lib/hierarchy.ts`)

Categories aj Locations majú `parentId` (nullable) tvoriaci les stromov.
Hierarchy check má 3 zodpovednosti:

1. **Cycle detection** — proposed parent nesmie mať edited node v ancestor chain-e
2. **Max depth check** — `MAX_HIERARCHY_DEPTH = 4` (root + 4 nested = 5 levels)
3. **Corrupt-tree detection** — existing cycle v DB (admin alert)

```typescript
const result = await checkHierarchyOnReparent(
  editedId, // null on create
  proposedParentId,
  parentLookup, // (id) => Promise<parentId | null | undefined>
);

switch (result.kind) {
  case 'ok': // proceed
  case 'cycle': // 400, chain in result.chain
  case 'too-deep': // 400
  case 'corrupt-tree': // 400 + admin investigation needed
}
```

Pure function — žiadny Mongo session, žiadny Fastify. Service injectuje
session-aware `parentLookup` closure. **Testovateľné v izolácii** —
30 unit testov pokrýva všetky 4 outcomes plus edge cases (sefl-parent,
diamond shapes, long chains).

### FK validation v assets (K7)

```typescript
// POST + PATCH na asset
if (input.categoryId !== undefined) {
  const cat = await this.categoriesRepo.findById(input.categoryId, session);
  if (!cat) {
    throw new BadRequestError(`Category ${input.categoryId} does not exist.`);
  }
}
if (input.locationId !== undefined) {
  const loc = await this.locationsRepo.findById(input.locationId, session);
  if (!loc) {
    throw new BadRequestError(`Location ${input.locationId} does not exist.`);
  }
}
```

Beží **v rámci tej istej transakcie** ako asset write. Race je takmer
nemožná: ak by paralelná transakcia chcela category/location vymazať,
collision na audit log session zachytí jedna z dvoch transakcií ako
abort.

### FK protection na DELETE (K9)

Categories aj Locations majú `countByCategory(id)` / `countByLocation(id)`
helpers na `AssetsRepository`. Pri DELETE service zavolá:

```typescript
const assetCount = await this.assetsRepo.countByCategory(id, session);
if (assetCount > 0) {
  throw new BadRequestError(
    `Cannot delete category "${existing.name}": ${assetCount} asset(s) reference it. ` +
      `Reassign or delete those assets first.`,
  );
}
```

Plus existujúca tree integrity (`countChildren` — nedovoliť delete na
category ktorá má child kategórie). Obe checky bežia **v jednej
transakcii**, takže ani race s POST nového assetu nesúkromní mažúcu transakciu.

### Users admin guardrails (K10)

**Self-patch guardrail** (synchronous, v service):

```typescript
if (isSelfPatch && removingOwnAdminRole) {
  throw new BadRequestError(
    'Admins cannot remove their own ADMIN role. Ask another admin to do it.',
  );
}
if (isSelfPatch && deactivatingSelf) {
  throw new BadRequestError('Admins cannot deactivate themselves.');
}
```

**Last-admin guardrail** (transactional, defense-in-depth):

```typescript
if (targetWasActiveAdmin && (removesAdmin || deactivates)) {
  const remainingAdmins = await this.repo.countActiveAdminsExcluding(
    id,
    session,
  );
  if (remainingAdmins === 0) {
    throw new BadRequestError(
      'Cannot remove the last active ADMIN. Promote another user to ADMIN first.',
    );
  }
}
```

V praxi je last-admin trigger v K10 API surface **nedostupný** —
self-patch guard zachytí jedinú sekvenčnú cestu ktorá by tam viedla.
Guardrail zostáva v kóde ako insurance pre:

- **Concurrent transactions** (admin A demotuje admin B paralelne so situáciou
  kde admin C demotuje admin A)
- **Future bulk endpoints** (PATCH /v1/users batch)
- **Future flows** (auto-deactivation cez retention policy)

Test súbor `users-patch.test.ts` overuje permissive boundary (`remainingAdmins >= 1`
prejde) a NOTE komentár dokumentuje gap v strict trigger coverage.

### Audit events per business action (K10)

Namiesto generického `USER_UPDATED` pre každú zmenu user dokumentu, K10
emituje granular events podľa typu zmeny:

| Field zmena                | Audit action                   | Severity |
| -------------------------- | ------------------------------ | -------- |
| roles array: add member    | `USER_ROLE_GRANTED` (per role) | INFO     |
| roles array: remove member | `USER_ROLE_REVOKED` (per role) | WARNING  |
| isActive: true → false     | `USER_DEACTIVATED`             | WARNING  |
| isActive: false → true     | `USER_REACTIVATED`             | INFO     |
| iné polia (name, prefs, …) | `USER_UPDATED` s diff          | INFO     |

Jedna PATCH request môže emitnúť viacero audit eventov (napr. grant
ADMIN + revoke EMPLOYEE = 2 entries). Všetky bežia v rovnakej transakcii
ako sám patch — atomicita garantovaná.

### `isActive` query param — `z.coerce.boolean()` trap (K10)

**Bug nájdený v testoch:** `z.coerce.boolean()` interne volá
`Boolean(value)`. JavaScript:

```javascript
Boolean('false')  → true   // ❌ falsy string je truthy v Boolean()
Boolean('true')   → true   // ✅
Boolean('0')      → true   // ❌
Boolean('')       → false  // ✅
```

Query param `?isActive=false` by tichom otočil filter na `isActive: true`.
Test zachytil to.

Fix:

```typescript
isActive: z.enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1'));
```

**Existujúci bug v `categories.routes.ts`** (rovnaký pattern) — nevyriešený
v K10 commit-e (single concern), tracking ako tech debt v NEXT.md.

### Test fixture rozšírenie (`test-fixtures.ts`)

| Helper                    | Účel                                    |
| ------------------------- | --------------------------------------- |
| `insertTestCategory`      | Direct-insert category (bypass service) |
| `insertTestLocation`      | Direct-insert location                  |
| `insertTestUser`          | Direct-insert user (bypass JIT)         |
| `seedAssetFkRefs`         | Setup valid category + location FK refs |
| `validCreateCategoryBody` | Minimal valid POST body                 |
| `validCreateLocationBody` | Minimal valid POST body                 |
| `validCreateAssetBody`    | Updated to accept FK ID overrides       |

`insertTestUser` špecificky generuje **valid UUID v4** `entraOid`
(`00000000-0000-4000-8000-{12 random hex}`) — schema vyžaduje
`z.string().uuid()`, a `Date.now().toString(36)` z prvého draftu
obsahovala non-hex znaky a failovala.

## Drobnosti vyriešené počas slice-u

### 1. `audit_logs` collection name confirmation

Pri písaní audit assertions v K10 testoch som si overoval či ide o
`audit_logs` (snake) alebo `auditLogs` (camel). `audit.repository.ts`:

```typescript
this.collection = db.collection<AuditLog>('audit_logs');
```

→ snake. Konzistencia s `loan_protocols` a inými future plural snake names.

### 2. TS narrowing across async transaction callback (K10)

Service constructor:

```typescript
constructor(
  private readonly auditLog: AuditLogService | null,
  private readonly mongoClient: MongoClient | null,
) {}
```

`auditLog` a `mongoClient` sú nullable pre **slice #2 JIT path** ktorý
ich nepotrebuje. K10 admin write path early-throwuje ak sú `null`:

```typescript
if (!this.auditLog || !this.mongoClient) {
  throw new Error(
    'UsersService.update requires auditLog and mongoClient — ...',
  );
}
```

Ale TypeScript narrowing **nesurvived** cez async callback do
`runInTransaction`:

```typescript
const updated = await this.runInTransaction(async (session) => {
  // ❌ TS2531: Object is possibly 'null'
  await this.auditLog.record(...);
});
```

Fix: bind do lokálnej premennej **PRED** callbackom:

```typescript
const auditLog = this.auditLog;  // narrowed to AuditLogService here

await this.runInTransaction(async (session) => {
  await auditLog.record(...);  // ✅ closure capture preserves type
});
```

Husky pre-commit hook to zachytil pred push. Tento pattern fix na 4
miesta v `users.service.ts`.

### 3. `Filter<User>['$or']` cast cleanup

Pôvodný draft `users.routes.ts` mal:

```typescript
filter.$or = [...] as Filter<User>['$or'];
```

Mongo `Filter<T>` typing je strict aj o `$or` shape. Cast skomplikoval
review aj IDE intellisense. Switch na **plain record + cast at boundary**:

```typescript
const filterObj: Record<string, unknown> = {};
if (q !== undefined) {
  filterObj['$or'] = [{ email: re }, ...];
}
return service.list({ ..., filter: filterObj as Filter<User> });
```

Čitateľnejšie, jeden cast místo viacerých.

### 4. K10 last-admin guardrail — pragmatický test coverage

Pôvodný plán: pokryť strict trigger (0 remaining active admins after
patch). Realita: cez K10 API surface je strict trigger nedostupný kvôli
self-patch guardu ktorý ho zachytí prv. Multi-step setup ktorý by ho
otestoval bol komplikovaný a krehký.

Riešenie: explicitne dokumentovať gap v test-súbore aj v milestone doc-u
(táto sekcia). Trigger zostáva v service kóde ako insurance. Coverage
sa doplní keď príde bulk endpoint alebo concurrent transaction test.

### 5. Husky pre-commit hook saved the day (2×)

Slice #3 mal **2 silent TS bugs** ktoré by inak prešli do master-u:

- K7: `assets.service.ts` `categoriesRepo.findById` invocation s nesprávnym
  argument count po refactore
- K10: `auditLog` null-narrowing v transaction callback (popísané vyššie)

V oboch prípadoch `husky pre-commit → pnpm typecheck` zlyhal s jasným
TS error message-om. Lokálne fixol som za ~2 min. **ROI tohoto hook-u
je veľmi pozitívne** — sloi #2c investment paid off.

## Performance baseline (po K10)

| Metrika                             | Lokálne (Bratislava → Atlas) | CI (GitHub Actions → Atlas) |
| ----------------------------------- | ---------------------------- | --------------------------- |
| Test suite duration                 | ~168s                        | ~3-4m                       |
| Test files                          | 19                           | 19                          |
| Total tests                         | 310                          | 310                         |
| Atlas cold TLS handshake (per file) | 3-5s                         | 8-15s                       |
| Vitest pool                         | singleFork                   | singleFork                  |
| Plugin timeout                      | 30s                          | 30s                         |

**Rast 100 → 257 → 310 testov za 3 slice-y** (#2c → #3 K1-K9 → K10).
Duration scaled linearly (~0.5s/test). singleFork pool stále vyhovuje;
no need to switch na threads/forks pool pokým neprestrelíme ~5m runtime.

## Bezpečnostné záruky (po slice #3)

1. **RBAC enforcement** — všetky endpointy idú cez `requireRole`,
   `loadCurrentUser` reads aktuálne DB stav (nie cached JWT roles)
2. **Audit trail** — každý state-changing call zapisuje audit log, atomicky
   s business write-om
3. **FK integrity** — POST asset s neexistujúcou category/location dostane
   400, DELETE category/location s referencing assets dostane 400
4. **Tree integrity** — DELETE category/location s child uzlami dostane 400
5. **Last-admin guard** — system sa nemôže dostať do stavu "0 active admins"
   cez sekvenčnú API cestu
6. **Self-deactivate guard** — admin nemôže odrezať seba
7. **passwordHash projection** — `users` repository projektuje out `passwordHash`
   na každom read-e; ani admin GET ho neuvidí v response

## Čo NIE JE v slice #3

Vedome odložené:

- ❌ **Self-service `PATCH /v1/me`** — používatelia menia seba (name, prefs);
  K10 PATCH je admin-only, mení len `roles` + `isActive`
- ❌ **User invite flow** (`POST /v1/users/invite` pre LOCAL účty) — slice #4+
- ❌ **Restore (un-delete) deleted entity** — admin-only, neskôr
- ❌ **`GET /v1/audit-logs` query endpoint** — admin číta cez Atlas UI zatiaľ
- ❌ **Bulk operations** — POST many, DELETE many, batch role grants
- ❌ **Multi-tenant `organisationId`** — ADR-0010 je naplánovaný, slice TBD
- ❌ **OpenAPI 3.1 export** z Zod schém — v NEXT.md ako compliance roadmap item
- ❌ **Categories `isActive` query param fix** — rovnaký `z.coerce.boolean()`
  bug ako v K10 users; odložené ako separate cleanup commit

## Známe drobnosti (tech debt)

Trackované v `NEXT.md` "Technical debt" sekcii. Pridané v slice #3:

- **`audit.test.ts` flaky timeout** — beží občas 30s+ na Atlas
- **`LOCATION_TYPE_VALUES`** export do `packages/shared-types/`
- **`UpdateCategorySchema`** + **`UpdateLocationSchema`** → presunúť do shared-types
- **`categories.routes.ts isActive` query param** — rovnaký `z.coerce.boolean()` bug ako K10
- **`vercel.json` buildCommand pattern** pre monorepo cleanup

## Commit-y v slice (chronologicky)

1. K1 — `feat(api): add categories module with CRUD, RBAC, and audit`
2. K2 — `feat(api): add cycle detection and max depth check for category hierarchy`
3. K3 — `feat(api): auto-derive category slug from name on create`
4. K4 — `refactor(api): extract hierarchy traversal into reusable lib/`
5. K5 — `feat(api): add locations module mirroring categories pattern`
6. K6 — `feat(api): add parentId hierarchy to locations`
7. K7 — `feat(api): validate categoryId and locationId FKs on asset POST/PATCH`
8. K8 — `test(api): expand audit log coverage for categories and locations`
9. K9 — `feat(api): protect category/location delete against referencing assets`
10. **K10** — `feat(api): add admin users module with RBAC and audit (slice 3 K10)`
11. K11 — `docs(milestones): slice #3 summary` ← **toto**

## Časová investícia

~3 dni rozdelené (2026-05-13, 2026-05-15, 2026-05-16):

- **2026-05-13**: K1-K3 categories foundation + slug logic (~4h)
- **2026-05-15**: K4-K9 categories+locations+FK (~6h s breaks)
- **2026-05-16**: K10 users admin module (~3h, end of marathon session)

Test infraštruktúra slice #2c sa **plne vyplatila** — žiadne re-inžinier-stvo
pomocných tools, fixture pattern stayed konzistentný, RBAC chain bol
re-použiteľný drop-in.

## End-to-end verifikácia

### Lokálne

```bash
cd apps/api
pnpm typecheck    # turbo-cached, ~200ms
pnpm test         # 310 testov, ~168s
```

### Pre-commit hook

```bash
git add ...
git commit -m "..."
# → husky beží lint-staged + pnpm typecheck
# → ak TS error: commit blocked, exit code 2
# → ak OK: commit proceeds
```

### Manuálny end-to-end (production Vercel)

```bash
API_BASE="https://asset-management-api-theta.vercel.app" \
  bash scripts/dev-auth-test.sh
```

Smoke testy stále pokrývajú asset CRUD; categories/locations/users admin
endpoints sú overené iba cez vitest integration testy. Manuálny script
sa rozšíri pri slice #4 (frontend), kde príde reálny end-to-end flow.

## Ďalšie kroky (slice #4 a ďalej)

### Slice #4 — Frontend `apps/web`

Multi-day projekt. Budujeme Next.js 15 + TanStack Query + shadcn/ui frontend
nad existujúcim API. Stack rozdelený:

- **Bootstrap**: Next.js setup, Tailwind, shadcn/ui base
- **Auth**: Microsoft Entra ID SSO login flow + token storage + refresh
- **Assets list view**: paginate, filter, search
- **Asset detail view**: GET /:id + PATCH/DELETE actions s RBAC UI
- **Loan workflow**: request → approve → pickup → return
- **Admin views**: users management, categories, locations (mockupy už existujú)
- **Polish**: WCAG 2.1 AA audit, responsive design, error states

### Tech debt cleanup (parallel slice alebo standalone)

1. Fix `categories.routes.ts isActive` (rovnaký pattern ako K10)
2. Export `LOCATION_TYPE_VALUES`, `UpdateCategorySchema`, `UpdateLocationSchema`
   do `@inventario/shared-types`
3. `audit.test.ts` timeout investigation

### Multi-tenant `organisationId` migration

Per ADR-0010, samostatný slice ktorý pridá `organisationId` do všetkých
collections + scope filtering do všetkých repositories. ~2 hod práce,
~40 testov treba update-núť.

## Referencie

- [Slice #2c milestone](slice-2c-tests-and-pre-commit.md)
- [Slice #2b milestone](slice-2b-assets-crud-rbac.md)
- [ADR-0010 Multi-tenant white-label](../decisions/0010-multi-tenant-white-label.md)
- [NEXT.md continuation plan](../sessions/NEXT.md)
- [MongoDB Transactions guide](https://www.mongodb.com/docs/manual/core/transactions/)
- [Zod docs — coerce vs transform](https://zod.dev/?id=coercion-for-primitives)
