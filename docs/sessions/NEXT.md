<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-05-23 (K12a Forced MFA + K12b Admin MFA reset — 511 testov) |
| **Aktuálna fáza**         | Pre-launch compliance finalization + legal review                |
| **Posledný session log**  | [`2026-05-23-day-summary.md`](2026-05-23-day-summary.md)         |

---

## Stav na konci 2026-05-23

### ✅ Hotové dnes (2026-05-23)

- **ROADMAP.md** — K10 + K11 opravené ako done (boli hotové od 2026-05-16, zabudnuté checkboxy)
- **K12a Forced MFA setup** — `org.settings.mfa.requireMfa`, `issueMfaSetupToken` (15 min TTL), `/v1/auth/mfa/forced-setup` + `/v1/auth/mfa/forced-verify`, login gate v email-auth.routes.ts
- **K12b Admin MFA reset** — `DELETE /v1/users/:id/mfa` (ADMIN only), `clearMfa()` repo, `resetMfa()` service, audit `USER_MFA_RESET_BY_ADMIN` (WARNING)
- **shared-types** — pridaná audit akcia `USER_MFA_RESET_BY_ADMIN`
- **Backend testy** — 511/511 ✅ (31 test files, ~38s)

### 📊 Globálny stav

| Oblasť                   | Status                                                            |
| ------------------------ | ----------------------------------------------------------------- |
| **Slice #6c (auth)**     | ✅ HOTOVÝ — K17.5 + K18.1–K18.6 + K18.3 + docs                    |
| **Slice #7 (MFA)**       | ✅ HOTOVÝ — K7.1–K7.8 + docs                                      |
| **K12a Forced MFA**      | ✅ HOTOVÝ — login gate + forced-setup + forced-verify + 12 testov |
| **K12b Admin MFA reset** | ✅ HOTOVÝ — DELETE endpoint + audit + 9 testov                    |
| **Compliance Fáza 1**    | ✅ HOTOVÁ — 5 dokumentov                                          |
| **Frontend pages**       | ✅ 7/7 P0 stránok (Slice #4) + 2 nové (invite/settings)           |
| **Production deploy**    | ✅ LIVE — inventario.estate + docs                                |
| **Backend testy**        | ✅ 511/511 (31 test files)                                        |
| **Launch ready**         | ⏳ 95% — čaká na legal review (beží externe)                      |

### 🎯 Strategická pozícia

**LTK Solutions, s.r.o. je multi-tenant SaaS poskytovateľ.** Inventario je _product_, otvorený pod EUPL-1.2.

Pred prvým produkčným tenant-om treba:

1. ✅ Compliance dokumenty (Fáza 1) — HOTOVO
2. ✅ Env vars na Vercel prod — HOTOVO 2026-05-22
3. ✅ Sub-processors verejná stránka — HOTOVO 2026-05-22
4. ✅ Marketing site → live app prepojenie — HOTOVO 2026-05-22
5. ✅ Forced MFA + Admin MFA reset — HOTOVO 2026-05-23
6. ⏳ Právny review slovenským advokátom — PENDING (beží externe)

---

## ⏭️ Najbližšie kroky

### 1. Compliance Fáza 1 — ✅ KOMPLETNÁ

| #   | Dokument                                       | Stav               |
| --- | ---------------------------------------------- | ------------------ |
| 1   | **Privacy Policy** (`inventario.estate`)       | ✅ Done 2026-05-21 |
| 2   | **Terms of Service** + AUP + SLA               | ✅ Done 2026-05-21 |
| 3   | **Breach Notification Plan** (čl. 33–34)       | ✅ Done 2026-05-21 |
| 4   | **Disaster Recovery Plan** (RPO ≤24h, RTO ≤8h) | ✅ Done 2026-05-21 |
| 5   | **Threshold Assessment / DPIA Pre-screen**     | ✅ Done 2026-05-21 |

### 2. Pred-launch action items

| #   | Úloha                                                                                   | Vlastník        | Stav                 |
| --- | --------------------------------------------------------------------------------------- | --------------- | -------------------- |
| 1   | Mailboxy `privacy@`, `security@`, `legal@` na `inventario.estate`                       | Ján (technicky) | ✅ Hotové            |
| 2   | **Právny review compliance dokumentov** slovenským GDPR/IT advokátom (~300–500 €)       | Externý advokát | ⏳ PENDING (beží)    |
| 3   | Verejná stránka `https://inventario.estate/sub-processors`                              | Dev             | ✅ Hotové 2026-05-22 |
| 4   | **Marketing site CTAs → `app.inventario.estate`** (shared.js, index.html, pricing.html) | Dev             | ✅ Hotové 2026-05-22 |
| 5   | **MCP server reframe** v `technology.html` + `ROADMAP.md`                               | Dev             | ✅ Hotové 2026-05-22 |
| 6   | **Forced MFA + Admin MFA reset** (K12a + K12b)                                          | Dev             | ✅ Hotové 2026-05-23 |

### 3. Technické pred-launch tasks

| #   | Task                                                                                       | Priority | Vlastník   | Stav                 |
| --- | ------------------------------------------------------------------------------------------ | -------- | ---------- | -------------------- |
| 1   | **Env vars na Vercel prod** — `MFA_SECRET_ENCRYPTION_KEY` + `ECOMAIL_API_KEY`              | HIGH     | Ján        | ✅ Hotové 2026-05-22 |
| 2   | **Sub-processors list publikovať** na `inventario.estate/sub-processors`                   | MEDIUM   | Dev        | ✅ Hotové 2026-05-22 |
| 3   | **Disaster recovery test** — manuálne restore z MongoDB, verify RTO/RPO                    | MEDIUM   | Ján        | ⏳ PENDING           |
| 4   | **Atlas allowlist** — odložené (Vercel serverless = dynamické IP, vyžaduje Secure Compute) | LOW      | Ján        | ⏳ POST-LAUNCH       |
| 5   | **Penetration testing** (external, before go-live)                                         | LOW      | Externý PT | ⏳ PLANNED           |

---

## ⏳ Compliance Fáza 2 (po prvom tenant launchom)

Naplánovať na Q3 2026.

| #   | Dokument                                                       | Model      | Trvanie |
| --- | -------------------------------------------------------------- | ---------- | ------- |
| 1   | **DPIA Template** pre tenant-ov (`legal/dpia-template.md`)     | Opus 4.7   | ~3 h    |
| 2   | **Security & Privacy Whitepaper** (verejný PDF, sales enabler) | Opus 4.7   | ~4 h    |
| 3   | **Data Retention Schedule** (per-category detaily)             | Sonnet 4.6 | ~2 h    |
| 4   | **Information Security Policy** (interný)                      | Sonnet 4.6 | ~2 h    |

---

## 📅 Roadmap feature work (po launchu)

### ✅ Hotové

- ✅ **K18.7** — K18 invite feature milestone doc
- ✅ **K21** — Slice #6c auth migration story
- ✅ **K18.3** — OAuth invite accept (Google + Microsoft, 7 testov)
- ✅ **K12a** — Forced MFA setup (2026-05-23)
- ✅ **K12b** — Admin MFA reset (2026-05-23)

### Priorita MEDIUM

- **MCP server (`apps/mcp-server`)** — v0.7 / Q1 2027. Bootstrap nového workspace: TypeScript + MCP SDK, OpenAPI 3.1 → MCP tools, tenant-scoped JWT auth, `mcp.inventario.estate`. Opus 4.7 design (~2 h) + Sonnet 4.6 impl (~1–2 dni).

- **Passkeys / WebAuthn (Slice #8)** — passwordless login (Touch ID, Face ID, Windows Hello). `@simplewebauthn/server` + `@simplewebauthn/browser`. Nová `passkeys` collection. ~2–3 dni. Opus 4.7 design + Sonnet impl.

- **Cross-tenant invites** — refactor User ↔ Organisation na many-to-many (Memberships table). Opus 4.7 design, Sonnet impl.

- **Email change verification** — separate flow s vlastným tokenom. ~2 h. Sonnet 4.6.

- **Per-tenant email provider override** — `Organisation.settings.email.provider`. ~2 h. Sonnet 4.6.

- **Per-email invitation exceptions** — `Organisation.settings.invitations.exceptions: string[]`. ~1 h. Sonnet 4.6.

- **Resend invitation endpoint** — `POST /v1/invitations/:id/resend`. ~1 h. Sonnet 4.6.

- **Apple Sign-In (K4)** — čaká na Apple Developer account. ~2 h keď bude ready. Sonnet 4.6.

### Priorita LOW (budúcnosť)

- **SOC 2 Type II** — pri prvom enterprise tenant-ovi
- **ISO/IEC 27001** — pri verejnom obstarávaní
- **Trust Center stránka** — po 5+ tenant-och
- **DPO designation** — pri raste tímu

---

## 🧭 Model routing

| Task typ                                                   | Model      | Notes                             |
| ---------------------------------------------------------- | ---------- | --------------------------------- |
| Strategické rozhodnutia, ADR, DPIA, compliance (TOS, DPIA) | Opus 4.7   | —                                 |
| CRUD endpoints, tests, frontend pages, debug, scoped docs  | Sonnet 4.6 | Standard implementation work      |
| Milestone docs, mechanické edits, cleanupy, scoped docs    | Haiku 4.5  | Structure + content already known |

> **Pri začiatku každej session:** Claude zhodnotí či model pasuje a upozorní pri nesúlade.

---

## 🏗️ Backend status (testy)

```
Celkové testy:                511
├── Slice #1–#3 (backend CRUD + categories + locations + users): ~310
├── Slice #4–#6b (frontend auth, loans, invitations):            ~169
├── Slice #6c (K17.5 + K18 + K18.3):                              21
├── Slice #7 (TOTP MFA):                                           ~9
└── K12a + K12b (Forced MFA + Admin reset):                        20
    ├── mfa-forced-setup.test.ts:                                   12
    └── users-mfa-reset.test.ts:                                     9

Test files:   31
Success rate: 100% (0 failov)
Duration:     ~38s
```

---

## 📂 Kde nájdeš čo

| Typ                             | Lokácia                                        |
| ------------------------------- | ---------------------------------------------- |
| **Aktuálny stav**               | `docs/sessions/NEXT.md` (TY SI TU)             |
| **Posledný deň summary**        | `docs/sessions/2026-05-23-day-summary.md`      |
| **Slice milestones**            | `docs/milestones/slice-*.md`                   |
| **Architektonické rozhodnutia** | `docs/decisions/0001..0013-*.md` (13 ADR-čiek) |
| **GDPR / compliance**           | `docs/compliance/` + `docs/compliance/legal/`  |
| **Session logy**                | `docs/sessions/2026-05-*-*.md`                 |

---

## 🚀 Šablóna pre štart ďalšej session

```markdown
## Kde sme?

Otvor `docs/sessions/NEXT.md` (TY SI TU).
Backend testy: 511/511 ✓ (31 test files)

## Čo je hotovo?

- Slice #6c (K17.5 + K18.1–K18.6 + K18.3 OAuth + K18.7 + K21 docs) ✅
- Slice #7 (TOTP MFA K7.1–K7.8 + docs) ✅
- K12a Forced MFA setup (login gate + forced-setup + forced-verify) ✅
- K12b Admin MFA reset (DELETE /v1/users/:id/mfa + audit) ✅
- Compliance Fáza 1 (5 dokumentov) ✅
- Vercel env vars + sub-processors page ✅
- Marketing site prepojený s app.inventario.estate ✅

## Čo je blockujúce pre launch?

1. Právny review compliance dokumentov advokátom (beží externe)
2. Disaster recovery test (manuálne, ~30 min)

## Čo príde ďalšie?

Priorita MEDIUM (post-launch):

- Passkeys / WebAuthn (Slice #8, ~2–3 dni, Opus design + Sonnet impl)
- MCP server (v0.7 / Q1 2027, Opus design + Sonnet impl)

Model routing: viď tabuľka vyššie.
```

---

**Last updated:** 2026-05-23 (K12a Forced MFA setup + K12b Admin MFA reset — 511/511 testov)
**Status:** Slice #6c + #7 + K12a + K12b kompletné. 511 testov. Marketing site prepojený s app.inventario.estate. Launch-ready 95%. Legal review beží externe.
**Next session:** TBD
