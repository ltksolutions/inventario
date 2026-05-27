<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                        |
| ------------------------- | ---------------------------------------------- |
| **Posledná aktualizácia** | 2026-05-27 (Production smoke test + bugfixy)   |
| **Aktuálna fáza**         | Production LIVE — Slice #10 MCP server Q1 2027 |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`  |
| **GitHub**                | https://github.com/ltksolutions/inventario     |

---

## Čo sme spravili 2026-05-27 (production smoke test)

### Bugfixy nasadené do produkcie

| #   | Problém                | Príčina                                                      | Fix                                       |
| --- | ---------------------- | ------------------------------------------------------------ | ----------------------------------------- |
| 1   | 500 pri registrácii    | `customDomain_unique_sparse` — sparse index indexuje aj null | Drop + `partialFilterExpression` na dev   |
| 2   | 500 opakovaný          | Rovnaký problém na **prod** clusteri (`sfz-asset-mgmt-prod`) | Drop v mongosh na prod                    |
| 3   | 500 `entraTenantId`    | Ďalší broken sparse index                                    | Drop v mongosh na prod                    |
| 4   | JWT 500 na reset hesla | Chýbali `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` v Vercel        | Vygenerované RSA kľúče, pridané do Vercel |
| 5   | Login loop             | Chýbal `CORS_ORIGINS` + `NEXT_PUBLIC_API_BASE_URL` v Vercel  | Doplnené env vars                         |
| 6   | AuthGate chýbal        | `settings/members` + `settings/organisations` bez AppShell   | Pridaný `AuthGate` wrapper                |
| 7   | Passkeys 503           | Chýbali `WEBAUTHN_RP_ID/NAME/EXPECTED_ORIGINS` v Vercel      | Pridané env vars                          |
| 8   | Majetok bez tlačidla   | Role-gating hooks čítali z `/v1/me` namiesto `useAuth()`     | Prepísané na `useAuth()`                  |
| 9   | Pridanie majetku       | Chýbal create form + endpoint                                | `AssetCreateContent` + `useCreateAsset`   |

### Migrácie pridané do kódu

- `2026-05-25-fix-org-custom-domain-index.ts` — oprava všetkých broken sparse indexov na organisations kolekcii

### Infraštruktúra

- Repo presunutý z `Slovensky-futbalovy-zvaz/Asset-Management` → `ltksolutions/inventario`
- GitHub Desktop aktualizovaný, Vercel reconnected, starý repo archivovaný
- Lokálny adresár premenovaný na `inventario`
- URL cleanup: `CITATION.cff`, `email.ts`, `package.json`

---

## Stav na 2026-05-27

### 📊 Globálny stav

| Oblasť               | Status                                                     |
| -------------------- | ---------------------------------------------------------- |
| **Backend testy**    | ✅ 569 / 569 (33 test files)                               |
| **Frontend**         | ✅ 9/9 stránok + passkeys + tenant switcher + asset create |
| **Production**       | ✅ LIVE — app.inventario.estate                            |
| **GitHub**           | ✅ github.com/ltksolutions/inventario                      |
| **Vercel**           | ✅ API + Web nasadené a funkčné                            |
| **Registrácia**      | ✅ Funguje                                                 |
| **Login**            | ✅ Funguje                                                 |
| **Pridanie majetku** | ✅ Funguje                                                 |
| **Legal review**     | ⏳ PENDING (externe)                                       |
| **Ecomail**          | ⚠️ Treba nakonfigurovať (verifikačné emaily nefungujú)     |
| **Slice #10 MCP**    | 📅 Q1 2027 — design hotový (ADR-0017)                      |

---

## ⏭️ Najbližšie kroky

### 🔥 Priorita HIGH

| Úloha                                                            | Status           |
| ---------------------------------------------------------------- | ---------------- |
| **Ecomail konfigurácia** — verifikačné emaily, reset hesla       | ⚠️ TODO          |
| **Manuálny emailVerified fix** pre existujúcich userov (mongosh) | ⚠️ TODO ak treba |
| Legal review compliance dokumentov                               | ⏳ externe       |
| Atlas allowlist → Vercel Secure Compute                          | 📅 post-pilot    |

### ⚠️ Ecomail setup (priorita pred prvým tenantom)

V Vercel → inventario-api → Environment Variables nastav:

```
EMAIL_PROVIDER = ecomail
ECOMAIL_API_KEY = <tvoj API kľúč z Ecomail dashboardu>
EMAIL_FROM_ADDRESS = noreply@inventario.estate
EMAIL_FROM_NAME = Inventario
```

### 📅 Slice #10 — MCP server (~10 dní, Q1 2027, Sonnet 4.6)

Design: [ADR-0017](../decisions/0017-mcp-server.md)

#### Fáza 1: Backend foundation (Slice #10a)

| Blok   | Popis                                                                             |
| ------ | --------------------------------------------------------------------------------- |
| **K1** | shared-types: `mcp-access-token.ts`. Audit log enum. entityType `McpAccessToken`. |
| **K2** | `mcp-tokens.repository.ts` — CRUD + findByHash. Indexy.                           |
| **K3** | `mcp-tokens.routes.ts` — POST/GET/PATCH/DELETE. Tests.                            |
| **K4** | Cleanup job pre expired tokens — Vercel Cron.                                     |

#### Fáza 2: MCP server scaffold (Slice #10b)

| Blok    | Popis                                                                    |
| ------- | ------------------------------------------------------------------------ |
| **K5**  | `apps/mcp-server` new package. Install `@modelcontextprotocol/sdk@^1.x`. |
| **K6**  | `auth/token-resolver.ts` — Bearer → (userId, membership, JWT).           |
| **K7**  | `auth/jwt-issuer.ts` — 5min short-lived JWT.                             |
| **K8**  | `clients/inventario-api.ts` — openapi-fetch factory.                     |
| **K9**  | `server.ts` — MCP SDK setup. Vercel handler.                             |
| **K10** | `lib/rate-limit.ts` — Vercel KV-backed counter.                          |

#### Fáza 3–5: Tools + Frontend + Tests

| Blok        | Popis                                        |
| ----------- | -------------------------------------------- |
| **K11–K16** | Read + Write tools (17 nástrojov), audit log |
| **K17–K18** | `/settings/integrations` page                |
| **K19–K23** | Tests + docs + Vercel deployment             |

---

## 📅 Compliance Fáza 2 (po prvom tenant launchom)

| Dokument                      | Model      | Odhad |
| ----------------------------- | ---------- | ----- |
| DPIA Template                 | Opus 4.7   | ~3h   |
| Security & Privacy Whitepaper | Opus 4.7   | ~4h   |
| Data Retention Schedule       | Sonnet 4.6 | ~2h   |
| Information Security Policy   | Sonnet 4.6 | ~2h   |

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

| Typ                   | Lokácia                                               |
| --------------------- | ----------------------------------------------------- |
| **Aktuálny stav**     | `docs/sessions/NEXT.md` (TY SI TU)                    |
| **ADR-čka**           | `docs/decisions/0001..0017-*.md`                      |
| **Slice milestones**  | `docs/milestones/slice-*.md`                          |
| **Passkeys design**   | `docs/decisions/0016-passkeys-implementation-plan.md` |
| **MCP server design** | `docs/decisions/0017-mcp-server.md`                   |

---

**Last updated:** 2026-05-27  
**Tests:** 569 / 569 ✅  
**Repo:** github.com/ltksolutions/inventario  
**Status:** Production LIVE ✅ — Ecomail pending, legal review externe, Slice #10 Q1 2027.
