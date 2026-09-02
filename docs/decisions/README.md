<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Architecture Decision Records (ADR)

Tento adresár obsahuje záznamy o významných architektonických rozhodnutiach v projekte.

## Čo je ADR?

ADR je krátky dokument, ktorý zachytáva jedno významné technické rozhodnutie: **kontext, možnosti, voľbu a dôsledky**. Slúži ako pamäť projektu – aby budúci členovia tímu (aj my sami o pol roka) vedeli, _prečo_ sme niečo urobili tak, ako sme to urobili.

## Kedy vytvoriť nové ADR?

- Voľba technológie (framework, knižnica, DB)
- Architektonický vzor (event sourcing, CQRS, ...)
- Bezpečnostné rozhodnutie (auth flow, šifrovanie)
- Významné zmeny v existujúcom rozhodnutí (vtedy nový ADR so statusom „Supersedes 000X")

## Konvencie

- Číslovanie: `NNNN-kratky-nazov-pomlckami.md` (napr. `0007-mongo-vs-postgres.md`)
- Status: `Proposed` → `Accepted` → prípadne `Superseded` / `Deprecated`
- Jazyk: slovenčina v texte, angličtina v identifikátoroch
- Šablóna: [template.md](template.md)

## Zoznam ADR

| #    | Názov                                                                                                               | Status                                                    | Dátum      |
| ---- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------- |
| 0001 | [Monorepo s pnpm + Turborepo](0001-monorepo-pnpm-turbo.md)                                                          | Accepted                                                  | máj 2026   |
| 0002 | [NestJS ako backend framework](0002-backend-nestjs.md)                                                              | 🚫 Superseded by 0009                                     | máj 2026   |
| 0003 | [MongoDB Atlas ako primárna databáza](0003-mongodb-atlas.md)                                                        | Accepted                                                  | máj 2026   |
| 0004 | [Microsoft Entra ID ako identity provider](0004-auth-entra-id.md)                                                   | 🚫 Superseded by 0013                                     | máj 2026   |
| 0005 | [Natívny MongoDB driver + Repository pattern (bez Mongoose)](0005-mongo-native-driver.md)                           | Accepted                                                  | máj 2026   |
| 0006 | [OpenAPI 3.1 ako strojovo čitateľný kontrakt API](0006-openapi-contract.md)                                         | ✅ Accepted                                               | 2026-05-17 |
| 0007 | _(nahradené ADR-0017)_ MCP server pre AI integrácie                                                                 | 🔄 Replaced by 0017                                       | –          |
| 0008 | [Next.js 15 + shadcn/ui ako frontend stack](0008-frontend-nextjs.md)                                                | ✅ Accepted                                               | 2026-05-17 |
| 0009 | [Fastify ako backend framework (nahrádza NestJS)](0009-backend-fastify.md)                                          | ✅ Accepted                                               | máj 2026   |
| 0010 | [Multi-tenant white-label architektúra](0010-multi-tenant-white-label.md)                                           | ✅ Accepted                                               | 2026-05-15 |
| 0011 | [Open-source licensing — EUPL-1.2 + CC-BY-4.0 + REUSE 3.3](0011-licensing-eupl-reuse.md)                            | ✅ Accepted                                               | 2026-05-15 |
| 0012 | [Loans state machine + Slice #5 MVP scope](0012-loans-state-machine.md)                                             | ✅ Accepted                                               | 2026-05-20 |
| 0013 | [Multi-provider auth + self-serve onboarding](0013-multi-provider-auth-self-serve.md)                               | ✅ Accepted                                               | 2026-05-20 |
| 0014 | [Passkeys / WebAuthn — phishing-resistant a passwordless auth](0014-passkeys-webauthn.md)                           | ⚠️ Partially superseded by 0016                           | 2026-05-22 |
| 0015 | [Cross-tenant memberships — User ↔ Organisation many-to-many](0015-cross-tenant-memberships.md)                     | ✅ Accepted                                               | 2026-05-23 |
| 0016 | [Passkeys / WebAuthn — implementačný plán Slice #8 (post-memberships)](0016-passkeys-implementation-plan.md)        | ✅ Accepted (supersedes 0014 v schema/audit/recovery)     | 2026-05-25 |
| 0017 | [MCP server — AI integration cez Model Context Protocol](0017-mcp-server.md)                                        | ✅ Accepted (design); implementácia Q1 2027 ako Slice #10 | 2026-05-25 |
| 0018 | [Custom SelectField komponent namiesto natívneho `<select>`](0018-select-field-component.md)                        | ✅ Accepted                                               | 2026-05-29 |
| 0019 | [Fakturačné údaje tenanta — vnorený `billing` objekt + self-service](0019-tenant-billing-model.md)                  | ✅ Accepted                                               | 2026-05-30 |
| 0020 | [Skladové množstevné položky — `trackingMode` + StockMovement ledger](0020-stock-and-bulk-items.md)                 | ✅ Accepted                                               | 2026-05-31 |
| 0021 | [QR kódy majetku — obsah, generovanie, verejný lost & found lookup](0021-asset-qr-codes.md)                         | ✅ Accepted                                               | 2026-05-31 |
| 0022 | [Preberacie protokoly — model, on-demand PDF a podpisy](0022-loan-protocol-pdf.md)                                  | ✅ Accepted (revíd. 2026-06-01)                           | 2026-05-31 |
| 0023 | [Žiadosť v mene inej osoby + priama výpožička](0023-loan-beneficiary-and-direct-loan.md)                            | ✅ Accepted                                               | 2026-05-31 |
| 0024 | [Odstránenie role TEAM_MANAGER](0024-remove-team-manager-role.md)                                                   | ✅ Accepted                                               | 2026-05-31 |
| 0025 | [Výpožičky bez termínu (open-ended) + dotiahnutie formulára žiadosti](0025-open-ended-loans-and-request-form.md)    | ✅ Accepted                                               | 2026-06-01 |
| 0026 | [Katalógové žiadosti (kategória + množstvo) + oddelené vydávanie](0026-catalog-requests-and-fulfilment.md)          | ✅ Accepted                                               | 2026-06-01 |
| 0027 | [Tlač QR štítkov — Avery PDF hárky + Zebra ZPL](0027-qr-label-printing.md)                                          | ✅ Accepted                                               | 2026-06-01 |
| 0028 | [Per-tenant branding — logo, farby a font (end-to-end)](0028-per-tenant-branding.md)                                | 📝 Proposed                                               | 2026-06-02 |
| 0036 | [Vrátenie majetku od osoby — čiastočné a cross-loan vrátenie](0036-return-from-borrower-cross-loan.md)              | ✅ Accepted                                               | 2026-07-16 |
| 0037 | [Object storage — náhľady v BinData, originály v private Blob storu](0037-object-storage-bindata-plus-tenant-s3.md) | ✅ Accepted                                               | 2026-09-01 |
| 0038 | [Sériová auth reťaz na dashboarde zostáva](0038-dashboard-serial-auth-chain.md)                                     | ✅ Accepted                                               | 2026-09-02 |
| 0039 | [Osirelé objekty v úložisku — denný čistič s 24-hodinovým odkladom](0039-orphaned-storage-objects.md)               | ✅ Accepted                                               | 2026-09-02 |
