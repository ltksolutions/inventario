<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-05-25 (ADR-0016 Passkeys + ADR-0017 MCP design session)                                                                                                                        |
| **Aktuálna fáza**         | Slice #8 Passkeys implementácia (Sonnet 4.6)                                                                                                                                        |
| **Posledný session log**  | [`docs/decisions/0016-passkeys-implementation-plan.md`](../decisions/0016-passkeys-implementation-plan.md) / [`docs/decisions/0017-mcp-server.md`](../decisions/0017-mcp-server.md) |

---

## Stav na konci 2026-05-25

### ✅ Hotové

| Slice / Blok      | Čo                                                                             |
| ----------------- | ------------------------------------------------------------------------------ |
| Slice #1–#3       | Backend bootstrap, Entra ID auth, Assets CRUD + RBAC + audit + transactions    |
| Slice #2c         | Tests + pre-commit typecheck + CI Atlas                                        |
| Slice #3          | Categories + Locations CRUD + FK protection                                    |
| Slice #4          | Frontend web (9/9 stránok)                                                     |
| Slice #5          | Loans MVP                                                                      |
| Slice #6–#6c      | Multi-provider auth + OAuth + email/heslo + invitations                        |
| Slice #7          | TOTP MFA                                                                       |
| K12a + K12b       | Forced MFA + Admin MFA reset                                                   |
| Slice #9 (K1–K25) | Cross-tenant memberships — KOMPLETNÝ                                           |
| MEDIUM tasks      | K13 OAuth fix, resend invitation, per-email exceptions, email change, API docs |
| CI fix            | openapi offline mode (MongoMemoryServer, no Atlas)                             |
| **ADR-0016**      | Passkeys implementačný plán post-Slice #9 (Opus session)                       |
| **ADR-0017**      | MCP server design + Slice #10 roadmap (Opus session)                           |

### 📊 Globálny stav

| Oblasť                   | Status                                                                |
| ------------------------ | --------------------------------------------------------------------- |
| **Backend testy**        | ✅ 553 / 553 (32 test files, ~70s)                                    |
| **Frontend**             | ✅ 9/9 stránok + tenant switcher + members + organisations + security |
| **Production**           | ✅ LIVE — inventario.estate                                           |
| **Legal review**         | ⏳ PENDING (externe)                                                  |
| **Slice #8 Passkeys**    | 🔜 NEXT — K1 začíname                                                 |
| **Slice #10 MCP server** | 📅 Q1 2027 — design hotový (ADR-0017)                                 |

---

## ⏭️ Najbližšie kroky

### 🔥 Slice #8 — Passkeys / WebAuthn (~5.5 dní, Sonnet 4.6)

Design: [ADR-0016](../decisions/0016-passkeys-implementation-plan.md)

#### Fáza 1: Backend foundation (Slice #8a)

| Blok   | Popis                                                                                                                                                                                     | Status |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **K1** | Install `@simplewebauthn/server@^13`. Config env vars (`WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_EXPECTED_ORIGINS`). Boot guard (503 stub pattern). `turbo.json` globalEnv.         | 🔜     |
| **K2** | `packages/shared-types/src/schemas/passkey.ts` (NO OrganisationScopedSchema). User schema additions (`passkeyEnabled`, `passkeyEnabledAt`). Audit log enum additions. Regen shared-types. | 🔜     |
| **K3** | `apps/api/src/modules/auth/passkeys/passkeys.repository.ts` — CRUD + findByCredentialId + findByUserId + countActiveByUserId + softDelete. Indexy.                                        | 🔜     |
| **K4** | Extend `inventario-jwt.ts`: `issueWebauthnChallenge(userId\|null, purpose)` + `verifyWebauthnChallenge(token, purpose)`. Audience-scoped JWT.                                             | 🔜     |
| **K5** | `apps/api/src/modules/auth/mfa/mfa-satisfaction.ts` — `userSatisfiesMfa(user, db)`. Update `email-auth.routes.ts` forced MFA check.                                                       | 🔜     |

#### Fáza 2: Backend endpoints (Slice #8b)

| Blok   | Popis                                                                                                                                                | Status |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **K6** | Registration routes: `/register/options` + `/register/verify`. excludeCredentials. Audit `PASSKEY_REGISTERED`.                                       | 🔜     |
| **K7** | Authentication routes: `/login/options` {email?} + `/login/verify`. Default Membership resolution. Counter warning. Audit events. Issue JWT s `mid`. | 🔜     |
| **K8** | Management routes: `GET /v1/auth/passkeys`, `PATCH /:id` (rename), `DELETE /:id`. Auto-clear `passkeyEnabled`. Audit events.                         | 🔜     |
| **K9** | Rate limiting config per ADR-0016 table.                                                                                                             | 🔜     |

#### Fáza 3: Frontend (Slice #8c)

| Blok    | Popis                                                                                                                                            | Status |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| **K10** | Install `@simplewebauthn/browser@^13`. `apps/web/src/lib/webauthn.ts` (isPasskeysSupported, isConditionalUISupported). Device-name autodetekcia. | 🔜     |
| **K11** | `/login` page — passkey button + discovery flow + conditional UI autofill. Graceful fallback.                                                    | 🔜     |
| **K12** | `/settings/security` — `PasskeysPanel` (list + add + rename + delete). Alternative-auth warning.                                                 | 🔜     |
| **K13** | Error handling: NotAllowedError, NotSupportedError, InvalidStateError, SecurityError → SK messages.                                              | 🔜     |

#### Fáza 4: Tests + docs (Slice #8d)

| Blok    | Popis                                                                                                                 | Status | Model  |
| ------- | --------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| **K14** | `apps/api/tests/fixtures/webauthn.ts` synthetic attestation helpers (~150 LoC). ~22 integration tests. Cieľ: 575/575. | 🔜     | Sonnet |
| **K15** | Milestone doc. NEXT.md update. User guide passkeys. ADR-0014 supersede note.                                          | 🔜     | Haiku  |
| **K16** | Privacy policy update. API reference docs passkey endpoints. OpenAPI regenerácia.                                     | 🔜     | Haiku  |

---

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

## ⏳ Pending (externe / post-launch)

| Úloha                                     | Status                             |
| ----------------------------------------- | ---------------------------------- |
| Legal review compliance dokumentov        | ⏳ externe                         |
| Production smoke test po Slice #9 deploy  | ⏳ manuálne (Ján)                  |
| Atlas allowlist via Vercel Secure Compute | 📅 post-pilot                      |
| Apple Sign-In (K4)                        | 📅 čaká na Apple Developer account |

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
Celkové testy:                553 (cieľ po Slice #8: ~575)
├── Slice #1–#3:              ~310
├── Slice #4–#6b:             ~169
├── Slice #6c:                  21
├── Slice #7 + K12a/b:          29
└── Slice #9:                   28

Test files:   32
Duration:     ~70s
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

| Typ                   | Lokácia                                               |
| --------------------- | ----------------------------------------------------- |
| **Aktuálny stav**     | `docs/sessions/NEXT.md` (TY SI TU)                    |
| **ADR-čka**           | `docs/decisions/0001..0017-*.md`                      |
| **Slice milestones**  | `docs/milestones/slice-*.md`                          |
| **GDPR / compliance** | `docs/compliance/`                                    |
| **Passkeys design**   | `docs/decisions/0016-passkeys-implementation-plan.md` |
| **MCP server design** | `docs/decisions/0017-mcp-server.md`                   |

---

**Last updated:** 2026-05-25 — ADR-0016 + ADR-0017 done. Slice #8 začína.
**Tests:** 553 / 553. **Status:** Launch-ready, legal review externe.
