<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session log — 2026-06-10 · Detail majetku: Audit log, Prílohy/foto, QR/štítky, scan flow

Spustené z testovania detalu majetku `MacBook Air, SFZ-2026-00001`. Plán: `2026-06-10-asset-detail-fixes-plan.md`.

## Čo sa urobilo

### 1. Preberací protokol PDF — serialNumber + category

`insertDraftProtocol` (loans.service) hardcodoval `serialNumber: null`, `category: ''`. Teraz sa v tej istej transakcii načíta asset (serialNumber + categoryId) a názvy kategórií jedným tenant-scoped dotazom. Podpísané protokoly ostávajú nemenné (ADR-0022). Commit `fcf116b`.

### 2. appBaseUrl + QR/štítky

- `appBaseUrl` pridaný do PATCH `/current` aj admin `/:id` + pole v Organizácia → QR kódy a štítky (`3a85b3b`).
- `resolveAppBaseUrl` helper: per-tenant → env `APP_BASE_URL` → default `https://app.inventario.estate`; QR aj 3 label endpointy už nevracajú 409 (`ba2c82e`). Test prepísaný (`8167327`).

### 3. Audit log tab

`AuditLogRepository.findByTarget` + `countByTarget`; `GET /v1/assets/:id/audit` (ASSET_MANAGER/ADMIN, stránkované); frontend `AuditLogTab` (časová os, tab len pre canEdit). Commit `f4656ce`.

### 4. Prílohy + foto majetku (Vercel Blob)

Nový attachments modul (repo + routes), `Attachment` tenant-scoped + `isPrimary`. Endpointy `POST/GET /v1/assets/:id/attachments`, `DELETE /v1/attachments/:id`, `PATCH /v1/attachments/:id/primary`. Magic-byte validácia PNG/JPEG/WEBP/PDF, max 20 MB. Frontend: upload, galéria, doklady, hlavné foto na hero karte. Commity `2b3f849`, `0e5a2a5`.

### 5. Auth-aware QR sken + privacy verejnej stránky

- `GET /v1/assets/by-token/:publicToken` (autentifikované, tenant-scoped) → prihlásený člen tenanta sa po skene presmeruje na interný detail `/assets/:id`.
- Neprihlásený → verejná lost&found stránka **bez identity majetku** (názov/inv. číslo odstránené z `PublicAssetView`), len org + kontakt na vrátenie. Gated `publicAssetLookup` (prepínač pridaný do nastavení, `224caf3`). Commit `742e074`.

## Opravené bugy (odhalené pri smoke teste)

- PDF štítok **500** — `embedPng` na JPEG logu SFZ → `embedJpg` cez magic bytes (`2b53304`).
- Boot **500 `FST_ERR_CTP_ALREADY_PRESENT`** — `@fastify/multipart` registrovaný 2×; teraz raz globálne v `server.ts` (`7b419e1`).
- QR inline náhľad prázdny — `<img src>` neposiela cross-origin cookie → credentialed fetch + blob URL (`dd362fa`).

## Overenie

- `pnpm typecheck`, `pnpm lint` — ✅ (API, web, shared-types; spúšťané priebežne v sandboxe).
- `pnpm --filter @inventario/api test` — **941/941 green** (lokálne u Janiku).
- `openapi.json` regenerovaný (`e2c5601`, `480eba1`); CI `openapi:export:offline --check` prejde.
- Vercel deploy z `main` (automaticky). `BLOB_READ_WRITE_TOKEN` nastavený (Vercel aj `.env.local`).

## Pozn. / gotchas

- **JPEG logo bug už 2×** (protocol + labels): akýkoľvek pdf-lib embed loga musí vetviť PNG/JPEG cez magic bytes, nikdy hardkódovať `embedPng`.
- Obrázky/súbory z API s auth → načítavať cez credentialed `fetch`, nie `<img src>`.
- Sandbox neutiahne vitest/openapi (chýba linux rollup/esbuild binárka; `pnpm install` zakázaný) → tsc+eslint áno, testy/openapi lokálne u Janiku.

## Follow-upy (nice-to-have)

- Audit eventy pre prílohy (chýba enum akcia v `audit-log` schéme).
- EXIF strip pri fotkách; prípadne súkromné (nie verejné) blob URL pre citlivé doklady.
- Zebra ZPL vetva (ADR-0027) existuje, len nebola naživo odskúšaná na ZD420.
