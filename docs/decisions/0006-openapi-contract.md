<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0006. OpenAPI 3.1 ako strojovo čitateľný kontrakt API

|                   |                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | ✅ Accepted                                                                                                                                  |
| **Dátum**         | 2026-05-17 (Phase D — EU compliance foundations)                                                                                             |
| **Autori**        | Ján Letko, Claude Sonnet 4.6 (LTK Solutions)                                                                                                 |
| **Súvisiace ADR** | [0001 Monorepo](0001-monorepo-pnpm-turbo.md), [0009 Fastify](0009-backend-fastify.md), [0010 Multi-tenant](0010-multi-tenant-white-label.md) |

## Kontext

Projekt potrebuje strojovo čitateľný kontrakt API pre tri nezávislé účely:

1. **Slice #4 type-generation** — `apps/web` (Next.js frontend) potrebuje typované HTTP
   volania bez manuálnej duplikácie typov. Manuálne písaný klient by zastarávaval a
   divergoval od backendu.
2. **EU procurement** — verejný sektor čoraz viac vyžaduje OpenAPI spec ako súčasť tendra
   (strojovo overiteľný kontrakt). Pre cieľových tenantov (mestá, VÚC, zväzy, školy) je
   to praktická požiadavka.
3. **Multi-tenant white-label (ADR-0010)** — forky potrebujú jednoznačný kontrakt, z ktorého
   môžu generovať SDK alebo klientov pre vlastné integrácie bez záväzky na konkrétnu
   implementáciu.

Fastify (ADR-0009) má natívnu OpenAPI/Swagger podporu cez `@fastify/swagger`.

## Rozhodnutie

**OpenAPI 3.1** (nie 3.0) ako formát, generovaný deterministicky zo Zod schém cez
`@fastify/swagger` + `zod-to-json-schema`. Spec sa exportuje do `apps/api/openapi.json`
v repe ako statický artefakt.

### Prečo 3.1 (nie 3.0)

- OpenAPI 3.1 je plne kompatibilné s **JSON Schema draft 2020-12** — Zod generuje
  JSON Schema, takže mapovanie je priame bez konverzných strát.
- `nullable` z 3.0 je v 3.1 nahradené štandardným `oneOf: [type, null]` — konzistentné
  so Zod `.nullable()`.
- European Commission reference architecture uprednostňuje 3.1 pre nové projekty.

### Export workflow

```bash
pnpm --filter @inventario/api openapi:export
```

Skript `apps/api/scripts/export-openapi.ts` bootuje Fastify, čaká `app.ready()`, volá
`app.swagger()` a zapíše deterministicky pretty-printed JSON do `apps/api/openapi.json`.
Flag `--check` pre CI freshness overenie (exit 1 ak súbor na disku nezodpovedá).

### CI freshness guard

`.github/workflows/ci.yml` obsahuje job `openapi` ktorý spúšťa `--check` mode pri každom
PR a push na `main`. Ak niekto zmení route bez regenerovania `openapi.json`, CI zlyhá.

### Frontend konsumácia

`apps/web` používa `openapi-typescript` na generovanie `src/lib/api-types.ts`
a `openapi-fetch` na typovaný HTTP klient. Single source of truth: `apps/api/openapi.json`.

### Čo nie je v rozsahu

- Interaktívna Swagger UI je dostupná v dev na `/documentation` (cez `@fastify/swagger-ui`),
  ale v produkcii je vypnutá (`ENABLE_SWAGGER=false`). OpenAPI spec je exportovaný artefakt,
  nie live endpoint.
- Verziovanie API (v2, v3) — všetky endpointy sú pod `/v1`; breaking changes idú cez
  nový prefix, nie cez OpenAPI verzie.

## Dôsledky

- `apps/api/openapi.json` je v repe ako commitovaný artefakt — musí sa regenerovať
  pri každej zmene routes/schém (CI guard to vynucuje).
- `.prettierignore` excluduje `openapi.json` — deterministický `JSON.stringify` formát
  by Prettier prepísal a CI freshness check by padol.
- `apps/web/src/lib/api-types.ts` je generovaný súbor — neupravovať ručne.

## Referencie

- [Phase D milestone](../milestones/phase-d-eu-compliance.md) — kde bola táto rozhodnutie implementované
- [apps/api/scripts/export-openapi.ts](../../apps/api/scripts/export-openapi.ts)
- [apps/api/openapi.json](../../apps/api/openapi.json)
- `apps/web/src/lib/api-types.ts` — generovaný z `openapi.json` cez `pnpm generate:api-types`, preto nie je v gite (`apps/web/.gitignore`)
