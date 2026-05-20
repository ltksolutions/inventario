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

| #    | Názov                                                                                     | Status                | Dátum      |
| ---- | ----------------------------------------------------------------------------------------- | --------------------- | ---------- |
| 0001 | [Monorepo s pnpm + Turborepo](0001-monorepo-pnpm-turbo.md)                                | Accepted              | máj 2026   |
| 0002 | [NestJS ako backend framework](0002-backend-nestjs.md)                                    | 🚫 Superseded by 0009 | máj 2026   |
| 0003 | [MongoDB Atlas ako primárna databáza](0003-mongodb-atlas.md)                              | Accepted              | máj 2026   |
| 0004 | [Microsoft Entra ID ako identity provider](0004-auth-entra-id.md)                         | Accepted              | máj 2026   |
| 0005 | [Natívny MongoDB driver + Repository pattern (bez Mongoose)](0005-mongo-native-driver.md) | Accepted              | máj 2026   |
| 0006 | _(plánované)_ OpenAPI 3.1 ako kontrakt API                                                | Proposed              | –          |
| 0007 | _(plánované)_ MCP server pre AI integrácie                                                | Proposed              | –          |
| 0008 | _(plánované)_ Next.js + shadcn/ui pre frontend                                            | Proposed              | –          |
| 0009 | [Fastify ako backend framework (nahrádza NestJS)](0009-backend-fastify.md)                | ✅ Accepted           | máj 2026   |
| 0010 | [Multi-tenant white-label architektúra](0010-multi-tenant-white-label.md)                 | ✅ Accepted           | 2026-05-15 |
| 0011 | [Open-source licensing — EUPL-1.2 + CC-BY-4.0 + REUSE 3.3](0011-licensing-eupl-reuse.md)  | ✅ Accepted           | 2026-05-15 |
| 0012 | [Loans state machine + Slice #5 MVP scope](0012-loans-state-machine.md)                   | ✅ Accepted           | 2026-05-20 |
