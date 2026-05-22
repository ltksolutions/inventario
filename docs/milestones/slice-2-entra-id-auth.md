# Slice #2 — Entra ID Auth (Completed 2026-05-12)

## Cieľ

Autentifikácia cez Microsoft Entra ID. Validácia JWT z Microsoftu, JIT
provisioning užívateľov v Mongo, ochrana existujúcich CRUD endpointov.
**Bez RBAC, bez CRUD na assety, bez audit logu** — tie prídu v slice #2b
(rozdelili sme pôvodný plán na dva slice-y kvôli scope-u).

## Výsledok

✅ **Auth funguje end-to-end lokálne aj v prod:**

- Production URL: `https://asset-management-pw5ct885v-ltksolutions-projects.vercel.app`
  (URL sa mení s každým deployom; alias bude pridaný neskôr)
- Microsoft Entra ID JWT validácia (signature + claims)
- JIT provisioning užívateľa s default rolou `EMPLOYEE` pri prvom prihlásení
- `users` collection v Mongo s 3 indexmi (vrátane unique `entraOid`)
- Race-condition safe (duplicate-key handling pri súbežných JIT requestoch)
- Idempotentné — opakované volania `/v1/me` nevytvárajú duplicity

✅ **Endpointy:**

| Endpoint            | Auth       | Účel                                            | Verified |
| ------------------- | ---------- | ----------------------------------------------- | -------- |
| `GET /health`       | none       | Liveness probe (ostáva verejný)                 | ✅       |
| `GET /health/ready` | none       | Readiness (Mongo ping, ostáva verejný)          | ✅       |
| `GET /v1/me`        | **Bearer** | Vlastný profil + JIT provisioning pri 1. volaní | ✅       |
| `GET /v1/assets`    | **Bearer** | List assets (predtým verejné — teraz chránené)  | ✅       |
| `GET /docs`         | none       | Swagger UI s "Authorize" tlačidlom              | ✅       |

## Architektúra

### Stack (pribudlo oproti slice #1)

- **@fastify/jwt 9** — Fastify integration (zatiaľ použité len cez `jose` pre verifikáciu, plugin samotný je pripravený pre prípadné rozšírenie)
- **get-jwks 11** — fetch + cache JWKS z Microsoft endpoint-u, podpora rotácie kľúčov
- **jose 5** — moderná JWT library; signature verification + claim validation

### Štruktúra zmien

```
apps/api/
├── .env.example                          # +ENTRA_TENANT_ID, +ENTRA_API_CLIENT_ID, +ENTRA_CLI_CLIENT_ID
├── package.json                          # +@fastify/jwt, +get-jwks, +jose; --env-file=.env.local v dev/start scripts
├── README.md                             # device code flow návod + auth section
├── scripts/
│   └── dev-auth-test.sh                  # NEW — end-to-end auth flow z terminálu
├── src/
│   ├── server.ts                         # registrácia auth plugin + users routes
│   ├── plugins/
│   │   ├── config.ts                     # ENTRA_TENANT_ID + ENTRA_API_CLIENT_ID required + odvodené (issuer/jwks/audiences)
│   │   └── auth.ts                       # NEW — requireAuth preHandler, EntraClaims, JWT verification
│   └── modules/
│       ├── users/                        # NEW MODULE
│       │   ├── users.repository.ts       # CRUD + ensureIndexes (entraOid, email, isActive_deletedAt)
│       │   ├── users.service.ts          # findOrProvision + race-condition handling
│       │   └── users.routes.ts           # GET /v1/me
│       └── assets/
│           └── assets.routes.ts          # preHandler: requireAuth pridaný
```

## Kľúčové vzory

### Resolved config — odvodené hodnoty z env vars

`plugins/config.ts` rozšírený o `ResolvedConfig`, ktorý okrem env vars
poskytuje aj odvodené:

- `ENTRA_ISSUER_RESOLVED` — `https://login.microsoftonline.com/<tenant>/v2.0`
- `ENTRA_JWKS_URI_RESOLVED` — pre dokumentačné účely; samotný JWKS fetch
  rieši `get-jwks` cez OIDC discovery
- `ENTRA_ACCEPTED_AUDIENCES` — pole `[<client_id>, "api://<client_id>"]`,
  lebo `aud` claim sa môže objaviť v oboch formátoch

### JWT verification flow (plugins/auth.ts)

```
1. Bearer header → token
2. decodeProtectedHeader(token) → header.kid, header.alg
3. Reject ak alg ≠ 'RS256'                       (anti algorithm confusion)
4. getJwks.getJwk({domain: issuer, alg, kid})    → publicJwk
5. jose.jwtVerify(token, keySet, {issuer, audience, algorithms, clockTolerance: 30s})
6. assertEntraClaims(payload)                    → oid, tid, sub, ver, scp prítomné a správne
7. Reject ak tid ≠ ENTRA_TENANT_ID               (defense in depth)
8. Reject ak scp neobsahuje 'access_as_user'
9. request.entraClaims = payload
```

### JIT provisioning (users.service.ts)

```
findOrProvision(claims):
  existing = repo.findByEntraOid(claims.oid)
  if existing:
    void repo.touchLastLogin(claims.oid)    # fire-and-forget
    return existing
  newUser = buildUserFromClaims(claims)
  try:
    return repo.insert(newUser)
  except DuplicateKeyError (code 11000):
    # Race: another request just inserted. Re-fetch the winner's record.
    return repo.findByEntraOid(claims.oid)
```

Default rola pre JIT user je `EMPLOYEE`. Admini menia roly priamo v DB
(slice #2b pridá admin endpointy).

### Mongo indexy (users collection)

```js
{ entraOid: 1 }, { unique: true, sparse: true }   // fast SSO lookup, allow null pre LOCAL
{ email: 1 },    { unique: true }                  // jeden účet na email
{ isActive: 1, deletedAt: 1 }                     // list-active queries
```

Indexy sa vytvárajú **lazily pri štarte servera** cez
`UsersRepository.ensureIndexes()` (volané z `users.routes.ts` plugin
loadu). Mongo `createIndex` je idempotentné — žiadny problém s opakovaným
volaním pri každom cold-start Vercel inštancie.

### Password hash projection

`PUBLIC_PROJECTION = { passwordHash: 0 }` aplikované **vo všetkých
read methodoch** repository. Aj keď slice #2 LOCAL účty nepodporuje, projekcia
je nasadená pre defensive depth — keď v budúcom slice pridáme LOCAL flow,
hash sa nikdy nemôže omylom dostať do API response.

## Issues vyriešené počas sedenia

Hlavné problémy s ktorými sme sa boroli (a poučenia):

### 1. `--env-file=.env.local` chýbal v dev/start scripts

`tsx watch src/index.ts` neautomatici nečíta `.env.local`. Po required-i
`ENTRA_TENANT_ID` v Zod config schéme `pnpm dev` zlyhal pri boot-e.
Fix: `"dev": "tsx watch --env-file=.env.local src/index.ts"` (Node 22+
podporuje natívne `--env-file`). Vercel deployment **týmto nedotknutý** —
serverless handler `api/index.ts` číta priamo `process.env`.

### 2. `get-jwks@11` API zmena: `allowedDomains` → `issuersWhitelist`

V staršej verzii bolo `allowedDomains: [...]`, v `v11` to musí byť
`issuersWhitelist: [<full-issuer-url>]`. Typecheck to našiel okamžite.

### 3. `get-jwks` `JWK` type ≠ `jose` `JWK` type

`get-jwks` má loose `{ [key: string]: any; domain; alg; kid }`, `jose`
chce strict `{ kty: string; ... }`. V praxi Microsoft vracia `kty` vždy,
takže `as unknown as JWK` cast je v poriadku — bridge medzi dvomi
nezávislými type systemmi knižníc.

### 4. **`Token signing key not found in JWKS` — JWKS path problem** (najväčší)

`get-jwks` defaultne fetch-uje JWKS z `<domain>/.well-known/jwks.json`.
**Microsoft Entra túto cestu neimplementuje** — JWKS je na
`https://login.microsoftonline.com/<tenant>/discovery/v2.0/keys`. Fetching
defaultnej cesty vracal prázdnu odpoveď → `JSON.parse('')` →
`Unexpected end of JSON input` SyntaxError → "key not found".

Fix: `providerDiscovery: true` v `buildGetJwks(...)`. Spustí OIDC
discovery flow — knižnica fetchne `<issuer>/.well-known/openid-configuration`
(ktoré Microsoft poskytuje), zo dokumentu vytiahne `jwks_uri` a fetchne
JWKS z neho.

**Lesson:** vždy zapnúť `providerDiscovery: true` pri integrácii s OIDC
provider-om, ktorého JWKS path nie je default. Microsoft je tu špecifický
ale tento isté platí pre Auth0, Okta, atď.

### 5. Asset registration: confidential vs public client

CLI app v Azure musí mať **"Allow public client flows: Yes"** (Authentication
→ Advanced settings). Bez toho Microsoft pri token endpoint volaní pýta
`client_secret`, čo public client (device code flow) nemá. Chyba bola
`AADSTS7000218: client_assertion or client_secret required`.

### 6. CLI client ID v `.env.local`, nie inline v skripte

Pôvodne mal `scripts/dev-auth-test.sh` placeholder na inline edit. `sed`
omylom nahradil prvý výskyt v guard checku, nie samotnú premennú →
script bežal s placeholderom. Refactored: script číta `ENTRA_CLI_CLIENT_ID`
z `.env.local` rovnako ako tenant/API ID. Žiadny inline edit.

### 7. macOS BSD `cut`/`base64` vs GNU

Pôvodný diagnostický blok na decoding JWT používal `cut -c1-N` s
dynamickou N pre base64 padding. BSD `cut` na macOS odmieta `N=0`
("values may not include zero"), čo nastane pri 4-aligned strings.
Riešenie: `python3` na decoding (vstavaný v macOS, bez BSD/GNU rozdielov).

### 8. `accessTokenAcceptedVersion: 2` v API app manifeste

Bez tejto úpravy by Entra vystavovala v1 tokeny (issuer `sts.windows.net/<tenant>/`,
iné JWKS endpointy). Krok 6 Azure návodu — manuálne editovať manifest.
**Skontrolovať pri každom nove app registration!**

## Environment Variables (Vercel)

Pribudli oproti slice #1:

| Key                   | Value                 | Notes                                     |
| --------------------- | --------------------- | ----------------------------------------- |
| `ENTRA_TENANT_ID`     | `bcd6945a-...` (GUID) | Directory (tenant) ID, required           |
| `ENTRA_API_CLIENT_ID` | `7927aaa3-...` (GUID) | API app Application (client) ID, required |

`ENTRA_CLI_CLIENT_ID` (`40b9...`) je len lokálne v `.env.local` pre
`dev-auth-test.sh`. Vercel ju nepotrebuje — server ju nečíta. Frontend
v slice #3+ bude mať vlastnú SPA app registration s vlastným client ID.

Server logu pri starte vypíše truncated tenant ID:

```
INFO Configuration loaded
    entraTenantId: "bcd6945a…"
    entraIssuer:   "https://login.microsoftonline.com/<full-tenant>/v2.0"
```

## Azure App Registrations

Slice #2 vyžaduje **dve app registrations** v Entra ID:

### 1. API app — `Inventario API (dev)`

- **Supported account types:** Single tenant
- **Redirect URI:** none (API app)
- **Expose an API:**
  - Application ID URI: `api://<api-client-id>`
  - Scope `access_as_user` — Admins and users, Enabled
- **Token configuration:** optional claims `email`, `family_name`, `given_name`, `preferred_username` (typ Access)
- **Manifest:** `"accessTokenAcceptedVersion": 2`
- **Authentication:** žiadne platform configs potrebné

### 2. CLI app — `Inventario CLI (dev test)`

- **Supported account types:** Single tenant
- **Platform:** Mobile and desktop applications, redirect URI `http://localhost`
- **API permissions:** Delegated → SFZ API → `access_as_user` + **Grant admin consent**
- **Authentication → Advanced settings → Allow public client flows: Yes**

CLI app je **len pre lokálne dev testing** — generuje JWT-y cez device
code flow z terminálu. V produkčnom frontende bude vlastná SPA app
registration s PKCE flow.

## Čo NIE JE v slice #2

Vedome odložené (väčšina pôvodne plánovaná v slice #2, presunutá do #2b):

- ❌ **POST `/v1/assets`** — vytvorenie assetu → **slice #2b**
- ❌ **PATCH `/v1/assets/:id`** — update → **slice #2b**
- ❌ **DELETE `/v1/assets/:id`** — soft delete → **slice #2b**
- ❌ **Audit log** zápis do `audit_logs` collection → **slice #2b**
- ❌ **RBAC** (`@requireRole` decorator, role checks) → **slice #2b**
- ❌ **Tests** (vitest + supertest) — písali sme manuálne, automatizujeme v #2b
- ❌ **Admin endpointy** (`GET /v1/users`, `PATCH /v1/users/:id/role`) → slice #3
- ❌ **LOCAL účty** (bez Entra) → fáza 4
- ❌ **Frontend** (`apps/web`) → vlastná fáza

## Časová investícia

~3 hodiny spoločnej práce. Najviac času zožrali:

1. **`Token signing key not found in JWKS`** (~45 min) — vyžadovalo si
   prečítanie `get-jwks` zdrojáku aby som pochopil že `providerDiscovery`
   je potrebné. Bez tohto by sme tu blúdili dlhšie.
2. **Azure setup iterations** (~45 min) — viacero kolách "manifest treba
   uložiť", "Allow public client flow je vypnuté", "API permission
   chýba". Po každej úprave 2-3 minútová iterácia s `dev-auth-test.sh`.
3. **CLI client ID workflow** (~15 min) — `sed` problem + refactor scriptu
   aby čítal z `.env.local`.

Zvyšok bolo "Claude píše kód, používateľ build/lint/typecheck — všetko zelené".

## Commity (chronologicky)

```
9b7c464  feat(api): add Entra ID auth + JIT user provisioning (slice #2)
```

Single squash-style commit (15 zmenených / nových súborov). Alternatívne sa
slice mohol rozdeliť na 3 menšie (config+plugin, users module,
scripts+docs), ale vrstvy su prepletené (auth plugin sa používa v users
routes, ktoré zase rozhodujú o tom, čo tam v config-u byt musí) — jeden
funkčný celok bol čistejší.

## End-to-end verifikácia

### Lokálne

```bash
cd apps/api
pnpm dev                            # spustí server na :3000
bash scripts/dev-auth-test.sh       # device code flow + 3 protected endpoint calls
```

### Produkčný Vercel deploy

```bash
cd apps/api
API_BASE="https://asset-management-pw5ct885v-ltksolutions-projects.vercel.app" \
  bash scripts/dev-auth-test.sh
```

Obe spustená vrátia identický výsledok (rovnaký Mongo Atlas cluster):

Output (redacted):

```
✓ Token claims:
   iss: "https://login.microsoftonline.com/<tenant>/v2.0"
   aud: "<api-client-id>"
   ver: "2.0"
   scp: "access_as_user"

✓ GET /v1/me:
   _id: "6a03…"
   firstName: "Ján", lastName: "Letko"
   accountType: "ENTRA_ID"
   roles: ["EMPLOYEE"]

✓ GET /v1/assets:
   data: []
   pagination: { total: 0, ... }

✓ Same _id on both /v1/me calls — JIT idempotent
```

Mongo Atlas → `inventario.users` collection (pozn.: DB názov bol následne prer-
menovaný na `inventario`):

- 1 document (`Ján Letko`)
- 4 indexes (`_id_`, `entraOid_unique`, `email_unique`, `isActive_deletedAt`)

## Ďalšie kroky (slice #2b)

1. **POST `/v1/assets`** — create asset s `CreateAssetSchema` validáciou
2. **PATCH `/v1/assets/:id`** — update s `UpdateAssetSchema`
3. **DELETE `/v1/assets/:id`** — soft delete (`deletedAt` + `deletedBy`)
4. **Audit log** — service-level `AuditLogService` zapisuje pred/po každej write operácii
5. **RBAC** — `requireRole(UserRole.ASSET_MANAGER, UserRole.ADMIN)` decorator
6. **Tests** — vitest + supertest, manual `dev-auth-test.sh` flow ako baseline
7. **Atomic write + audit** — neskôr cez Mongo transaction (vyžaduje M10+ replica set)

## Referencie

- [ADR-0009: Backend Fastify on Vercel](../decisions/0009-backend-fastify.md)
- [Slice #1 milestone](slice-1-backend-bootstrap.md)
- [apps/api README](../../apps/api/README.md) — device code flow návod
- [Microsoft: OIDC on the Microsoft identity platform](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc)
- [get-jwks#11.0.3 source](https://github.com/nearform/get-jwks/tree/v11.0.3)
