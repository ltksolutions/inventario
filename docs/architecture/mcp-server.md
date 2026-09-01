# MCP server – špecifikácia

|                           |                                           |
| ------------------------- | ----------------------------------------- |
| **Verzia**                | 0.1 (draft)                               |
| **Status**                | Návrh                                     |
| **Posledná aktualizácia** | máj 2026                                  |
| **Implementácia**         | `apps/mcp-server/` (Node.js + TypeScript) |

## Obsah

1. [Čo je MCP a prečo](#1-čo-je-mcp-a-prečo)
2. [Architektúra](#2-architektúra)
3. [Autentifikácia](#3-autentifikácia)
4. [Vystavované tools](#4-vystavované-tools)
5. [Vystavované resources](#5-vystavované-resources)
6. [Bezpečnosť a oprávnenia](#6-bezpečnosť-a-oprávnenia)
7. [Príklady použitia](#7-príklady-použitia)
8. [Inštalácia v Claude / iných klientoch](#8-inštalácia-v-claude-iných-klientoch)
9. [Implementačné poznámky](#9-implementačné-poznámky)

---

## 1. Čo je MCP a prečo

**Model Context Protocol (MCP)** je otvorený štandard od Anthropicu pre prepojenie AI asistentov s externými systémami. Umožňuje LLM-om volať definované funkcie (tools) a čítať dáta (resources) s rovnakými oprávneniami ako bežný používateľ.

### Cieľ pre SFZ

Umožniť zamestnancom SFZ a administrátorom interagovať so systémom asset managementu cez AI asistenta (Claude Desktop, Claude.ai, ChatGPT s MCP support, atď.) prirodzeným jazykom:

- _„Ukáž mi, čo mám aktuálne vypožičané"_
- _„Koľko notebookov starších ako 4 roky máme?"_
- _„Kto má aktuálne dres s číslom 10 reprezentácie A?"_
- _„Pripomeň mi všetkých, ktorých zápožičky končia tento týždeň"_
- _„Aký majetok je momentálne v servise?"_

### Prečo nie iba REST API?

REST API budeme mať tak či tak – MCP server je **tenká vrstva nad REST API**, ktorá:

- Štrukturovane popisuje tools (názov, popis, JSON Schema parametrov), takže LLM vie, kedy ich má volať.
- Zaobaľuje autentifikáciu a session management.
- Filtruje a formátuje odpovede pre kontext LLM (menej tokenov, lepšia čitateľnosť).
- Dodržiava bezpečnostné pravidlá (LLM nemôže obísť RBAC).

---

## 2. Architektúra

```
┌─────────────────────────────┐
│ Claude Desktop / Claude.ai  │
│ (MCP klient)                │
└──────────────┬──────────────┘
               │
               │ MCP (JSON-RPC nad SSE alebo stdio)
               │
               ▼
┌─────────────────────────────┐
│ MCP server                  │
│ (apps/mcp-server)           │
│                             │
│ - Tool definitions          │
│ - Auth via OAuth 2.1        │
│ - Permission checks         │
│ - Response formatting       │
└──────────────┬──────────────┘
               │
               │ HTTPS / REST + Bearer token
               │
               ▼
┌─────────────────────────────┐
│ REST API                    │
│ (apps/api – NestJS)         │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ MongoDB Atlas               │
└─────────────────────────────┘
```

### Deployment módy

MCP server bude dostupný v dvoch módoch:

1. **Remote (SSE)** – primárny mód pre Claude.ai a webových klientov.
   - URL: `https://mcp.inventario.estate/sse`
   - Autentifikácia: OAuth 2.1 s redirect na Entra ID
   - Stateful session per používateľ

2. **Local (stdio)** – pre Claude Desktop a vývojárov.
   - Spustí sa lokálne ako process
   - Autentifikácia: Personal Access Token z webového UI
   - Konfigurácia v `~/Library/Application Support/Claude/claude_desktop_config.json`

---

## 3. Autentifikácia

### OAuth 2.1 (preferované, pre Remote mód)

Podľa [MCP spec autorizačnej časti](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization):

1. MCP klient (Claude) zistí, že server vyžaduje auth (`401` so `WWW-Authenticate`).
2. Klient získa `resource_metadata` z `/.well-known/oauth-protected-resource`.
3. Spustí Authorization Code flow s PKCE proti našemu auth serveru (Entra ID + náš token exchange).
4. Získa access token (krátko platný, 15 min) + refresh token.
5. MCP requesty obsahujú `Authorization: Bearer <token>`.

### Personal Access Token (PAT) – pre Local mód

- Vygenerovaný v webovom UI (`/settings/tokens`).
- Formát: `sfz_pat_<base62-32znakov>`.
- Hashovaný (Argon2) v DB; pôvodný token zobrazený len raz pri vytvorení.
- Konfigurovateľná platnosť (max. 1 rok).
- Možnosť revokácie kedykoľvek.
- Scopes: `read:assets`, `read:loans`, `read:reports`, ...

### Mapovanie identity

Identita z MCP tokenu sa mapuje na `User` v systéme. Všetky volania bežia s oprávneniami daného používateľa – **MCP server nepridáva žiadne privilégiá nad rámec toho, čo by používateľ mal cez web**.

---

## 4. Vystavované tools

> Pre fázu 1 (MVP) implementujeme P1 tools. P2 nasledujú v ďalšej fáze.

### 4.1 Vyhľadávanie a info

#### `search_assets` (P1)

Vyhľadanie majetku.

```json
{
  "name": "search_assets",
  "description": "Vyhľadá majetok v evidencii SFZ podľa zadaných kritérií. Podporuje full-text vyhľadávanie v názve, popise, sériovom čísle a tagoch.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Full-text vyhľadávací reťazec"
      },
      "status": {
        "type": "string",
        "enum": [
          "available",
          "reserved",
          "borrowed",
          "in_service",
          "disposed",
          "lost"
        ]
      },
      "category": {
        "type": "string",
        "description": "Kategória (napr. 'notebook', 'dres'). Podporuje aj parciálne match."
      },
      "location": {
        "type": "string",
        "description": "Lokalita (napr. 'centrála', 'Bratislava')"
      },
      "limit": { "type": "integer", "default": 20, "maximum": 100 }
    }
  }
}
```

Príklad výstupu:

```json
{
  "count": 3,
  "totalMatching": 12,
  "results": [
    {
      "inventoryNumber": "SFZ-2024-NB-00042",
      "name": "Dell Latitude 7430",
      "status": "borrowed",
      "borrowedBy": "Ján Novák",
      "dueAt": "2026-05-20",
      "location": "Centrála Bratislava"
    },
    ...
  ]
}
```

#### `get_asset_details` (P1)

Detail jednej položky vrátane histórie pohybov.

```json
{
  "name": "get_asset_details",
  "description": "Vráti detailné informácie o konkrétnej položke majetku podľa inventárneho čísla, vrátane jej aktuálneho stavu a histórie pohybov.",
  "inputSchema": {
    "type": "object",
    "required": ["inventoryNumber"],
    "properties": {
      "inventoryNumber": { "type": "string" },
      "includeHistory": { "type": "boolean", "default": true },
      "historyLimit": { "type": "integer", "default": 10 }
    }
  }
}
```

#### `get_my_loans` (P1)

Moje aktívne zápožičky.

```json
{
  "name": "get_my_loans",
  "description": "Vráti zápožičky aktuálneho používateľa.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "status": {
        "type": "string",
        "enum": ["active", "returned", "all"],
        "default": "active"
      }
    }
  }
}
```

#### `get_user_loans` (P1, admin/asset_manager)

Zápožičky konkrétneho používateľa – iba pre privilegované roly.

```json
{
  "name": "get_user_loans",
  "description": "Vráti zápožičky zadaného používateľa. Vyžaduje rolu admin alebo asset_manager.",
  "inputSchema": {
    "type": "object",
    "required": ["userIdentifier"],
    "properties": {
      "userIdentifier": {
        "type": "string",
        "description": "E-mail, meno alebo ID používateľa"
      },
      "status": {
        "type": "string",
        "enum": ["active", "returned", "all"],
        "default": "active"
      }
    }
  }
}
```

#### `get_overdue_loans` (P1, admin/asset_manager)

Zápožičky po splatnosti.

```json
{
  "name": "get_overdue_loans",
  "description": "Vráti zápožičky, ktoré sú po splatnosti.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "minDaysOverdue": { "type": "integer", "default": 1 },
      "location": { "type": "string" }
    }
  }
}
```

#### `get_assets_by_age` (P2, admin/asset_manager)

Majetok starší ako N rokov (plánovanie obnovy).

```json
{
  "name": "get_assets_by_age",
  "description": "Vráti majetok starší ako zadaný počet rokov, ideálne pre plánovanie obnovy. Vek sa počíta od dátumu nadobudnutia.",
  "inputSchema": {
    "type": "object",
    "required": ["minYears"],
    "properties": {
      "minYears": { "type": "number", "minimum": 0 },
      "category": { "type": "string" },
      "limit": { "type": "integer", "default": 50 }
    }
  }
}
```

#### `get_asset_history` (P1)

História pohybov položky.

```json
{
  "name": "get_asset_history",
  "description": "Vráti chronologickú históriu pohybov konkrétnej položky majetku.",
  "inputSchema": {
    "type": "object",
    "required": ["inventoryNumber"],
    "properties": {
      "inventoryNumber": { "type": "string" },
      "limit": { "type": "integer", "default": 20 }
    }
  }
}
```

#### `find_who_has` (P1)

Kto má aktuálne danú vec.

```json
{
  "name": "find_who_has",
  "description": "Zistí, kto má aktuálne vypožičanú konkrétnu položku majetku.",
  "inputSchema": {
    "type": "object",
    "required": ["inventoryNumber"],
    "properties": {
      "inventoryNumber": { "type": "string" }
    }
  }
}
```

### 4.2 Štatistiky a reporty

#### `get_loan_statistics` (P2, admin)

```json
{
  "name": "get_loan_statistics",
  "description": "Vráti štatistiky o zápožičkách za zvolené obdobie.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "from": { "type": "string", "format": "date" },
      "to": { "type": "string", "format": "date" },
      "groupBy": { "type": "string", "enum": ["category", "location", "user"] }
    }
  }
}
```

#### `get_inventory_summary` (P1)

Sumár zložiek inventára.

```json
{
  "name": "get_inventory_summary",
  "description": "Vráti sumarizovaný prehľad inventára: počet položiek per kategória, per stav, per lokalita.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "groupBy": {
        "type": "string",
        "enum": ["category", "status", "location"],
        "default": "category"
      }
    }
  }
}
```

### 4.3 Akcie (write operations)

> Write operations sú v MCP citlivá záležitosť – LLM by mohol omylom vytvoriť žiadosť alebo schváliť niečo. Pre fázu 1 sú **všetky write operations vypnuté**. Vo fáze 2 budú s povinným potvrdením (confirmation pattern).

#### `create_loan_request` (P2)

```json
{
  "name": "create_loan_request",
  "description": "Vytvorí žiadosť o vypožičanie majetku. POZOR: pred vytvorením systém vyžiada potvrdenie od používateľa cez UI.",
  "inputSchema": {
    "type": "object",
    "required": ["assetIdentifiers", "from", "until", "purpose"],
    "properties": {
      "assetIdentifiers": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Pole inventárnych čísel alebo názvov"
      },
      "from": { "type": "string", "format": "date-time" },
      "until": { "type": "string", "format": "date-time" },
      "purpose": { "type": "string" }
    }
  }
}
```

---

## 5. Vystavované resources

MCP resources sú statické dáta, ktoré LLM môže čítať bez explicitného tool callu. Použijeme pre:

| URI                               | Popis                                            |
| --------------------------------- | ------------------------------------------------ |
| `sfz-assets://categories`         | Zoznam kategórií s definíciou custom fields      |
| `sfz-assets://locations`          | Zoznam lokalít                                   |
| `sfz-assets://my-profile`         | Profil aktuálneho používateľa (rola, oprávnenia) |
| `sfz-assets://help/loan-workflow` | Markdown popis workflow vypožičania              |

---

## 6. Bezpečnosť a oprávnenia

### Princípy

1. **Žiadne privilégiá navyše** – MCP server používa REST API s tokenom konkrétneho používateľa.
2. **Read-only v MVP** – fáza 1 obsahuje len čítacie operácie.
3. **Audit log pre všetky volania** – každý MCP tool call sa loguje rovnako ako web request.
4. **Rate limiting** – 60 req/min per token (nižšie ako web, lebo LLM môže volať agresívne v slučke).
5. **Token scoping** – PAT tokeny majú scopes; používateľ si môže vytvoriť obmedzený token len pre čítanie.
6. **Confirmation pattern pre write** – fáza 2: write operations vrátia `requires_confirmation: true` + URL na schválenie cez webové UI. LLM nikdy nevykoná write operáciu autonómne.

### Permission matrix

| Tool                    |    employee    |     team_manager     | asset_manager | admin |
| ----------------------- | :------------: | :------------------: | :-----------: | :---: |
| `search_assets`         |       ✅       |          ✅          |      ✅       |  ✅   |
| `get_asset_details`     |       ✅       |          ✅          |      ✅       |  ✅   |
| `get_my_loans`          |       ✅       |          ✅          |      ✅       |  ✅   |
| `get_user_loans`        |       ❌       |    ✅ (svoj tím)     |      ✅       |  ✅   |
| `get_overdue_loans`     |       ❌       |    ✅ (svoj tím)     |      ✅       |  ✅   |
| `get_assets_by_age`     |       ❌       |          ❌          |      ✅       |  ✅   |
| `get_loan_statistics`   |       ❌       |    ✅ (svoj tím)     |      ✅       |  ✅   |
| `get_inventory_summary` | ✅ (obmedzené) |          ✅          |      ✅       |  ✅   |
| `find_who_has`          |       ❌       | ✅ (vlastné assigns) |      ✅       |  ✅   |

### Citlivé dáta

- **Osobné údaje** v odpovediach: vraciame len `displayName` a `email` osôb, ktoré používateľ vidí aj cez web.
- **Pre externých používateľov** MCP server nie je dostupný (zatiaľ).
- **Logovanie:** request/response sa loguje, ale obsah parametrov a tela odpovede sa anonymizuje pre dlhodobé úložisko (PII filtering).

---

## 7. Príklady použitia

### Príklad 1: Bežný zamestnanec

```
Užívateľ:  Čo mám aktuálne vypožičané?
Claude:    [volá get_my_loans]
           Máte aktuálne 3 vypožičané položky:
           • Notebook Dell Latitude 7430 (SFZ-2024-NB-00042) – do 20.5.2026
           • Mobil iPhone 14 (SFZ-2024-MO-00118) – do 30.6.2026
           • Slúchadlá Logitech (SFZ-2024-AU-00009) – do 30.5.2026

           Jedna zápožička (notebook) končí už za 9 dní. Chcete predĺžiť?
```

### Príklad 2: Asset manager

```
Užívateľ:  Daj mi prehľad notebookov, ktoré sú staršie ako 4 roky.
Claude:    [volá get_assets_by_age(minYears=4, category="notebook")]
           Našiel som 23 notebookov starších ako 4 roky:

           | Inv. číslo         | Model               | Vek    | Stav        | Aktuálne má |
           |--------------------|---------------------|--------|-------------|-------------|
           | SFZ-2021-NB-00007  | Lenovo ThinkPad T14 | 5.2 r. | borrowed    | M. Kováč    |
           | SFZ-2021-NB-00008  | Lenovo ThinkPad T14 | 5.2 r. | available   | –           |
           ...

           Odporúčam zaradiť do plánu obmeny v tomto roku.
```

### Príklad 3: Hľadanie konkrétnej veci

```
Užívateľ:  Kto má dres číslo 10 reprezentácie A?
Claude:    [volá search_assets(query="dres číslo 10 reprezentácia A")]
           [volá find_who_has(...)]
           Dres č. 10 reprezentácie A (SFZ-2025-DR-00010) má aktuálne
           Marek Hamšík (asistent trénera). Vypožičané od 5. mája 2026,
           termín vrátenia 25. máj 2026.
```

---

## 8. Inštalácia v Claude / iných klientoch

### Claude Desktop (stdio mód)

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sfz-assets": {
      "command": "npx",
      "args": ["-y", "@sfz/mcp-server-assets"],
      "env": {
        "INVENTARIO_API_URL": "https://api.inventario.estate/v1",
        "SFZ_PAT_TOKEN": "sfz_pat_..."
      }
    }
  }
}
```

### Claude.ai (remote SSE mód)

1. Settings → Integrations → Add MCP server
2. URL: `https://mcp.inventario.estate/sse`
3. Authenticate cez OAuth flow (presmeruje na Entra ID)
4. Hotovo

### ChatGPT / iné

MCP je otvorený štandard – akýkoľvek MCP-compatible klient sa pripojí rovnako.

---

## 9. Implementačné poznámky

### Tech stack

- **Runtime:** Node.js 20+
- **Jazyk:** TypeScript
- **SDK:** [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
- **HTTP klient pre REST:** OpenAPI generovaný klient z `packages/api-client/`
- **Validácia:** Zod
- **Hosting:** rovnaký ako API (Azure App Service / Container Apps)

### Štruktúra `apps/mcp-server/`

```
apps/mcp-server/
├── src/
│   ├── server.ts              # MCP server entry point
│   ├── tools/                 # Definície tools
│   │   ├── search-assets.ts
│   │   ├── get-my-loans.ts
│   │   └── ...
│   ├── resources/             # Resources
│   ├── auth/                  # OAuth flow handlers
│   ├── api-client/            # Wrapped REST client
│   └── formatters/            # Format response pre LLM (kratšie, čitateľnejšie)
├── test/
└── package.json
```

### Princípy implementácie

- **Idempotentné tools** – opakovaný volanie s rovnakými args vracia rovnaký výsledok (read-only).
- **Token efficiency** – odpovede formátujeme stručne, číselné polia zaokrúhľujeme, dlhé zoznamy stránkujeme.
- **Chybové stavy** – chyby sa vracajú ako MCP error responses, nikdy nie ako hlboké JSON detaily.
- **Bez cache** v prvej verzii – konzistencia s aktuálnym stavom DB. Cache zvážime, ak narastie záťaž.

---

## Otvorené otázky

| ID     | Otázka                                                       | Vlastník      |
| ------ | ------------------------------------------------------------ | ------------- |
| MCP-01 | Hostovať OAuth proxy ako súčasť `apps/api` alebo separátne?  | Tech lead     |
| MCP-02 | Aký formát PAT? `sfz_pat_*` alebo štandardný `glpat_*`-like? | Tech lead     |
| MCP-03 | Povoliť write operations vo fáze 2 alebo zostať read-only?   | Product owner |
| MCP-04 | Aktivovať MCP aj pre externých používateľov (klubov)?        | Product owner |
| MCP-05 | Pravidelné automatické notifikácie cez MCP (push)?           | Tech lead     |

---

## Referencie

- [Model Context Protocol spec](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Anthropic MCP introduction](https://www.anthropic.com/news/model-context-protocol)
