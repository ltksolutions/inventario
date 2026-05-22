# Slice #1 — Backend Bootstrap (Completed 2026-05-12)

## Cieľ

Postaviť funkčný Fastify backend v cloude s pripojením na MongoDB Atlas a zverejniť ho cez Vercel Serverless Functions. Read-only, žiadna autentifikácia (príde v slice #2).

## Výsledok

✅ **Backend beží na cloude:**

- Production URL: `https://asset-management-pnic485dt-ltksolutions-projects.vercel.app`
- (URL sa mení s každým deployom; alias bude pridaný neskôr)

✅ **Endpointy:**

| Endpoint                         | Účel                     | Verified      |
| -------------------------------- | ------------------------ | ------------- |
| `GET /health`                    | Liveness probe           | ✅            |
| `GET /health/ready`              | Readiness (Mongo ping)   | ✅ `mongo:ok` |
| `GET /v1/assets?limit=20&skip=0` | List assets s pagináciou | ✅            |
| `GET /docs`                      | Swagger UI               | ✅            |
| `GET /`                          | Redirect na `/docs`      | ✅            |

## Architektúra

### Stack

- **Fastify 5** — backend framework (per [ADR-0009](../decisions/0009-backend-fastify.md))
- **MongoDB native driver 6** — bez ORM
- **Zod 3** — validácia (env, request/response)
- **fastify-type-provider-zod** — Zod ↔ JSON Schema bridge
- **@fastify/swagger** + **@fastify/swagger-ui** — OpenAPI 3.1 generation

### Deployment

- **Vercel Serverless Functions** (`@vercel/node@5.0.0`)
- **Node.js 24.x** runtime (auto-upgraded z `engines: >=22.20.0`)
- **MongoDB Atlas M0 (free)** — `sfz-asset-dev` cluster, AWS Frankfurt (eu-central-1)
- Auto-deploy z `main` branch

### Štruktúra `apps/api/`

```
apps/api/
├── api/index.ts               # Vercel serverless entry point
├── api/package.json           # ESM declaration pre Vercel runtime
├── api/tsconfig.json          # Vercel-specific TS config
├── src/
│   ├── index.ts               # Local dev entry (tsx watch)
│   ├── server.ts              # buildServer() factory
│   ├── plugins/
│   │   ├── config.ts          # Zod env validation
│   │   ├── mongo.ts           # Mongo client + module-level cache
│   │   ├── error-handler.ts   # HttpError hierarchy
│   │   └── swagger.ts         # OpenAPI 3.1 + Swagger UI
│   └── modules/
│       ├── health/health.routes.ts
│       └── assets/
│           ├── assets.routes.ts
│           ├── assets.service.ts
│           └── assets.repository.ts
├── package.json
├── tsconfig.json              # Build config (src/ only)
├── tsconfig.eslint.json       # Typecheck config (src/ + api/)
└── vercel.json                # Vercel deployment config
```

## Kľúčové vzory

### Vercel serverless friendly Mongo

`plugins/mongo.ts` cache-uje `MongoClient` na úrovni **modulu** (nie Fastify scope). Vercel warm invocations zdieľajú modul state ~5-15 minút, takže následné requesty znovu nepoužijú connection. Mongo settings: `maxPoolSize: 1`, `minPoolSize: 0`, `maxIdleTimeMS: 10s`, `serverSelectionTimeoutMS: 5s`.

### Dual entry point pattern

- `src/index.ts` — local dev (`pnpm dev` → `tsx watch`)
- `api/index.ts` — Vercel handler (cached `buildServer()` cez module-level Promise, emituje `request` event na fastify.server)

Obidva volajú `buildServer()` z `src/server.ts`, ktorá je test-friendly factory.

### Schema-on-write, trust-on-read

`GET /v1/assets` vracia `data: z.array(z.record(z.string(), z.unknown()))` — bez plnej Asset validácie na read path. Schémy z `@inventario/shared-types` sa použijú pri zápise v slice #2.

## Issues vyriešené počas sedenia

Postupne sme prešli ~15 CI/build/runtime problémami. Hlavné:

1. **Vercel build cesta** — Vercel detekoval Turbo a chcel buildnúť celý monorepo. Fix: explicit `buildCommand` v `vercel.json` + Root Directory = `apps/api`.

2. **NODE_ENV=production skip-uje devDependencies** — pnpm vynechal `typescript`, `tsc` nenájdený. Fix: odstrániť `NODE_ENV` env var z Vercel UI (Vercel ho nastavuje per-environment sám).

3. **ESM vs CommonJS** — `@vercel/node` zachádzal s `api/index.ts` ako CommonJS pod `verbatimModuleSyntax`. Fix: lokálny `api/package.json` s `"type":"module"` + lokálny `api/tsconfig.json` bez `verbatimModuleSyntax`.

4. **Static output expectation** — Vercel čakal `public/` adresár. Fix: `vercel.json` ➞ `"outputDirectory": "."`.

5. **Node.js version conflict** — Project Settings (24.x) vs `engines: >=22.20.0`. Vyriešilo sa po Production Override reset + redeploy.

6. **Vitest "no test files found"** — exit code 1 v CI. Fix: `vitest run --passWithNoTests` v `package.json` scripts.

7. **MONGO_URI validation** — `z.string().url()` zlyhalo na `mongodb+srv://` (Zod custom schemes problém). Fix: explicit `.refine()` allowlist.

8. **CORS_ORIGINS=`*` + credentials:true** — browser security violation. Fix: disable credentials pri wildcard origin.

9. **Pôvodné DB heslo leaknuté v chat** — okamžite rotované cez Atlas UI.

10. **Vercel Deployment Protection** — blokovalo public curl. Fix: vypnuté v Settings (slice #2 pridá Entra ID auth).

## Environment Variables (Vercel)

| Key              | Value                                                        | Notes                                    |
| ---------------- | ------------------------------------------------------------ | ---------------------------------------- |
| `MONGO_URI`      | `mongodb+srv://sfz-api:***@sfz-asset-dev....mongodb.net/...` | Atlas connection string                  |
| `MONGO_DB_NAME`  | `sfz_asset_management`                                       |                                          |
| `LOG_LEVEL`      | `info`                                                       |                                          |
| `ENABLE_SWAGGER` | `true`                                                       |                                          |
| `CORS_ORIGINS`   | `*`                                                          | Temporary; restrict po pridaní frontendu |
| `NODE_ENV`       | —                                                            | NEnastavovať; Vercel ho nastavuje sám    |

## Čo NIE JE v slice #1

Vedome odložené do ďalších slices:

- ❌ **Autentifikácia** (Entra ID JWT) → **slice #2**
- ❌ **POST/PATCH/DELETE** endpointy → **slice #2**
- ❌ **Audit log** zápis → **slice #2**
- ❌ **Bulk import** assets → **slice #3** (kvôli 30s Vercel timeoutu)
- ❌ **Frontend** (`apps/web`) → vlastná fáza
- ❌ **MCP server** (`apps/mcp-server`) → fáza 3
- ❌ **Tests** — pridajú sa per-module v slices #2+
- ❌ **Production URL alias** (`api.inventario.estate`) → po stabilizácii
- ❌ **Seed dáta** v Atlas → manuálne alebo seed script (TBD)

## Časová investícia

~5 hodín spoločnej práce. Veľká časť bola **iterácia cez Vercel build/runtime errors** — každý fix odhalil ďalší. Bola to **dôležitá investícia do platformových znalostí** ktorú nebudeme musieť opakovať.

## Commity (chronologicky)

```
6703ae8  feat(api): bootstrap Fastify backend (vertical slice #1)
48ed91a  fix(api): explicit vercel.json buildCommand and outputDirectory
22e3338  chore(turbo): add Vercel env vars to globalEnv
1ac0a04  fix(api): explicit ESM module declaration for Vercel runtime
b4683a5  fix(api): pass tests with no files in CI
17da75c  chore: trigger Vercel redeploy for Node.js 22.x
a8e3b03  fix(api): accept mongodb+srv:// in env validation and handle CORS wildcard
```

Plus ADR commit: `efb518c docs(adr): supersede ADR-0002 (NestJS) with ADR-0009 (Fastify)`.

## Ďalšie kroky (slice #2)

1. **Entra ID JWT verification** — `@fastify/jwt` + `jwks-rsa` plugin pre validáciu Microsoft Entra ID tokenov
2. **Auth guard** — preauth hook pre chránené endpointy
3. **POST /v1/assets** — vytvorenie assetu (s Zod validáciou z `@sfz/shared-types`)
4. **PATCH /v1/assets/:id** — update
5. **DELETE /v1/assets/:id** — soft delete (`deletedAt: Date`)
6. **Audit log** — `audit_logs` collection s before/after diff
7. **Tests** — vitest + supertest, prvý batch test coverage

## Referencie

- [ADR-0009: Backend Fastify on Vercel](../decisions/0009-backend-fastify.md)
- [ADR-0002: Backend NestJS (Superseded)](../decisions/0002-backend-nestjs.md)
- [apps/api README](../../apps/api/README.md)
