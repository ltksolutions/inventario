<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                                    |
| ------------------------- | -------------------------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-05-25 (migrácia do ltksolutions/inventario + URL cleanup)             |
| **Aktuálna fáza**         | Production — legal review externe; Slice #10 MCP server Q1 2027            |
| **Posledný session log**  | [`docs/milestones/slice-8-passkeys.md`](../milestones/slice-8-passkeys.md) |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`                              |
| **GitHub**                | https://github.com/ltksolutions/inventario                                 |

---

## Čo sme spravili 2026-05-25

### Slice #8 — Passkeys / WebAuthn (K1–K16) ✅

Plný WebAuthn stack:

- **Backend:** config env vars, PasskeyCredentialSchema (global), repository, JWT challenge tokens, `userSatisfiesMfa()` helper, 7 API endpointov (register/login/management), boot guard
- **Frontend:** `webauthn.ts` helper, "Prihlásiť sa cez passkey" tlačidlo na login page, conditional UI autofill, `PasskeysPanel` v `/settings/security`
- **Testy:** 16 integration testov so syntetickými WebAuthn attestations (vlastný CBOR encoder)
- **Docs:** milestone doc, user guide `pouzit-passkey.md`

### Repo migrácia ✅

- `Slovensky-futbalovy-zvaz/Asset-Management` → `ltksolutions/inventario`
- Git história zachovaná (`--mirror` push)
- GitHub Desktop aktualizovaný
- Vercel reconnected + redeployed
- GitHub Secrets prenesené
- Starý repo archivovaný
- Lokálny adresár premenovaný: `Asset-Management` → `inventario`

### URL cleanup ✅

- `package.json`: repository URL + homepage
- `CITATION.cff`: repository-code + url + license-url
- `apps/api/src/plugins/email.ts`: JSDoc komentáre `inventario.sportup.sk` → `inventario.estate`

### CI fixes ✅

- `autoFocus` prop removed (jsx-a11y/no-autofocus)
- WebAuthn CBOR encoding fix (cborNegInt správne záporné čísla)
- Synthetic attestation fixtures TS strict fixes

---

## Stav na konci 2026-05-25

### 📊 Globálny stav

| Oblasť            | Status                                      |
| ----------------- | ------------------------------------------- |
| **Backend testy** | ✅ 569 / 569 (33 test files)                |
| **Frontend**      | ✅ 9/9 stránok + passkeys + tenant switcher |
| **Production**    | ✅ LIVE — inventario.estate                 |
| **GitHub**        | ✅ github.com/ltksolutions/inventario       |
| **Vercel**        | ✅ reconnected + redeployed                 |
| **Legal review**  | ⏳ PENDING (externe)                        |
| **Slice #10 MCP** | 📅 Q1 2027 — design hotový (ADR-0017)       |

---

## ⏭️ Najbližšie kroky

### ⏳ Pending (externe / manuálne)

| Úloha                                        | Status                             |
| -------------------------------------------- | ---------------------------------- |
| Legal review compliance dokumentov           | ⏳ externe                         |
| Production smoke test (Slice #9 + #8 deploy) | ⏳ manuálne (Ján)                  |
| Atlas allowlist → Vercel Secure Compute      | 📅 post-pilot                      |
| Apple Sign-In (K4)                           | 📅 čaká na Apple Developer account |

### 📅 Slice #10 — MCP server (~10 dní, Q1 2027, Sonnet 4.6)

Design: [ADR-0017](../decisions/0017-mcp-server.md)

#### Fáza 1: Backend foundation (Slice #10a)

| Blok   | Popis                                                                                                                             |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **K1** | shared-types: `mcp-access-token.ts`. Audit log enum additions (`MCP_TOKEN_CREATED/REVOKED/INVOKED`). entityType `McpAccessToken`. |
| **K2** | `apps/api/src/modules/auth/mcp-tokens/mcp-tokens.repository.ts` — CRUD + findByHash. Indexy.                                      |
| **K3** | `apps/api/src/modules/auth/mcp-tokens/mcp-tokens.routes.ts` — POST/GET/PATCH/DELETE. Tests.                                       |
| **K4** | Cleanup job pre expired tokens — Vercel Cron.                                                                                     |

#### Fáza 2: MCP server scaffold (Slice #10b)

| Blok    | Popis                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------- |
| **K5**  | `apps/mcp-server` new package. Install `@modelcontextprotocol/sdk@^1.x`, `openapi-fetch`, `zod`.   |
| **K6**  | `auth/token-resolver.ts` — Bearer → (userId, membership, JWT). Direct Mongo read.                  |
| **K7**  | `auth/jwt-issuer.ts` — 5min short-lived Inventario JWT.                                            |
| **K8**  | `clients/inventario-api.ts` — openapi-fetch factory. Build step pre generate types z openapi.json. |
| **K9**  | `server.ts` — MCP SDK setup. Vercel handler entry point.                                           |
| **K10** | `lib/rate-limit.ts` — Vercel KV-backed counter per ADR-0017 table.                                 |

#### Fáza 3: Tool implementation (Slice #10c)

| Blok        | Popis                                                              |
| ----------- | ------------------------------------------------------------------ |
| **K11–K13** | Read tools — assets (3), loans (4), categories/locations/users (3) |
| **K14–K15** | Write tools — loans (5), assets (2)                                |
| **K16**     | `MCP_TOOL_INVOKED` audit log emission                              |

#### Fáza 4: Frontend integrations page (Slice #10d)

| Blok        | Popis                                                                        |
| ----------- | ---------------------------------------------------------------------------- |
| **K17–K18** | `/settings/integrations` page — list + add + revoke + rename MCP connections |

#### Fáza 5: Tests + docs (Slice #10e)

| Blok        | Popis                                                                |
| ----------- | -------------------------------------------------------------------- |
| **K19–K20** | Tests: MCP server (~15), mcp-tokens API (~8)                         |
| **K21–K22** | Milestone doc, user guide `pripojit-claude-cez-mcp.md`               |
| **K23**     | Vercel deployment setup + DNS `mcp.inventario.estate` (Ján manuálne) |

---

## 📅 Compliance Fáza 2 (po prvom tenant launchom)

| Dokument                      | Model      | Odhad |
| ----------------------------- | ---------- | ----- |
| DPIA Template                 | Opus 4.7   | ~3h   |
| Security & Privacy Whitepaper | Opus 4.7   | ~4h   |
| Data Retention Schedule       | Sonnet 4.6 | ~2h   |
| Information Security Policy   | Sonnet 4.6 | ~2h   |

## 📅 Post-launch (LOW priority)

- `Cmd+K` tenant picker — ~30 min Sonnet
- SOC 2 Type II — pri prvom enterprise tenantovi
- ISO/IEC 27001 — pri verejnom obstarávaní

---

## 🏗️ Backend status

```
Celkové testy:                569
├── Slice #1–#3:              ~310
├── Slice #4–#6b:             ~169
├── Slice #6c:                  21
├── Slice #7 + K12a/b:          29
├── Slice #9:                   28
└── Slice #8 (Passkeys):        16

Test files:   33
Duration:     ~75s
```

---

## 🧭 Model routing

| Task typ                                                    | Model          |
| ----------------------------------------------------------- | -------------- |
| Strategické rozhodnutia, ADR, DPIA, security architecture   | **Opus 4.7**   |
| CRUD endpoints, frontend pages, debug, tests, implementácia | **Sonnet 4.6** |
| Milestone docs, mechanické edits, scoped docs               | **Haiku 4.5**  |

> **Pri začiatku každej session:** Claude zhodnotí či model pasuje a upozorní pri nesúlade.

---

## 📂 Kde nájdeš čo

| Typ                     | Lokácia                                               |
| ----------------------- | ----------------------------------------------------- |
| **Aktuálny stav**       | `docs/sessions/NEXT.md` (TY SI TU)                    |
| **ADR-čka**             | `docs/decisions/0001..0017-*.md`                      |
| **Slice milestones**    | `docs/milestones/slice-*.md`                          |
| **GDPR / compliance**   | `docs/compliance/`                                    |
| **Passkeys design**     | `docs/decisions/0016-passkeys-implementation-plan.md` |
| **MCP server design**   | `docs/decisions/0017-mcp-server.md`                   |
| **Passkeys user guide** | `docs/user-guide/how-to/pouzit-passkey.md`            |
| **API reference**       | `docs/api/README.md`                                  |

---

**Last updated:** 2026-05-25  
**Tests:** 569 / 569 ✅  
**Repo:** github.com/ltksolutions/inventario  
**Status:** Launch-ready. Legal review externe. Slice #10 Q1 2027.
