# Architektúra systému

> **Status:** ✅ Production LIVE — Inventario je nasadené, SFZ pilot beží.

Tento dokument popisuje technickú architektúru platformy **Inventario** (multi-tenant
správa a vypožičiavanie majetku).

## Obsah

- [Dátový model](data-model.md) – MongoDB kolekcie, indexy, vzťahy ✅
- [MCP server](mcp-server.md) – špecifikácia MCP integrácie (Slice #10, plánované) ✅
- Bezpečnosť a autorizácia – viď [`compliance/`](../compliance/) (security/privacy whitepaper, information security policy) a referenciu [Role a oprávnenia](../user-guide/reference/role-opravnenia.md)
- Rozhodnutia – jednotlivé [ADR](../decisions/) (auth, multi-tenant, branding, OAuth, …)

## High-level prehľad

```
┌────────────────┐       ┌────────────────┐       ┌─────────────────┐
│  Web (Next.js) │       │ Mobile (Flutter)│       │ AI Asistenti    │
│                │       │   (fáza 3)      │       │ (cez MCP)       │
└────────┬───────┘       └────────┬────────┘       └────────┬────────┘
         │                        │                         │
         │ HTTPS / REST           │ HTTPS / REST            │ MCP (SSE)
         │                        │                         │
         ▼                        ▼                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       API Gateway / Load Balancer                    │
└─────────┬──────────────────────────────────────────┬─────────────────┘
          │                                          │
          ▼                                          ▼
┌─────────────────────┐                  ┌──────────────────────┐
│   API (Fastify)     │                  │   MCP Server         │
│   - REST endpoints  │                  │   (plánované,        │
│   - OpenAPI 3.1     │                  │    Slice #10)        │
│   - RBAC            │                  │                      │
└──────────┬──────────┘                  └──────────┬───────────┘
           │                                        │
           └────────────────┬───────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
       ┌─────────────┐ ┌────────┐ ┌────────────────┐
       │  MongoDB    │ │ Object │ │ Microsoft      │
       │  Atlas      │ │ Storage│ │ Entra ID       │
       │             │ │ (S3)   │ │ + Graph API    │
       └─────────────┘ └────────┘ └────────────────┘
```

## Technologické rozhodnutia (zhrnutie)

Podrobné odôvodnenia jednotlivých rozhodnutí sú v [ADR](../decisions/).

| Vrstva   | Voľba                       | Hlavný dôvod                                                    |
| -------- | --------------------------- | --------------------------------------------------------------- |
| Backend  | Fastify + TypeScript        | Rýchly, schéma-first (Zod + OpenAPI), beží na Vercel serverless |
| Frontend | Next.js 15 App Router       | SSR/RSC, dobré DX, kompatibilita s SportUp ekosystémom          |
| Databáza | MongoDB Atlas               | Flexibilný dátový model pre zmiešaný majetok, managed           |
| Auth     | Microsoft Entra ID          | Existujúca IT infraštruktúra SFZ                                |
| Mobil    | Flutter                     | Jedna codebase pre iOS + Android                                |
| MCP      | `@modelcontextprotocol/sdk` | Štandard pre AI integrácie                                      |
| Monorepo | pnpm + Turborepo            | Rýchlosť, zdieľanie kódu medzi appkami                          |
| CI/CD    | GitHub Actions              | Štandard, dobre integrované                                     |

## Poznámka k aktuálnosti

Backend (Fastify), frontend (Next.js 15), MongoDB Atlas, Microsoft Entra ID + ďalšie
OAuth providery sú **nasadené v produkcii**. MCP server (riadok „plánované" vyššie) je
jediná veľká architektonická časť, ktorá ešte nie je implementovaná — detail v
[ADR-0017](../decisions/0017-mcp-server.md) a [`mcp-server.md`](mcp-server.md).
