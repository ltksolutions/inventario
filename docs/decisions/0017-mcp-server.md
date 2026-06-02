<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0017. MCP server — AI integration cez Model Context Protocol

|                   |                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | ✅ Accepted (design); implementácia naplánovaná na Q1 2027 ako Slice #10                                                                                                                                                                                                                                                                                                                                                                      |
| **Dátum**         | 2026-05-25 (pôvodný design) · 2026-06-02 (rev, tool catalog aktualizovaný na moduly ADR-0020 až 0027)                                                                                                                                                                                                                                                                                                                                         |
| **Autori**        | Ján Letko, Claude Opus 4.7 (pôvodný); Claude Opus 4.8 (rev 2026-06-02) (LTK Solutions)                                                                                                                                                                                                                                                                                                                                                        |
| **Súvisiace ADR** | [0013 Multi-provider auth](0013-multi-provider-auth-self-serve.md), [0015 Cross-tenant memberships](0015-cross-tenant-memberships.md), [0009 Fastify](0009-backend-fastify.md), [0020 Stock + bulk](0020-stock-and-bulk-items.md), [0021 QR kódy](0021-asset-qr-codes.md), [0022 Loan protocol PDF](0022-loan-protocol-pdf.md), [0026 Catalog requests](0026-catalog-requests-and-fulfilment.md), [0027 QR štítky](0027-qr-label-printing.md) |
| **Nahrádza**      | Pôvodný "Proposed" placeholder _ADR-0007 MCP server pre AI integrácie_ v ADR README                                                                                                                                                                                                                                                                                                                                                           |

## Kontext

> **Rev 2026-06-02.** Pôvodný design (2026-05-25) ostáva platný v jadre (hosting, auth, tenant scoping, API gateway pattern, threat model). Táto revízia **aktualizuje tool catalog** o moduly, ktoré pribudli od mája 2026 (ADR-0020 stock/bulk, 0021 QR, 0022 protokoly, 0023 beneficiary/direct loan, 0026 katalógové žiadosti, 0027 štítky), opravuje názvy nástrojov na reálne endpointy (loan fulfilment je katalógový, nie priamy; loan ukončenie je `return`/`lost`, nie `extend`) a zosúlaďuje implementačný plán. Rozhodnutia Q1–Q7 sa nemenia.

Funkčná špecifikácia projektu (§ 1) explicitne spomína MCP server ako súčasť produktu: _"Súčasťou riešenia bude aj MCP server (Model Context Protocol), ktorý umožní napojenie AI asistentov pre prácu s dátami systému."_ Inventario je v produkcii (LIVE na `inventario.estate`, 553/553 testov, Slice #9 cross-tenant memberships dokončený). Najbližšie funkčné kroky podľa `NEXT.md` sú Passkeys (Slice #8) a MCP server (Slice #10). Toto ADR rieši návrh MCP servera.

**Čo je Model Context Protocol.** MCP je otvorený protokol Anthropic-u (vydaný november 2024, v aktívnej štandardizácii 2026) ktorý štandardizuje, ako AI asistenti (Claude.ai, Claude Desktop, ďalší klienti) komunikujú s externými dátovými zdrojmi a nástrojmi. Tri primárne abstrakcie:

- **Tools** — funkcie, ktoré asistent môže zavolať (parametre + návratová hodnota, popísané JSON Schema)
- **Resources** — read-only data sources s URI scheme (napr. `inventario://assets/abc123`)
- **Prompts** — znovupoužiteľné prompt templates s parametrami

Transport vrstva: pre lokálne MCP servery `stdio` (mature), pre remote `HTTP+SSE` (v štandardizácii 2026, plne podporovaný v Claude.ai integrations). Auth pre remote MCP: OAuth 2.1 s PKCE (špecifikácia sa formalizuje cez 2026).

**Prečo pre Inventario.** Tri použiteľské scenáre, kde MCP poskytuje hodnotu mimo dosahu webového UI:

1. **Ad-hoc otázky na inventár.** _"Ktoré notebooky budú voľné na budúci týždeň?"_, _"Aká je celková hodnota majetku v lokalite Bratislava-Pasienky?"_, _"Kto má vypožičanú projektor SMP-2024-00042?"_. V web UI to vyžaduje viacero kliknutí naprieč modulmi; cez Claude jeden conversational dotaz vráti odpoveď.
2. **Automatizácia onboarding-u.** _"Vytvor loan request na laptop pre Mariu Novákovú, doba 3 mesiace, kategória 'Reprezentácia U21'."_ Pre menežérov ktorí preferujú konverzačný interface namiesto formulárov.
3. **Cross-system orchestration (budúcnosť).** Užívateľ má v Claude.ai naraz pripojené Inventario MCP + Google Calendar MCP + Slack MCP. Workflow typu _"naplánuj odovzdanie vybavenia tímu U21 na 5. júna, pošli pozvánky, vytvor loan requesty"_ je realizovateľný cez agent loops.

**Post-Slice #9 architektúra ako východisko.** ADR-0015 zaviedol globálnu identitu (User) + per-tenant kontext (Membership). Aktívny tenant je daný JWT `org`/`mid` claimami. Tento model je **kompatibilný s MCP konceptom "tenant-scoped connection"** — užívateľ generuje MCP token pre konkrétnu kombináciu (userId, membershipId), čo presne zodpovedá jednej Membership.

### Obmedzenia

- **EUPL-1.2 + open-source** — žiadne SaaS auth proxies, žiadny vendor lock-in. Anthropic MCP SDK je MIT, OK.
- **Vercel serverless** — žiadne long-lived processes. SSE connection musí fungovať v rámci limitov Vercel Functions (5 min request timeout pre Pro plan).
- **Multi-tenant security boundary** — MCP token nesmie umožniť cross-tenant data leak. Tenant scope binding na token level je kritický.
- **MCP protokol je v evolúcii** — niektoré aspekty (auth, registration discovery) sa formalizujú cez 2026. Náš design musí byť flexible voči spec updates.
- **Žiadny existujúci `apps/mcp-server`** — green field, ale musíme reusenúť `packages/shared-types`, OpenAPI spec, a auth model z hlavného API.
- **Pilot dependency.** SFZ pilot funguje bez MCP. Slice #10 je hodnotová iterácia, nie blocker pre launch. Timeline Q1 2027 zostáva orientačný.

### Existujúci stav

> Aktualizované 2026-06-02.

| Komponent                              | Stav                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inventario API (`apps/api`)            | LIVE na `app.inventario.estate`, 825 testov                                                                                                                                    |
| Doménové moduly                        | assets, asset-types, asset-conditions, categories, locations, loan-requests, loans, protocols, labels, stock, invitations, memberships, organisations, users, audit, retention |
| OpenAPI 3.1 spec                       | Generovaný cez `pnpm openapi:export:offline`, žije v `apps/api/openapi.json`                                                                                                   |
| Shared types (`packages/shared-types`) | Zod schémy + JSON Schema export, používaný web aplikáciou aj (budúce) MCP serverom                                                                                             |
| Auth model                             | Inventario JWT (RS256), httpOnly cookies pre web, Bearer tokens pre non-browser clients                                                                                        |
| Refresh tokens collection              | Existujúci pattern pre revokovateľné dlhodobé tokeny — vzor pre `mcp_access_tokens`                                                                                            |
| Audit log                              | Per-tenant, štrukturalizované eventy s `legalBasis` + `dataCategories`                                                                                                         |
| Loan model (ADR-0023, 0025, 0026)      | Katalógové žiadosti (kategória+množstvo) → fulfilment → N Loanov; beneficiary; loans bez termínu                                                                               |
| Stock model (ADR-0020)                 | BULK položky s StockMovement ledgerom; SERIALIZED (default) jednotlivé kusy                                                                                                    |
| QR + štítky (ADR-0021, 0027)           | `publicToken` per asset, on-demand QR render, verejný scan (opt-in), Avery PDF + Zebra ZPL štítky                                                                              |
| Protokoly (ADR-0022)                   | On-demand PDF preberací/vratný protokol, click-to-sign, deterministický render                                                                                                 |

## Možnosti — kľúčové rozhodnutia

### Q1: Hosting model

#### Možnosť A: Lokálny stdio MCP server

User si nainštaluje `npx @inventario/mcp-server`, nakonfiguruje cestu v Claude Desktop `mcpServers` JSON.

- **Plus:** Žiadna hostovacia infraštruktúra. Práca offline (až po API call k Inventario). Zhodný s patterns Anthropic-ovho `filesystem`, `git`, `slack` MCP servera.
- **Mínus:** Friction — user musí mať Node.js, vie skopírovať config JSON, riešiť token rotation manuálne. Funguje len v Claude Desktop, nie v Claude.ai web. Aktualizácie musíme distribuovať cez `npm` (verziovanie).

#### Možnosť B: Remote HTTP/SSE MCP server (selected)

Hostovaný na `mcp.inventario.estate` ako separátna Vercel app. Claude.ai sa pripojí cez "Integrations" UI s connection URL + token.

- **Plus:** Zero-install UX. Aktualizácie sú server-side (žiadny client update). Funguje vo všetkých MCP clients podporujúcich HTTP transport (Claude.ai web, Claude Desktop, budúce ChatGPT MCP support, atď.). Aligned s tým, kde sa ekosystém pohybuje 2026-2027.
- **Mínus:** Vyžaduje hostovaciu infraštruktúru a auth flow. Vercel function timeout 5 min môže komplikovať veľmi dlhé operácie (žiadne reálne v Inventario use case).

#### Možnosť C: Oboje (deferred)

Lokálny aj remote variant. Najmaximálna kompatibilita, ale 2× implementácia, 2× test surface.

**Rozhodnutie: Možnosť B — remote HTTP/SSE.** Lokálny variant doplníme len ak vznikne reálny dopyt (napríklad enterprise tenant ktorý nedovolí web-based integrations zo security dôvodov).

### Q2: Auth flow

#### Možnosť A: Manual token paste (selected pre v0.7 MVP)

User v Inventario `/settings/integrations` vyrobí MCP token, vyberie tenant (membership), token sa skopíruje a paste-uje do Claude.ai "Add MCP Server" formy.

- **Plus:** Žiadny OAuth 2.1 implementačný overhead. Plne kontrolovaný flow — user vie, čo robí. Token visibility v `/settings/integrations` (revoke, lastUsedAt).
- **Mínus:** Friction — copy/paste step. Nie je "one-click connect".

#### Možnosť B: OAuth 2.1 + PKCE flow (deferred to v0.8)

Claude.ai pýta "Connect to Inventario", browser otvorí `app.inventario.estate/oauth/authorize?...`, user sa prihlási, vyberie tenant, povolí scope, redirect späť do Claude.ai s tokenom.

- **Plus:** Štandard MCP pre remote servery 2026+. UX excellent — jeden klik. Spec-aligned.
- **Mínus:** Implementačný overhead — OAuth 2.1 authorization server endpoints, PKCE validation, refresh token handling. Špecifikácia MCP-OAuth sa stabilizuje cez 2026; implementovať skôr ako sa stabilizuje znamená riziko prepisu.

**Rozhodnutie: dvojfázovo. v0.7 MVP = Možnosť A (manual). v0.8 (post-MVP) = Možnosť B (OAuth 2.1) keď MCP-OAuth spec dosiahne v1.0.** ADR-0013 už zaviedol RS256-podpísané Inventario JWT-y; rozšírenie o `mcp_access` audience claim je minimal-effort upgrade keď príde čas.

### Q3: Tenant scope per token

#### Možnosť A: Single-tenant token (selected)

Token je viazaný na (userId, organisationId, membershipId). User s tromi tenant memberships má tri separátne MCP tokens (alebo si nainštaluje jednu konektivitu pre primary tenant a ďalšie ad-hoc keď treba).

- **Plus:** Permission model je jasný — token = jedna identita v jednom tenant-e. Audit log per-tenant je clean. Žiadny "select tenant" UI step v MCP tool calls.
- **Mínus:** Power user s 3 tenants má 3 connections v Claude.ai sidebar — viac visual clutter.

#### Možnosť B: Multi-tenant token + tenant selector tool

Token nesie identitu, každý MCP call obsahuje implicitný tenant context (default), tool `switch_tenant({ organisationId })` mení context pre subsequent calls v rámci session.

- **Plus:** Jedna connection v Claude.ai, multi-tenant flexibility v rámci konverzácie.
- **Mínus:** Stateful session na MCP server side (čo je odhliadnuté od Vercel serverless reality). Audit log query "kto čo robil v tenant X" musí filterovať per-call, nie per-token. RBAC checks musia pre každý tool resolvenúť aktuálny tenant context — race conditions.

**Rozhodnutie: Možnosť A — single-tenant token.** Multi-tenant power users sú edge case; jednoduchosť modelu prevažuje.

### Q4: Tool granularity

#### Možnosť A: 1:1 mapping z OpenAPI

Auto-generated tools — `list_assets`, `get_asset`, `create_asset`, `patch_asset`, `delete_asset`, `list_loans`, `get_loan`, `create_loan_request`, ..., ~50+ tools.

- **Plus:** Žiadne hand-coding. Pri zmenách v OpenAPI sa MCP tools regenerujú. Úplné API parity.
- **Mínus:** LLM has worse decision quality s 50 verbose-named tools. Tool names ako `patch_asset_by_id` sú technické. LLM mätie keď je 5 tools, ktoré "vyzerajú" podobne (list/find/search).

#### Možnosť B: Curated task-oriented tools (selected)

~15-20 ručne navrhnutých tools s task-oriented names a rich descriptions. Príklad: `find_available_assets_for_loan({ from, to, category? })` namiesto `list_assets({ status: 'AVAILABLE', filter: ... })`.

- **Plus:** LLM tool selection accuracy je dramaticky lepšia. Tool descriptions môžeme tunenuť na konkrétne use cases. Cleaner UX v Claude.ai sidebar ("Inventario · 18 tools" vs "Inventario · 52 tools").
- **Mínus:** Hand-coded — pri API changes treba manuálne pridať/upraviť. Nie všetky API endpoint-y sú exposované (by design).

#### Možnosť C: Hybrid (low-level + high-level)

Curated high-level tools (Možnosť B) + opt-in low-level CRUD tools (Možnosť A) za feature flag.

- **Plus:** Best of both — large surface available na vyžiadanie, default je curated.
- **Mínus:** Komplexnejšia config. Yet-another-flag. Nepotrebné pre MVP.

**Rozhodnutie: Možnosť B — curated 15-20 tools.** Hybrid ostáva ako možnosť pre v0.8+ ak vznikne reálny use case.

### Q5: Write surface — safety vs power

Write operácie cez LLM majú dva problémy: (a) LLM môže byť wrong (halucinácia parametrov), (b) destruktívne operácie nedajú undo. MCP špecifikácia má tool annotations pre signalizáciu rizika (`readOnlyHint`, `destructiveHint`, `idempotentHint`).

#### Možnosť A: Read-only MVP

Žiadne write tools v Slice #10. Read-only inventár, dashboards, otázky.

- **Plus:** Nulové riziko data corruption cez LLM error.
- **Mínus:** Polovica use case-u stratená. Loan request creation, asset patch je presne to, kde MCP ušetrí čas.

#### Možnosť B: Read + non-destructive writes (selected)

Permitted: create*\*, update*\*, approve, reject, mark_returned. Excluded: delete operations, admin operations (users, memberships, organisation settings, invitations), security operations (MFA, passkeys, password change).

- **Plus:** Cover real use case. Žiadne irreversible destructive ops cez LLM.
- **Mínus:** Curating excluded list je práca — musíme byť explicit, nie predpokladať default.

#### Možnosť C: Full surface s confirmation hints

Cez MCP `destructiveHint: true` annotácia, Claude.ai pýta confirmation pred call-om. Užívateľ explicitne potvrdí každú destruktívnu operáciu.

- **Plus:** Maximum flexibility.
- **Mínus:** Confirmation prompts pre každý delete sú UX trenice — užívatelia ich začnú klikať bez čítania. Implicit trust vs explicit barrier failure mode.

**Rozhodnutie: Možnosť B — read + non-destructive writes.** Konzervatívny default. Destruktívne operácie zostávajú v web UI kde má user plný kontext (audit trail visible, undo via soft-delete recovery). Možnosť C zvážime v v0.8 ak vznikne dopyt od power users.

### Q6: Backend architektúra — direct DB vs API gateway

#### Možnosť A: MCP server číta priamo z MongoDB

Vlastný Mongo connection pool, vlastné repository implementácie (re-use packages/shared-types pre schémy).

- **Plus:** Nižšia latencia (žiadny extra HTTP hop). Plný control nad query optimization.
- **Mínus:** **Duplikácia business logic.** RBAC checky, audit logging, FK protection (cats/locs delete prevention), last-admin guard, MFA gate — všetko by sa muselo replikovať alebo vyextrahovať do shared service layer. Atlas connection sprawl (každý function-cold-start = new connection). Test surface zdvojený.

#### Možnosť B: MCP server volá Inventario API (selected)

MCP server je **gateway layer** — translation z MCP protocol na HTTP REST. Calls `https://asset-management-api.vercel.app/v1/...` s Bearer tokenom.

- **Plus:** Single source of truth pre business logic (Fastify API). MCP server je tenký translation layer (~1500 LoC odhadom). Žiadny direct DB access. RBAC, audit, validation — všetko sa deje v API. Pri API changes MCP "len" upraví client calls.
- **Mínus:** Extra HTTP hop ~50-100ms latency per call. Tighter coupling na API surface (ale to je by design — API je kontrakt). Function-to-function call v rámci Vercel infraštruktúry — žiadny síťový egress, ale účtovaný compute.

**Rozhodnutie: Možnosť B — API gateway pattern.** Latency je acceptable pre conversational AI use case (LLM round-trip je ~2-10s anyway). Business logic centralizácia je kľúčová pre dlhodobú údržbu.

### Q7: Resources a Prompts (MCP koncepty)

#### Resources

Read-only data sources s URI scheme. Príklad: `inventario://assets/abc123` exposuje asset detail JSON; klient ich môže subscribeovať a dostávať update notifikácie.

**Rozhodnutie: skip pre MVP.** Reasons:

- Tools (`get_asset({ id })`) covers the use case rovnocenne.
- Subscription pattern (server-push pri zmene) je netriviálny v serverless (žiadne long-lived connections).
- Pridáme keď bude reálny use case (napr. dashboard widget v Claude.ai ktorý live updatuje).

#### Prompts

Reusable templates s parametrami. Príklad: `prompt: "weekly_loan_report"` s parametrom `tenantId`.

**Rozhodnutie: skip pre MVP.** Užívatelia môžu pýtať čokoľvek v natural language; preskribované prompts nie sú esenciálne. Reconsider keď budú user-feedback patterns naznačovať časté prompts hodné templatovania.

## Rozhodnutie

Zvolili sme:

| #   | Rozhodnutie                                                                                  |
| --- | -------------------------------------------------------------------------------------------- |
| 1   | **Remote HTTP/SSE MCP server** na `mcp.inventario.estate` ako samostatná Vercel app          |
| 2   | **Manual token paste auth** v0.7 MVP, OAuth 2.1 + PKCE v v0.8 keď MCP-OAuth spec stabilizuje |
| 3   | **Single-tenant tokens** — token bound na (userId, membershipId, organisationId)             |
| 4   | **Curated ~15-20 task-oriented tools**, žiadny 1:1 OpenAPI mapping                           |
| 5   | **Read + non-destructive writes**, žiadne delete/admin/security ops                          |
| 6   | **API gateway pattern** — MCP server volá Inventario API cez HTTP, žiadny direct DB          |
| 7   | **Tools only** — žiadne Resources, žiadne Prompts pre MVP                                    |

## Detailný design

### Architektúra

```
┌─ Claude.ai / Claude Desktop / iný MCP client ─────────────────────┐
│                                                                     │
│  User: "ktoré laptopy budú voľné na budúci týždeň?"                 │
│         │                                                            │
│         ▼                                                            │
│  Claude resolves: needs find_available_assets_for_loan tool         │
│  POST https://mcp.inventario.estate/mcp                              │
│    Authorization: Bearer <inv_mcp_token>                             │
│    body: { method: "tools/call",                                     │
│            params: { name: "find_available_assets_for_loan",         │
│                      arguments: { from, to, category } } }           │
└──────────────────────────────────────┬─────────────────────────────┘
                                       │
                                       ▼
┌─ mcp.inventario.estate (Vercel app: apps/mcp-server) ──────────────┐
│                                                                     │
│  1. Validate Bearer token → resolve (userId, membershipId, orgId)   │
│  2. Map MCP tool call → REST API call                               │
│  3. Authenticate to Inventario API (via short-lived JWT)            │
│  4. Forward request                                                  │
│     GET https://asset-management-api.vercel.app/v1/assets?           │
│         status=AVAILABLE&availableFrom=...&category=...              │
│         Authorization: Bearer <short-lived JWT>                      │
│  5. Receive REST response                                            │
│  6. Transform → MCP tool result schema                               │
│  7. Return JSON-RPC response to client                               │
└──────────────────────────────────────┬─────────────────────────────┘
                                       │
                                       ▼
┌─ asset-management-api.vercel.app (existing apps/api) ──────────────┐
│  Auth middleware → loadCurrentUser → loadMembership → RBAC check    │
│  Existing route handler runs, returns response, audit logged        │
└─────────────────────────────────────────────────────────────────────┘
```

**Kľúčový insight:** MCP server nikdy priamo neoperuje s MongoDB ani neimplementuje business logic. Je to **MCP↔REST translation layer** s auth resolution navrch.

### Tool catalog (Slice #10 MVP)

Tools sú definované v `apps/mcp-server/src/tools/` ako samostatné moduly. Každý exportuje:

```typescript
interface ToolDefinition {
  name: string;
  description: string; // dlhý, AI-friendly text — kľúčové pre LLM tool selection
  inputSchema: z.ZodSchema; // strict input validation
  outputSchema: z.ZodSchema; // for client-side type inference
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: false; // always false — we don't reach external systems
  };
  handler: (args, ctx) => Promise<unknown>;
}
```

#### Read tools (RBAC: EMPLOYEE+)

> Aktualizované 2026-06-02 — zarátané moduly stock, protokoly, štítky, číselníky, members.

| Tool name                        | Popis                                                                    | Maps to API                                           |
| -------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| `list_assets`                    | List assets s pagination + filters (status, category, location, search)  | `GET /v1/assets`                                      |
| `get_asset`                      | Detail jedného aktíva podľa \_id alebo inventoryNumber                   | `GET /v1/assets/:id`                                  |
| `find_available_assets_for_loan` | Aktíva voľné pre loan v zadanom časovom okne, optionally filter category | `GET /v1/assets?status=AVAILABLE&...`                 |
| `list_loan_requests`             | List žiadostí o výpožičku s filters (status, requester)                  | `GET /v1/loan-requests`                               |
| `list_loans`                     | List loans s filters (status, borrower, asset, dateRange)                | `GET /v1/loans`                                       |
| `get_loan`                       | Detail jednej loan / loan request                                        | `GET /v1/loans/:id` alebo `GET /v1/loan-requests/:id` |
| `get_my_loans`                   | Loans aktuálneho usera (ja som borrower)                                 | `GET /v1/loans/my`                                    |
| `get_overdue_loans`              | Aktívne loans po deadline (ASSET_MANAGER+ pre cross-user view)           | `GET /v1/loans?status=ACTIVE` + lazy OVERDUE filter   |
| `list_categories`                | Kategórie tenantu                                                        | `GET /v1/categories`                                  |
| `list_locations`                 | Lokality tenantu                                                         | `GET /v1/locations`                                   |
| `list_asset_types`               | Číselník typov majetku tenantu (ADR-0020)                                | `GET /v1/asset-types`                                 |
| `list_asset_conditions`          | Číselník kondícií majetku tenantu (ADR-0020)                             | `GET /v1/asset-conditions`                            |
| `get_stock_overview`             | Prehľad skladu — BULK položky + zostatky (ASSET_MANAGER+, ADR-0020)      | `GET /v1/stock`                                       |
| `get_stock_movements`            | História skladových pohybov pre BULK položku (ADR-0020)                  | `GET /v1/stock/:itemId/movements`                     |
| `list_loan_protocols`            | Zoznam preberacích/vratných protokolov k loanu (ADR-0022)                | `GET /v1/loans/:id/protocols`                         |
| `get_loan_protocol`              | Metadata jedného protokolu (ýčastník alebo ASSET_MANAGER+, ADR-0022)     | `GET /v1/protocols/:id`                               |
| `list_members`                   | Picker-safe zoznam členov tenantu (pre beneficiary/borrower výber)       | `GET /v1/members`                                     |
| `search_users`                   | Vyhľadanie users v tenantu podľa display name / email (ASSET_MANAGER+)   | `GET /v1/users?q=...`                                 |

> **Poznámka k QR/scan:** verejný scan (`GET /v1/public/scan/:token`, ADR-0021) je zámerne **mimo MCP surface** — je to neautentifikovaný verejný lost-and-found endpoint, MCP token je naopak autentifikovaný tenant-scoped. QR obrázok (`GET /v1/assets/:id/qr`) a štítky (`/v1/labels/*`) sú binárne/PDF výstupy — LLM ich nepotrebuje ako tool (download patrí do web UI); prečo nie sú v catalogu viď excluded nižšie.

#### Write tools (RBAC varies, destructiveHint: false on all)

> Aktualizované 2026-06-02 — zosúladené s katalógovým loan modelom (ADR-0026), direct loan (ADR-0023) a stock (ADR-0020).

| Tool name              | RBAC           | Popis                                                                                             | Maps to API                          |
| ---------------------- | -------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `create_loan_request`  | EMPLOYEE+      | Vytvor žiadosť o výpožičku — kategória+množstvo, dôvod, obdobie, voliteľný beneficiary (ADR-0026) | `POST /v1/loan-requests`             |
| `approve_loan_request` | ASSET_MANAGER+ | Schváliť pending žiadosť (len zmena stavu, nevytvára Loan; ADR-0026)                              | `POST /v1/loan-requests/:id/approve` |
| `reject_loan_request`  | ASSET_MANAGER+ | Odmietnuť pending žiadosť s reason                                                                | `POST /v1/loan-requests/:id/reject`  |
| `fulfil_loan_request`  | ASSET_MANAGER+ | Vydať zo žiadosti — mapovanie kategórií na konkrétne assety/BULK, vznik Loanu (ADR-0026)          | `POST /v1/loan-requests/:id/fulfil`  |
| `create_direct_loan`   | ASSET_MANAGER+ | Priama výpožička bez žiadosti — manager rovno vydá asset (ADR-0023)                               | `POST /v1/loans`                     |
| `mark_loan_returned`   | ASSET_MANAGER+ | Označ loan ako vrátený + optional condition note                                                  | `POST /v1/loans/:id/return`          |
| `mark_loan_lost`       | ASSET_MANAGER+ | Označ loan / jeho položku ako stratenú                                                            | `POST /v1/loans/:id/lost`            |
| `create_asset`         | ASSET_MANAGER+ | Vytvor nový asset (inventoryNumber server-generated)                                              | `POST /v1/assets`                    |
| `update_asset`         | ASSET_MANAGER+ | PATCH editable fields (name, description, location, value, metadata)                              | `PATCH /v1/assets/:id`               |
| `receive_stock`        | ASSET_MANAGER+ | Príjem BULK položky na sklad (RECEIPT pohyb, ADR-0020)                                            | `POST /v1/stock/:itemId/receive`     |
| `adjust_stock`         | ASSET_MANAGER+ | Ručná korekcia skladu s povinným dôvodom (ADJUSTMENT, ADR-0020)                                   | `POST /v1/stock/:itemId/adjust`      |

> **Poznámka k podpisu protokolov.** `POST /v1/protocols/:id/sign` (ADR-0022) je **mimo MCP write surface** — podpis má právnu váhu a vyžaduje explicitný ľudský úkon konkrétnej strany; LLM ho nesmie vyvolať v mene používateľa. Patrí do web UI (a budúce mobile). `reconcile_stock` (ADMIN diagnostika) tiež ostáva mimo — je to expertný opravný nástroj, nie bežná operácia.

#### Explicitne EXCLUDED zo Slice #10 MVP

| Funkcionalita                                                           | Dôvod exclusion                                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `delete_asset`, `delete_category`, `delete_location`                    | Destruktívne, audit-sensitive — web UI only                                   |
| User/membership management (create user, update roles, remove member)   | Admin operations s LAST_ADMIN protection — web UI only                        |
| Invitation management (create/revoke invite)                            | Bezpečnostne citlivé identity operations — web UI only                        |
| MFA, passkey, password management                                       | Security operations vyžadujúce user-presence prompts — web UI only            |
| Organisation settings (allowedDomains, MFA policy, brand kit)           | Tenant-wide configuration — web UI only                                       |
| Audit log read                                                          | PII exposure risk via LLM context bleed — web UI only                         |
| GDPR DSAR (data export, account deletion)                               | Compliance operations vyžadujúce explicit verified user intent — web UI only  |
| Podpis protokolu (`POST /v1/protocols/:id/sign`, ADR-0022)              | Právny úkon s váhou — nesmie ho urobiť LLM v mene strany; web UI only         |
| QR/štítky download (`/v1/assets/:id/qr`, `/v1/labels/*`, ADR-0021/0027) | Binárne/PDF výstupy na tlač — patria do web UI, LLM ich ako tool nepotrebuje  |
| Verejný scan (`GET /v1/public/scan/:token`, ADR-0021)                   | Neautentifikovaný verejný lost-and-found — mimo autentifikovaného MCP surface |
| Stock reconcile (`POST /v1/stock/:itemId/reconcile`, ADR-0020)          | ADMIN diagnostický opravný nástroj — nie bežná operácia, web UI only          |

**Pravidlo pre budúce additions:** keď zvažujeme pridať tool, otázka je _"ak LLM toto zavolá nedopatrením s vymyslenými parametrami, môže to spôsobiť irreversible damage alebo data leak?"_ Ak áno → web UI only.

### Auth flow (v0.7 manual token MVP)

#### Token generation (v Inventario web UI)

```
1. User navigates to /settings/integrations
2. Clicks "Pridať MCP pripojenie"
3. Form: { connectionName: "Claude Desktop laptop", tenant: <select if multiple memberships> }
4. POST /v1/auth/mcp-tokens { connectionName, organisationId }
   Server validates user has active membership in target org
   Server generates 32-byte random raw token, stores SHA-256 hash in DB
   Server returns raw token ONCE (never shown again) + connection metadata
5. User copies token, paste-uje do Claude.ai "Add MCP Server":
     URL: https://mcp.inventario.estate/mcp
     Auth header: Bearer <raw token>
```

#### MCP request authentication

```
Incoming HTTP request to mcp.inventario.estate:
  Authorization: Bearer <raw token>
                 ↓
  MCP server computes SHA-256(raw token), queries mcp_access_tokens collection
                 ↓
  Token row found?
    No → 401 INVALID_TOKEN
    Yes → check expiresAt, revokedAt
      Expired/revoked → 401 TOKEN_EXPIRED / TOKEN_REVOKED
      Valid → proceed
                 ↓
  Update token.lastUsedAt = now (fire-and-forget)
                 ↓
  Resolve user + membership + organisation from token claims (userId, membershipId, organisationId)
                 ↓
  Issue short-lived Inventario JWT (5 min TTL, audience=inventario-api)
    with sub=userId, org=organisationId, mid=membershipId, roles=membership.roles
                 ↓
  Cache JWT in-memory for this MCP server function invocation
                 ↓
  Subsequent API calls use this JWT in Bearer header
```

**Bezpečnostné poznámky:**

- Raw token sa **nikdy neuloží** v DB — len SHA-256 hash (rovnaký pattern ako `refresh_tokens.ts`).
- Token sa zobrazí v Inventario UI **iba raz** pri vytvorení (s warning).
- Short-lived Inventario JWT-y vydávané MCP serverom nemajú refresh token — sú v-memory only počas request handling.
- Audit log MCP token vytvorenia a revoke akcií ide do `audit_logs` ako `MCP_TOKEN_CREATED` / `MCP_TOKEN_REVOKED`.

### Tenant scoping

Token nesie **bound triplet**: `userId`, `organisationId`, `membershipId`. Toto rozhodnutie:

- **Bezpečné voči membership revoke** — ak admin odoberie usera z tenantu (`DELETE /v1/memberships/:id`), token zostáva platný v DB ale `loadMembership` v API auth middleware vráti 401/403, takže každý subsequent MCP call zlyhá. User v Inventario UI vidí stale connection a môže ju revoke-ovať.
- **Bezpečné voči role demotion** — JWT vydávaný MCP serverom má `roles` z aktuálnej DB membership (nie cached snapshot). Demote z ADMIN na EMPLOYEE = okamžitý effect.
- **Bezpečné voči tenant disable** — ak `organisation.status === 'SUSPENDED'` alebo `deletedAt !== null`, API auth vráti chybu.

### Rate limiting

| Scope                      | Limit   | Window | Implementácia                                    |
| -------------------------- | ------- | ------ | ------------------------------------------------ |
| Per-token (all tools)      | 300 req | 1 min  | Vercel KV (Redis) counter; mcp server middleware |
| Per-token per-tool (read)  | 60 req  | 1 min  | KV counter                                       |
| Per-token per-tool (write) | 20 req  | 1 min  | KV counter                                       |
| Per-IP (anti-DoS)          | 600 req | 1 min  | Vercel Edge Network DDoS protection (built-in)   |

MCP server respektuje rate limiting na Inventario API úrovni (nasledujúce calls dostávajú 429 ak prevýšia limit) a vracia MCP-friendly error pre LLM: _"Rate limit reached. Try again in N seconds."_

### OpenAPI integration (build pipeline)

```
apps/api → openapi:export:offline → openapi.json (live spec)
                                          │
                                          ▼
apps/mcp-server build step → fetch openapi.json → openapi-typescript →
                                                  → src/types/api.d.ts
                                                  │
                                                  ▼
                                            Tool handlers import these types
                                            for type-safe API client
```

Tool handlers nepoužívajú raw `fetch` calls. Použijeme `openapi-fetch` (MIT) — tenký typesafe HTTP client wrapper okolo fetch, ktorý pri každom volaní validuje proti generated TypeScript types z OpenAPI.

```typescript
// apps/mcp-server/src/clients/inventario-api.ts
import createClient from 'openapi-fetch';
import type { paths } from '../types/api.d.ts'; // generated from openapi.json

export function createInventarioClient(jwt: string) {
  return createClient<paths>({
    baseUrl: process.env.INVENTARIO_API_URL,
    headers: { Authorization: `Bearer ${jwt}` },
  });
}
```

### Schémy

#### Nová collection: `mcp_access_tokens` (žije v hlavnej Inventario DB)

```typescript
// packages/shared-types/src/schemas/mcp-access-token.ts (new file)

export const McpAccessTokenSchema = BaseDocumentSchema.merge(
  SoftDeleteSchema,
).extend({
  /** Owner. */
  userId: ObjectIdSchema,

  /** Bound tenant. Token is single-tenant. */
  organisationId: ObjectIdSchema,

  /** Bound membership (must remain ACTIVE for token to be usable). */
  membershipId: ObjectIdSchema,

  /** SHA-256 hash of raw token. Raw token NEVER stored. */
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),

  /** User-given name for the connection. */
  connectionName: z.string().min(1).max(100),

  /** Optional client identifier from MCP handshake (e.g. "Claude Desktop 1.5.2"). */
  clientUserAgent: z.string().max(500).nullable().default(null),

  /** Token expiry. Default 1 year from creation. */
  expiresAt: TimestampSchema,

  /** Last successful use (for "stale token" UI flag). */
  lastUsedAt: TimestampSchema.nullable().default(null),

  /** IP address of last successful use (for security review). */
  lastUsedIp: z.string().max(45).nullable().default(null),

  /** Cumulative call count (for usage stats). */
  callCount: z.number().int().nonnegative().default(0),

  /** Set when user explicitly revokes; soft-delete via deletedAt for cleanup. */
  revokedAt: TimestampSchema.nullable().default(null),
});

export type McpAccessToken = z.infer<typeof McpAccessTokenSchema>;
```

**Indexes:**

- `{ tokenHash: 1 }` unique
- `{ userId: 1, deletedAt: 1 }` (list user's MCP connections)
- `{ expiresAt: 1 }` (cleanup job for expired tokens)

#### User schema additions

Žiadne. Token vzťah je 1:N cez `userId` foreign key, nie embedded.

#### Audit log action enum additions

```typescript
// Pridáme do packages/shared-types/src/schemas/audit-log.ts
'MCP_TOKEN_CREATED',
'MCP_TOKEN_REVOKED',
'MCP_TOOL_INVOKED',          // pre write tools (audit trail)
```

`MCP_TOOL_INVOKED` audit log:

- Severity: `INFO` pre úspešné, `WARNING` pre RBAC denied, `ERROR` pre execution failure
- Metadata: `{ tool, args (redacted PII), mcpClientUserAgent, durationMs }`
- Emitted len pre write tools — read tools by audit log zaspamovali bez business value

#### entityType additions

```typescript
'McpAccessToken',
```

### Frontend — `/settings/integrations`

Nová stránka (zatiaľ neexistuje):

```
┌────────────────────────────────────────────────────────────┐
│  Integrácie                                                  │
│  Pripojenia s externými AI asistentmi a nástrojmi cez MCP.   │
│                                                              │
│  [ + Pridať MCP pripojenie ]                                 │
│                                                              │
│  Aktívne pripojenia:                                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 🤖 Claude Desktop — Macbook Air                       │   │
│  │    Tenant: SFZ                                        │   │
│  │    Aktívne od: 2026-05-25                             │   │
│  │    Posledné použitie: pred 2 minútami                 │   │
│  │    Volania: 142                                       │   │
│  │    [ Premenovať ]  [ Revokovať ]                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Dialóg pri vytvorení (zobrazí sa raz):                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ⚠️ Pripojovací token                                  │   │
│  │                                                       │   │
│  │ Toto je váš MCP token — zobrazí sa iba raz.           │   │
│  │                                                       │   │
│  │   inv_mcp_a4f8...3e91                                 │   │
│  │   [📋 Kopírovať]                                       │   │
│  │                                                       │   │
│  │ Konfigurácia pre Claude:                              │   │
│  │   URL: https://mcp.inventario.estate/mcp              │   │
│  │   Auth: Bearer (vyššie uvedený token)                 │   │
│  │                                                       │   │
│  │ Po zatvorení tohto dialógu token už nezískate späť.   │   │
│  │ Ak ho stratíte, musíte vytvoriť nové pripojenie.      │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

### Endpointy

#### Inventario API (existing app, nové endpointy)

| Method   | Path                      | RBAC                                       | Popis                                                |
| -------- | ------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| `POST`   | `/v1/auth/mcp-tokens`     | any role + active membership in target org | Vytvor nový MCP token, vráti raw token ONCE          |
| `GET`    | `/v1/auth/mcp-tokens`     | any role                                   | List own active MCP tokens (bez raw token, bez hash) |
| `PATCH`  | `/v1/auth/mcp-tokens/:id` | self only                                  | Rename connection (deni body: `{ connectionName }`)  |
| `DELETE` | `/v1/auth/mcp-tokens/:id` | self only                                  | Revoke (sets revokedAt + soft-delete)                |

Žiadny `GET /v1/auth/mcp-tokens/:id` endpoint na detail — pole detail je v list endpoint-e.

#### MCP server (`apps/mcp-server`, new app)

| Method | Path      | Popis                                                                |
| ------ | --------- | -------------------------------------------------------------------- |
| `GET`  | `/`       | Public — server info JSON (name, version, supportedProtocolVersion)  |
| `POST` | `/mcp`    | Authenticated — MCP JSON-RPC endpoint (init, tools/list, tools/call) |
| `GET`  | `/health` | Public — health check pre Vercel deployment monitoring               |

### Repository

```
apps/mcp-server/
├── package.json              # @inventario/mcp-server
├── tsconfig.json
├── vercel.json               # Vercel function config
├── src/
│   ├── index.ts              # Vercel handler entry point
│   ├── server.ts             # MCP SDK server setup
│   ├── auth/
│   │   ├── token-resolver.ts # Bearer → (userId, membership, JWT)
│   │   └── jwt-issuer.ts     # Short-lived Inventario JWT
│   ├── clients/
│   │   └── inventario-api.ts # openapi-fetch client factory
│   ├── tools/
│   │   ├── index.ts          # Tool registry
│   │   ├── assets/
│   │   │   ├── list-assets.ts
│   │   │   ├── get-asset.ts
│   │   │   ├── find-available.ts
│   │   │   ├── create-asset.ts
│   │   │   └── update-asset.ts
│   │   ├── loans/
│   │   │   ├── list-loans.ts
│   │   │   ├── ...
│   │   ├── categories.ts
│   │   ├── locations.ts
│   │   └── users.ts
│   ├── lib/
│   │   ├── errors.ts         # MCP error mappers
│   │   ├── rate-limit.ts     # Vercel KV-backed limiter
│   │   └── logging.ts        # Pino setup
│   └── types/
│       └── api.d.ts          # Generated from openapi.json
└── tests/
    ├── integration/
    │   └── tool-call.test.ts
    └── unit/
        └── token-resolver.test.ts
```

## State machines

### Token lifecycle

```
[no_token]
  POST /v1/auth/mcp-tokens
  → server: validate membership, generate 32-byte random, store SHA-256 hash
  → response 201 { rawToken (shown once), id, connectionName, expiresAt }
[active]
  Each MCP request:
    server: SHA-256(bearer) → match → check expiresAt/revokedAt
    if revoked → state [revoked]
    if expired → state [expired]
    else → update lastUsedAt, lastUsedIp, callCount; proceed
  ↓ on user action
  DELETE /v1/auth/mcp-tokens/:id
  → state [revoked]
[expired]
  Subsequent MCP requests: 401 TOKEN_EXPIRED
  Cleanup job (daily): soft-delete tokens with expiresAt > 30 days ago
[revoked]
  Subsequent MCP requests: 401 TOKEN_REVOKED
  User must create new token via UI
```

### MCP tool call flow

```
[mcp_request_received]
  Validate JSON-RPC envelope
  ↓
[auth_check]
  Extract Bearer → token-resolver.ts
  Resolve userId, membership, JWT
  ↓
[rate_limit_check]
  Check per-token + per-tool counters in Vercel KV
  Exceeded? → return MCP error -32000 RATE_LIMIT_EXCEEDED
  ↓
[tool_dispatch]
  method === 'tools/list' → return tools registry (filtered by RBAC)
  method === 'tools/call' →
    Find tool by name → InvalidParams if not found
    Validate args against tool.inputSchema → InvalidParams if bad
    Check tool.requiredRoles vs membership.roles → tool_error UNAUTHORIZED if missing
    ↓
[handler_execution]
  Tool handler calls inventario-api client (openapi-fetch)
  API returns response → transform to tool output schema
  Audit log if write tool
  ↓
[response_send]
  Wrap in JSON-RPC 2.0 envelope, return
```

## Threat model

| #   | Útok                                                            | Obrana                                                                                                                           | Reziduálne riziko                                                                                                                         |
| --- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Token theft (browser/clipboard)**                             | Token sa zobrazuje raz, copy/paste flow. Storage je user responsibility. Revokovateľnosť cez `/settings/integrations`.           | User-side hygiene. Mitigation: short expiresAt default + periodic revalidation prompt v UI.                                               |
| 2   | **Token in version control** (user commitne config s tokenom)   | UI warning pri token zobrazení. Documentation guidance.                                                                          | Mitigation: rotation policy odporúčaná. Long-term: detection cez GitHub secret scanning (out of scope).                                   |
| 3   | **Cross-tenant data leak via shared token**                     | Token je single-tenant. JWT vydávaný MCP serverom má `org`/`mid` claim zo token row, NIE z user input.                           | Žiadne.                                                                                                                                   |
| 4   | **Token reuse po membership remove**                            | API auth middleware fetches active Membership; ak `deletedAt !== null` alebo `status !== ACTIVE` → 401.                          | Žiadne — invalidation je okamžitá.                                                                                                        |
| 5   | **Prompt injection cez asset descriptions, loan reasons, atď.** | MCP server vracia raw API responses. LLM context contamination je client-side concern.                                           | Inherentné v každej AI-data integration. Mitigation: client-side prompt hardening (Claude.ai side).                                       |
| 6   | **Destruktívna operácia cez prompt injection**                  | Excluded tools (delete, admin) nie sú v surface. Write tools cez confirmation flow v Claude.ai.                                  | Reduced significantly. Edge case: user explicitne potvrdí akciu na základe injected promptu (out-of-band attack).                         |
| 7   | **Audit log fakeout via MCP**                                   | `MCP_TOOL_INVOKED` audit log je server-controlled (token claims), nie client-controlled. `actor.userId` zhodný s token's userId. | Žiadne pre identity spoofing.                                                                                                             |
| 8   | **MCP server endpoint flooding**                                | Per-IP + per-token rate limits. Vercel Edge DDoS protection.                                                                     | Distributed botnet attack mimo app vrstvy.                                                                                                |
| 9   | **JWT replay attack medzi MCP→API**                             | Krátkodobé (5min) JWT vydávané MCP serverom in-memory only. Aud claim `inventario-api`.                                          | Window úzky. Mitigation pri kompromise: revoke token.                                                                                     |
| 10  | **Server-side request forgery via MCP server**                  | MCP server volá iba `INVENTARIO_API_URL` (env var, fixed). Žiadny user-controlled URL.                                           | Žiadne.                                                                                                                                   |
| 11  | **Tool definition tampering (cache poisoning)**                 | Tools sú compile-time definované, nie dynamic. Žiadne config tool catalog v DB.                                                  | Žiadne pre user-side; CI/CD security je separate concern.                                                                                 |
| 12  | **Sensitive data exfiltration cez LLM context**                 | Read tools vracajú len data, na ktoré má membership.roles RBAC. Audit log nie je v read surface.                                 | Tenant data exfiltration ostáva possible — token holder má prístup. Mitigation: token holder = autentifikovaný user, audit trail visible. |

## Slice #10 implementačný plán

### Fáza 1: Backend foundation (Slice #10a, ~2 dni, Sonnet)

| Blok | Popis                                                                                                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1   | `packages/shared-types`: `mcp-access-token.ts` schema + Audit log action enum additions (`MCP_TOKEN_CREATED`, `MCP_TOKEN_REVOKED`, `MCP_TOOL_INVOKED`) + entityType `McpAccessToken`. Regen types. |
| K2   | `apps/api/src/modules/auth/mcp-tokens/mcp-tokens.repository.ts` — CRUD + findByHash + soft delete. Indexy: `{tokenHash:1}` unique, `{userId:1, deletedAt:1}`, `{expiresAt:1}`.                     |
| K3   | `apps/api/src/modules/auth/mcp-tokens/mcp-tokens.routes.ts` — `POST/GET/PATCH/DELETE /v1/auth/mcp-tokens`. RBAC: any role + active membership in target org pre POST. Tests.                       |
| K4   | Cleanup job (daily) pre expired tokens — `apps/api/src/jobs/mcp-token-cleanup.ts`. Trigger via Vercel Cron.                                                                                        |

### Fáza 2: MCP server scaffold (Slice #10b, ~2 dni, Sonnet)

| Blok | Popis                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K5   | `apps/mcp-server` new package: `@inventario/mcp-server`. `package.json`, `tsconfig.json`, `vercel.json`. Install `@modelcontextprotocol/sdk@^1.x`, `openapi-fetch@^0.x`, `zod`. |
| K6   | `apps/mcp-server/src/auth/token-resolver.ts` — Bearer → (userId, membership, JWT). Direct Mongo query proti `mcp_access_tokens` cez `mongodb` driver (read-only).               |
| K7   | `apps/mcp-server/src/auth/jwt-issuer.ts` — Short-lived (5min) Inventario JWT issuance. Reuse `jose` lib + RS256 private key z env.                                              |
| K8   | `apps/mcp-server/src/clients/inventario-api.ts` — `openapi-fetch` client factory. Build step pre fetch `openapi.json` z asset-management-api.vercel.app a generate types.       |
| K9   | `apps/mcp-server/src/server.ts` — MCP SDK server setup s `tools/list` + `tools/call` handlers (zatiaľ prázdne registry). Vercel handler entry point.                            |
| K10  | `apps/mcp-server/src/lib/rate-limit.ts` — Vercel KV-backed counter. Per-token + per-tool limits per ADR table.                                                                  |

### Fáza 3: Tool implementation (Slice #10c, ~3.5 dňa, Sonnet)

> Aktualizované 2026-06-02 — catalog rozšírený o stock, číselníky, protokoly, members; loan write tools zosúladené s ADR-0026.

| Blok | Popis                                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K11  | Read tools — asset modul (`list_assets`, `get_asset`, `find_available_assets_for_loan`).                                                                                         |
| K12  | Read tools — loan modul (`list_loan_requests`, `list_loans`, `get_loan`, `get_my_loans`, `get_overdue_loans`, `list_loan_protocols`, `get_loan_protocol`).                       |
| K13  | Read tools — číselníky + members (`list_categories`, `list_locations`, `list_asset_types`, `list_asset_conditions`, `list_members`, `search_users`).                             |
| K13b | Read tools — stock (`get_stock_overview`, `get_stock_movements`).                                                                                                                |
| K14  | Write tools — loans (`create_loan_request`, `approve_loan_request`, `reject_loan_request`, `fulfil_loan_request`, `create_direct_loan`, `mark_loan_returned`, `mark_loan_lost`). |
| K15  | Write tools — assets + stock (`create_asset`, `update_asset`, `receive_stock`, `adjust_stock`).                                                                                  |
| K16  | `MCP_TOOL_INVOKED` audit log emission for write tools. Forward to Inventario API audit endpoint.                                                                                 |

### Fáza 4: Frontend integrations page (Slice #10d, ~1.5 dňa, Sonnet)

| Blok | Popis                                                                                                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K17  | `apps/web/src/app/settings/integrations/page.tsx` + `IntegrationsContent.tsx`. List MCP connections, "Add" dialog s tenant selector, post-create token display dialog (one-time show). |
| K18  | Revoke confirmation flow + rename inline edit. Last-used freshness indicator (color-coded).                                                                                            |

### Fáza 5: Tests + docs (Slice #10e, ~1.5 dňa)

| Blok | Popis                                                                                                                                                                                        | Model        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| K19  | Integration testy mcp-server: token resolution, tool dispatch, rate limiting, RBAC enforcement. Mock Inventario API responses. ~15 tests.                                                    | Sonnet       |
| K20  | API tests pre `/v1/auth/mcp-tokens` endpointy. ~8 tests.                                                                                                                                     | Sonnet       |
| K21  | Milestone doc `docs/milestones/slice-10-mcp-server.md`. NEXT.md update.                                                                                                                      | Haiku        |
| K22  | User guide `docs/user-guide/how-to/pripojit-claude-cez-mcp.md` + reference `mcp-tools-katalog.md`.                                                                                           | Haiku        |
| K23  | Vercel deployment setup: mcp-inventario-server project, env vars (`INVENTARIO_API_URL`, `MONGO_URI`, `JWT_PRIVATE_KEY`, `KV_REST_API_URL/TOKEN`), domain `mcp.inventario.estate` DNS record. | Ján manuálne |

**Celkom:** 24 K-blokov (pribudol K13b pre stock read tools), ~10.5 pracovných dní rozdelených na 5 fáz. Baseline pred Slice #10 je 825 testov; plus ~23 nových (K19 ~15 + K20 ~8) → target ~848 testov. Tool catalog: 18 read + 11 write = 29 nástrojov.

## Otvorené otázky / odložené veci

| #   | Otázka                                                               | Decision (deferral)                                                                                                                             |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | OAuth 2.1 + PKCE flow pre "one-click connect"                        | v0.8 post-MVP. Čakáme na stabilizáciu MCP-OAuth spec (Q4 2026 expected).                                                                        |
| 2   | Lokálny stdio MCP server variant                                     | Deferred. Pridáme len ak vznikne enterprise dopyt.                                                                                              |
| 3   | MCP Resources (`inventario://assets/{id}` URI scheme)                | Deferred. Tools coverujú use cases. Pridáme keď bude subscription pattern reálne potrebný.                                                      |
| 4   | MCP Prompts (templated prompts)                                      | Deferred. User-driven prompts zatiaľ stačia.                                                                                                    |
| 5   | Multi-tenant tokens s `switch_tenant` tool                           | Deferred. Single-tenant je jednoduchší a pre 99 % users dostatočný.                                                                             |
| 6   | Hybrid tool catalog (curated + opt-in low-level CRUD)                | Deferred. Pridáme keď bude reálny use case.                                                                                                     |
| 7   | Vector search nad assets (semantic search via embeddings)            | Out of scope pre Slice #10. Možný Slice #11 ak vznikne dopyt.                                                                                   |
| 8   | MCP server webhook notifications (push asset/loan changes to client) | Out of scope. Vercel serverless nepodporuje long-lived connections triviálne. Reconsider keď bude Vercel Edge Functions long-running primitive. |
| 9   | Delete operations s confirmation hint (Možnosť C z Q5)               | Deferred. Konzervatívne držíme write surface limited.                                                                                           |
| 10  | Audit log read tool (sanitized PII redaction)                        | Deferred. Risk reward unfavorable pre LLM kontext bleed.                                                                                        |
| 11  | Cross-tenant MCP via dynamic tenant switcher                         | Conflicts with single-tenant token decision. User adds multiple tokens pre multiple tenants.                                                    |
| 12  | Custom tenant domains (`assets.firma.sk`) impact                     | Tokens are bound to API URL not user-facing domain. No-op pre MCP.                                                                              |

## Dôsledky

### Pozitívne

- **Splnená funkčná špecifikácia** — § 1 explicitne uvádza MCP integráciu ako súčasť riešenia. Toto je deliverable.
- **Strategická pozícia** — Inventario je jeden z prvých EU asset management systémov s natívnou MCP integráciou. Konkurenčný diferenciátor pre tech-savvy tenants.
- **eIDAS 2.0 + AI Act alignment** — Inventario je "AI-friendly platform" v EU regulatory sense: tools sú typed, RBAC-enforced, audit-logged. Vyhovuje budúcim AI Act compliance frameworks (high-risk AI systems usage logging).
- **Reused infrastructure** — žiadny nový DB stack, auth model, business logic. MCP server je tenká vrstva. Tým je test surface manageable a deployment risk nízky.
- **API gateway pattern** — žiadna data duplication, žiadne race conditions medzi MCP a web API. Single source of truth zostáva Inventario API.
- **Token model je extensible** — keď v v0.8 prídeme s OAuth 2.1, je to "tokens stored differently, same logic" — žiadny prepis tool handlers.
- **Curated tools = lepší LLM výkon** — kvalita tool selection v Claude / GPT modeloch sa dramaticky zlepšuje keď je catalog small + well-described.
- **No vendor lock-in** — Anthropic MCP SDK je MIT. Spec je open. Funguje s Claude.ai, Claude Desktop, ChatGPT (keď MCP support), atď.

### Negatívne / kompromisy

- **~10 dní implementácie** — 23 K-blokov rozdelených v 5 fázach. Nie blocker pre launch (Slice #10 je Q1 2027 timeline), ale netriviálny effort.
- **Latency tax** — extra HTTP hop ~50-100ms. Akceptable pre conversational AI, ale počítať s tým pri performance testovaní.
- **Coupling na Inventario API surface** — ak sa API endpoint signature zmení, MCP tool handlers môžu prestať fungovať. Mitigácia: OpenAPI typescript generation v CI; pri každom API zmene CI build MCP-servera fail-uje ak došlo k breaking change.
- **Žiadna OAuth 2.1 v MVP** — UX je copy/paste token, nie one-click. Friction pre casual users. Mitigácia: dobrý onboarding flow v `/settings/integrations`.
- **Excluded tools = users s power-user dopytmi budú frustrovaní** — niekto bude pýtať "zmaž tento asset" cez Claude. Tool nie je v surface. Mitigácia: clear error message s linkom na web UI.
- **Audit log noise** — write tools auditované, ale read tools nie. Compromise medzi observability a log volume. Niekto môže chcieť všetky audit, ale výkonnostne by to bolo bolestivé.
- **Rate limiting cez Vercel KV** — KV je extra dependency a má vlastné limits. Pre MVP traffic OK, ale pri 1000+ tenants treba zvážiť Redis upgrade.
- **MCP spec evolution risk** — Anthropic MCP spec sa stále vyvíja. Major protocol bump (v2.0) by mohol vyžadovať MCP server rewrite. Mitigation: SDK version pinning + spec-version negotiation v handshake.

### Riziká, ktoré treba sledovať

- **MCP protocol changes** — sledovať Anthropic MCP changelog. Allocate ~0.5 day každý kvartál na version sync. CI integration test verifying spec compliance.
- **`@modelcontextprotocol/sdk` breaking changes** — semver-pinning na minor version. Major version upgrades robíme manuálne s explicit review.
- **OpenAPI drift** — keď sa Inventario API zmení, openapi.json sa regeneruje, openapi-fetch types prejdú, ale MCP tool handlers môžu mať broken logic. CI musí spustiť MCP build proti aktuálnemu API.
- **Vercel KV cost** — počítame `300 calls/min * 100 active users * 60 * 24 * 30 = ~13 milión calls/month` worst case. Vercel KV Pro plan má 100M ops/month, sme v limite. Monitor cez Vercel dashboard.
- **Inventario API rate limit conflicts** — MCP server tunneluje na Inventario API. Ak API má per-IP limits, všetky MCP calls "z" mcp.inventario.estate.vercel.app vyzerajú ako jeden IP — môže vyčerpať limit. Mitigation: whitelist MCP server IP range v API rate limiter (config addition).
- **Sensitive data exposure cez LLM training** — keď user pýta Claude o Inventario data, conversation môže byť uložená na strane Claude.ai (depends on plan). Pre tenants s vysokou citlivosťou: documentation guidance ("nepoužívajte MCP na sensitive data") + opt-out per-tenant (`org.settings.mcpEnabled: false`). To je org-level kill switch — out of scope pre v0.7 MVP, ale dôležitý add v v0.8.
- **Token leak in client config files** — user paste-uje token do Claude Desktop config JSON. Ak svoj počítač zdieľa, token je exposed. Standard hygiene; environment variable storage je advanced user concern.
- **MCP server cold start** — Vercel function cold start ~500ms first call. Pre conversational UX akceptable, ale prvý dotaz v session "trvá dlho". Mitigation: keep-warm cron každých 5 min (cost-conscious).
- **Single-tenant per-token assumption breakdown** — ak user prepne primary tenant (`POST /v1/auth/switch-organisation`), jeho existing MCP token zostáva bound na pôvodný tenant. To je correct behavior, ale UX guidance je potrebná ("pridajte nový MCP token pre nový tenant"). Documentation odovzdáme v K22.

## Referencie

- [Model Context Protocol Specification](https://modelcontextprotocol.io/specification) — Anthropic open standard
- [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) — TypeScript SDK, MIT
- [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) — type-safe HTTP client, MIT
- [MCP HTTP+SSE transport spec](https://modelcontextprotocol.io/specification/server/transports) — remote MCP server pattern
- [MCP tool annotations RFC](https://modelcontextprotocol.io/specification/server/tools) — `readOnlyHint`, `destructiveHint` semantics
- [ADR-0013 Multi-provider auth](0013-multi-provider-auth-self-serve.md) — JWT model, refresh tokens pattern
- [ADR-0015 Cross-tenant memberships](0015-cross-tenant-memberships.md) — tenant scoping post-Slice #9
- [Vercel Functions](https://vercel.com/docs/functions) — runtime constraints
- [Vercel KV](https://vercel.com/docs/storage/vercel-kv) — Redis-compatible rate limiting backend
- [EU AI Act, Annex III](https://eur-lex.europa.eu/eli/reg/2024/1689/oj) — high-risk AI system logging requirements
- [`docs/functional-spec.md` § 1](../functional-spec.md) — produktový mandát pre MCP server
