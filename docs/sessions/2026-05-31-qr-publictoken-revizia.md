<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-05-31 — QR kódy: revízia ADR-0021 (publicToken + konfig. inventoryNumber)

## Kontext

Diskusia o návrhu QR kódu majetku, nadväzujúca na pôvodné znenie ADR-0021 z toho istého dňa.
Časť diskusie prebehla na mobile (bez prístupu k disku), finalizácia a zápis na MacBooku.
Výsledok: **prepísané ADR-0021** podľa upravených rozhodnutí.

---

## Čo sa zmenilo oproti pôvodnému ADR-0021

Pôvodné znenie malo v QR `inventoryNumber` a `publicToken` odkladalo do Fázy 2.
Revízia to obracia a dopĺňa konfigurovateľnosť čísla:

### 1. QR kľúčované `publicToken`, nie `inventoryNumber`

- QR = `https://{tenantDomain}/scan/{publicToken}`.
- `publicToken` — náhodný, neuhádnuteľný (nanoid/UUIDv4), unikátny, indexovaný,
  generovaný **vždy** pri POST, nemenný. Verejný povrch tým prestáva byť enumerovateľný.
- `publicToken` presunutý z Fázy 2 do jadra rozhodnutia (Fáza 1).

### 2. `inventoryNumber` = administratívne pole, konfigurovateľné per tenant

- Ostáva ľudsky čitateľné (štítok popri QR, inventúrne zostavy), **nie je v QR**.
- Default `{PREFIX}-{YYYY}-{NNNN}`.
- Nové `inventoryNumberFormat { prefix, padding, includeYear, resetYearly }` na `Organisation`
  — parametrická varianta (nie voľný textový template; ten je zdroj kolízií a nekonzistencie).
- Plný template-based režim odložený do Fázy 2.

### 3. Zdroj tenant domény — rozhodnuté (bola otvorená otázka)

- `tenantDomain = organisation.appBaseUrl` (pole v tenant configu v DB, validované ako URL,
  povinné pri onboardingu).
- **Nikdy** z `Host`/`X-Forwarded-Host` (proxy/preview-závislé, host-header injection).
- Env fallback (`PUBLIC_APP_BASE_URL`) pre single-tenant fork — potvrdiť pri implementácii.

### 4. Bez zmeny oproti pôvodnému (potvrdené)

- QR on-demand cez `GET /v1/assets/:id/qr?format=svg|png`, neukladá sa.
- Verejný lookup `GET /public/scan/:publicToken`, opt-in per tenant (`publicAssetLookup`,
  default false), `foundContactInfo`.
- `PublicAssetView` ako samostatná Zod schéma — explicitný whitelist, NIE Pick/Omit z Asset DTO.
- DPIA dopad → Compliance Fáza 2.

---

## Dátový model (súhrn pre implementáciu)

- **Asset:** nové `publicToken` (unique index, CSPRNG, pri POST, nemenné).
- **Organisation:** `appBaseUrl`, `inventoryNumberFormat`, `publicAssetLookup` (default false),
  `foundContactInfo`.
- Všetko cez Zod v `packages/shared-types` (single source of truth) → TS → JSON Schema →
  Mongo `$jsonSchema` → OpenAPI.
- **Migrácia:** dogenerovať `publicToken` existujúcim assetom.

---

## Čaká

- Implementácia (odporúčaný **Opus** — verejný povrch + DPIA dopad):
  schémy, `publicToken` generovanie, QR endpoint, verejný `/public/scan`, rate-limit,
  whitelist test, migrácia. Vždy s testami; po zmene `pnpm typecheck` + `pnpm test`.
- Pred implementáciou povýšiť ADR-0021 na **Accepted**.
- Otvorené: env fallback pre `appBaseUrl`, presné polia found-view DTO, per-asset `discoverable`.

## Zmenené súbory

- `docs/decisions/0021-asset-qr-codes.md` — prepísané rozhodnutia 1, 5, 6 + nový bod 7,
  aktualizované možnosti, dôsledky, riziká, fázovanie, referencie.
- `docs/sessions/NEXT.md` — sekcia 7 zosúladená s revíziou, aktualizovaná hlavička.
- `docs/sessions/2026-05-31-qr-publictoken-revizia.md` — tento log.
