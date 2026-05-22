<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Posledná aktualizácia** | 2026-05-22 (SFZ migrácia + sub-processors + env vars + marketing app prepojenie + MCP roadmap reframe) |
| **Aktuálna fáza**         | Pre-launch compliance finalization + legal review                                                      |
| **Posledný session log**  | [`2026-05-22-day-summary.md`](2026-05-22-day-summary.md)                                               |

---

## Stav na konci 2026-05-21 (noc)

### ✅ Hotové dnes (2026-05-21)

- **Slice #6c K18** invite flow (K18.1–K18.6) — backend + frontend kompletný
- **Slice #6c K17.5** email service abstraction — plugin pattern, ready for multi-tenant
- **Slice #6c K18.3** OAuth invite accept (Google + Microsoft) — kompletný, 7 nových testov
- **Slice #6c K18.7 + K21** milestone docs — invite feature + Slice #6c story dokumentované
- **Slice #7 TOTP MFA** (K7.1–K7.8) — kompletný, 480/480 testov
- **Compliance Fáza 1** — 5 dokumentov (DPA, 2× ROPA, sub-processors, Threshold Assessment)
- **Backend testy** — 962 (955 + 7 nových K18.3)

### 📊 Globálny stav

| Oblasť                | Status                                                  |
| --------------------- | ------------------------------------------------------- |
| **Slice #6c (auth)**  | ✅ HOTOVÝ — K17.5 + K18.1–K18.6 + K18.3 + docs          |
| **Slice #7 (MFA)**    | ✅ HOTOVÝ — K7.1–K7.8 + docs                            |
| **Compliance Fáza 1** | ✅ HOTOVÁ — 5 dokumentov                                |
| **Frontend pages**    | ✅ 7/7 P0 stránok (Slice #4) + 2 nové (invite/settings) |
| **Production deploy** | ✅ LIVE — inventario.estate + docs                      |
| **Launch ready**      | ⏳ 90% — čaká na legal review                           |

### 🎯 Strategická pozícia

**LTK Solutions, s.r.o. je multi-tenant SaaS poskytovateľ.** Inventario je _product_, otvorený pod EUPL-1.2.

Pred prvým produkčným tenant-om treba:

1. ✅ Compliance dokumenty (Fáza 1) — HOTOVO
2. ✅ Env vars na Vercel prod — HOTOVO 2026-05-22
3. ✅ Sub-processors verejná stránka — HOTOVO 2026-05-22
4. ✅ Marketing site → live app prepojenie — HOTOVO 2026-05-22
5. ⏳ Právny review slovenským advokátom — PENDING

---

## ⏭️ Najbližšie kroky (priorita HIGH)

### 1. Compliance Fáza 1 — ✅ KOMPLETNÁ

| #   | Dokument                                       | Stav               |
| --- | ---------------------------------------------- | ------------------ |
| 1   | **Privacy Policy** (`inventario.estate`)       | ✅ Done 2026-05-21 |
| 2   | **Terms of Service** + AUP + SLA               | ✅ Done 2026-05-21 |
| 3   | **Breach Notification Plan** (čl. 33–34)       | ✅ Done 2026-05-21 |
| 4   | **Disaster Recovery Plan** (RPO ≤24h, RTO ≤8h) | ✅ Done 2026-05-21 |
| 5   | **Threshold Assessment / DPIA Pre-screen**     | ✅ Done 2026-05-21 |

> **Fáza 1 je hotová.** Všetky dokumenty sú v `docs/compliance/` a `docs/compliance/legal/`.

### 2. Pred-launch action items

| #   | Úloha                                                                                   | Vlastník        | Stav                 |
| --- | --------------------------------------------------------------------------------------- | --------------- | -------------------- |
| 1   | Mailboxy `privacy@`, `security@`, `legal@` na `inventario.estate`                       | Ján (technicky) | ✅ Hotové            |
| 2   | **Právny review compliance dokumentov** slovenským GDPR/IT advokátom (~300–500 €)       | Externý advokát | ⏳ PENDING           |
| 3   | Verejná stránka `https://inventario.estate/sub-processors`                              | Dev             | ✅ Hotové 2026-05-22 |
| 4   | **Marketing site CTAs → `app.inventario.estate`** (shared.js, index.html, pricing.html) | Dev             | ✅ Hotové 2026-05-22 |
| 5   | **MCP server reframe** v `technology.html` + `ROADMAP.md` (z Done → v0.7 backlog)       | Dev             | ✅ Hotové 2026-05-22 |

### 3. Technické pred-launch tasks

| #   | Task                                                                                        | Priority | Vlastník   | Stav                 |
| --- | ------------------------------------------------------------------------------------------- | -------- | ---------- | -------------------- |
| 1   | **Env vars na Vercel prod** — `MFA_SECRET_ENCRYPTION_KEY` (32-byte hex) + `ECOMAIL_API_KEY` | HIGH     | Ján        | ✅ Hotové 2026-05-22 |
| 2   | **Sub-processors list publikovať** na `inventario.estate/sub-processors`                    | MEDIUM   | Dev        | ✅ Hotové 2026-05-22 |
| 3   | **Disaster recovery test** — manuálne restore z MongoDB, verify RTO/RPO                     | MEDIUM   | Ján        | ⏳ PENDING           |
| 4   | **Atlas allowlist** — odložené (Vercel serverless = dynamické IP, vyžaduje Secure Compute)  | LOW      | Ján        | ⏳ POST-LAUNCH       |
| 5   | **Penetration testing** (external, before go-live)                                          | LOW      | Externý PT | ⏳ PLANNED           |

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

- ✅ **K18.7** — K18 invite feature milestone doc (`docs/milestones/slice-6c-k18-invitations.md`)
- ✅ **K21** — Slice #6c auth migration story (`docs/milestones/slice-6c.md`)
- ✅ **K18.3** — OAuth invite accept (Google + Microsoft, 7 testov)

### Priorita HIGH (po launchu, na základe spätnej väzby)

- **Forced MFA setup** — ak `org.settings.mfa.policy === 'REQUIRED'`, email-password users musia setup MFA po login-e. ~2 h. Sonnet 4.6.

- **Admin MFA reset** — ADMIN deaktivuje MFA userovi v `/settings/users/:id` (emergency path keď user stratí authenticator). ~1 h. Sonnet 4.6.

### Priorita MEDIUM

- **MCP server (`apps/mcp-server`)** — Marketing site už propaguje (v0.7 / Q1 2027). Bootstrap nového workspace v monorepe: TypeScript + MCP SDK, OpenAPI 3.1 → MCP tools auto-generovanie, tenant-scoped JWT auth, hosting na `mcp.inventario.estate`. Opus 4.7 design (~2 h) + Sonnet 4.6 impl (~1–2 dni).

- **Passkeys / WebAuthn (Slice #8)** — passwordless login (Touch ID, Face ID, Windows Hello). `@simplewebauthn/server` + `@simplewebauthn/browser`. Nová `passkeys` collection. ~2–3 dni. Opus 4.7 design + Sonnet impl.

- **Cross-tenant invites** — refactor User ↔ Organisation na many-to-many (Memberships table). Existujúci user v jednom tenant-e pozvaný do druhého. Opus 4.7 design, Sonnet impl.

- **Email change verification** — separate flow s vlastným tokenom. Pre invitee po accept-e chce zmeniť email. ~2 h. Sonnet 4.6.

- **Per-tenant email provider override** — `Organisation.settings.email.provider`. White-label "From: noreply@tenant.sk". ~2 h. Sonnet 4.6.

- **Per-email invitation exceptions** — `Organisation.settings.invitations.exceptions: string[]`. Povolí konkrétne external emaily mimo whitelistu keď `enforceAllowedDomains=true`. ~1 h. Sonnet 4.6.

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
Celkové testy:               962
├── Slice #6c (K17.5 + K18 + K18.3): 482
│   ├── Email service:              12
│   ├── Invitations (password):     21
│   └── Invitations (OAuth K18.3):   7
├── Slice #7 (TOTP MFA):            480
└── Iné (Slice #1–#5):               0 (čaká na refactor)

Success rate: 100% (0 failov)
Avg runtime:  ~150s
```

---

## 📂 Kde nájdeš čo

| Typ                             | Lokácia                                        |
| ------------------------------- | ---------------------------------------------- |
| **Aktuálny stav**               | `docs/sessions/NEXT.md` (TY STE TU)            |
| **Posledný deň summary**        | `docs/sessions/2026-05-21-day-summary.md`      |
| **Slice milestones**            | `docs/milestones/slice-*.md`                   |
| **Architektonické rozhodnutia** | `docs/decisions/0001..0013-*.md` (13 ADR-čiek) |
| **GDPR / compliance**           | `docs/compliance/` + `docs/compliance/legal/`  |
| **Session logy**                | `docs/sessions/2026-05-*-*.md`                 |

---

## 🚀 Šablóna pre štart ďalšej session

```markdown
## Kde sme?

Otvor `docs/sessions/NEXT.md` (TY STE TU).
Backend testy: 962 / 962 ✓

## Čo je hotovo?

- Slice #6c (K17.5 + K18.1–K18.6 + K18.3 OAuth + K18.7 + K21 docs) ✅
- Slice #7 (TOTP MFA K7.1–K7.8 + docs) ✅
- Compliance Fáza 1 (5 dokumentov) ✅
- Vercel env vars (MFA + Ecomail) + sub-processors page ✅

## Čo je blockujúce pre launch?

1. Právny review compliance dokumentov advokátom (~300–500 €)
2. Disaster recovery test (manuálne, ~30 min)

## Čo príde ďalšie?

Priorita HIGH (post-launch):

- Forced MFA setup (~2h, Sonnet 4.6)
- Admin MFA reset (~1h, Sonnet 4.6)

Priorita MEDIUM:

- Passkeys / WebAuthn (Slice #8, ~2–3 dni, Opus design + Sonnet impl)

Model routing: viď tabuľka vyššie.
```

---

**Last updated:** 2026-05-22 (marketing site → app prepojenie + MCP server reframe z Done na v0.7 roadmap backlog)
**Status:** Slice #6c + #7 kompletné. 962 testov. Sub-processors live. Marketing site prepojený s app.inventario.estate. Launch-ready 90%. Waiting on legal review.
**Next session:** TBD
