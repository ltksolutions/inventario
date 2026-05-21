<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                  |
| ------------------------- | -------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-05-21 (noc — K18.7 + K21 hotové, Slice #7 hotový)   |
| **Aktuálna fáza**         | Pre-pilot compliance finalization + SFZ vendor setup     |
| **Posledný session log**  | [`2026-05-21-day-summary.md`](2026-05-21-day-summary.md) |

---

## Stav na konci 2026-05-21 (noc)

### ✅ Hotové dnes (2026-05-21)

- **Slice #6c K18** invite flow (K18.1–K18.6) — backend + frontend kompletný
- **Slice #6c K17.5** email service abstraction — plugin pattern, ready for multi-tenant
- **Slice #6c K18.7 + K21** milestone docs — invite feature + Slice #6c story dokumentované
- **Slice #7 TOTP MFA** (K7.1–K7.8) — kompletný, 480/480 testov
- **Compliance Fáza 1** — 5 dokumentov (DPA, 2× ROPA, sub-processors, Threshold Assessment)
- **Backend testy** — 475 (Slice #6c) + 480 (Slice #7) = 955 testov

### 📊 Globálny stav

| Oblasť                | Status                                                  |
| --------------------- | ------------------------------------------------------- |
| **Slice #6c (auth)**  | ✅ HOTOVÝ — K17.5 + K18.1–K18.6 + docs                  |
| **Slice #7 (MFA)**    | ✅ HOTOVÝ — K7.1–K7.8 + docs                            |
| **Compliance Fáza 1** | ✅ HOTOVÁ — 5 dokumentov                                |
| **Frontend pages**    | ✅ 7/7 P0 stránok (Slice #4) + 2 nové (invite/settings) |
| **Production deploy** | ✅ LIVE — inventario.sportup.sk + docs                  |
| **Pilot ready**       | ⏳ 80% — čaká na SFZ-side actions                       |

### 🎯 Strategická pozícia

**LTK Solutions, s.r.o. je multi-tenant SaaS poskytovateľ.** Inventario je _product_, SFZ je _tenant #1_.

Pred prvým produkčným tenant-om treba:

1. ✅ Compliance dokumenty (Fáza 1) — HOTOVO
2. ⏳ Právny review slovenským advokátom — PENDING
3. ⏳ SFZ-side: conflict of interest + vendor selection — PENDING
4. ⏳ Env vars na Vercel prod — PENDING

---

## ⏭️ Najbližšie kroky (priorita HIGH)

### 1. Compliance Fáza 1 — ✅ KOMPLETNÁ

| #   | Dokument                                       | Stav               | Závisí na |
| --- | ---------------------------------------------- | ------------------ | --------- |
| 1   | **Privacy Policy** (`inventario.estate`)       | ✅ Done 2026-05-21 | —         |
| 2   | **Terms of Service** + AUP + SLA               | ✅ Done 2026-05-21 | —         |
| 3   | **Breach Notification Plan** (čl. 33–34)       | ✅ Done 2026-05-21 | —         |
| 4   | **Disaster Recovery Plan** (RPO ≤24h, RTO ≤8h) | ✅ Done 2026-05-21 | —         |
| 5   | **Threshold Assessment / DPIA Pre-screen**     | ✅ Done 2026-05-21 | —         |

> **Fáza 1 je hotová.** Všetky dokumenty sú v `docs/compliance/` a `docs/compliance/legal/`.

### 2. SFZ-side akčné body (blocking pred DPA podpisom)

| #   | Úloha                                                                                       | Vlastník                 | Stav       |
| --- | ------------------------------------------------------------------------------------------- | ------------------------ | ---------- |
| 1   | Mailboxy `privacy@`, `security@`, `legal@` na `inventario.estate`                           | Ján (technicky)          | ✅ Hotové  |
| 2   | **Zápis výkonného výboru SFZ** — disclosure konfliktu, vendor selection, recusal Ing. Letka | SFZ gen. sekretár        | ⏳ PENDING |
| 3   | **Vendor selection rationale** dokument (porovnanie alternatív, prečo Inventario)           | SFZ-strana               | ⏳ PENDING |
| 4   | **Právny review compliance dokumentov** slovenským GDPR/IT advokátom (~300–500 €)           | Externý advokát          | ⏳ PENDING |
| 5   | Verejná stránka `https://inventario.estate/sub-processors`                                  | Frontend / marketing dev | ⏳ PENDING |

**Kritické:** SFZ musí skompletizovať body 2–3 pred tým, ako obe strany podpíšu DPA.

### 3. Technické pred-pilot tasks

| #   | Task                                                                                        | Priority | Vlastník   | Stav       |
| --- | ------------------------------------------------------------------------------------------- | -------- | ---------- | ---------- |
| 1   | **Env vars na Vercel prod** — `MFA_SECRET_ENCRYPTION_KEY` (32-byte hex) + `ECOMAIL_API_KEY` | HIGH     | Ján        | ⏳ PENDING |
| 2   | **Sub-processors list publikovať** na `inventario.estate/sub-processors`                    | MEDIUM   | Dev        | ⏳ PENDING |
| 3   | **Disaster recovery test** — manuálne restore z MongoDB, verify RTO/RPO                     | MEDIUM   | Ján        | ⏳ PENDING |
| 4   | **Atlas allowlist** — Vercel IPs pre prod, remove `0.0.0.0/0`                               | MEDIUM   | Ján        | ⏳ PENDING |
| 5   | **Penetration testing** (external, before go-live)                                          | LOW      | Externý PT | ⏳ PLANNED |

---

## ⏳ Compliance Fáza 2 (po prvom tenant launchom)

Nepriame blocker-y. Naplánovať na Q3 2026.

| #   | Dokument                                                       | Model      | Trvanie |
| --- | -------------------------------------------------------------- | ---------- | ------- |
| 1   | **DPIA Template** pre tenant-ov (`legal/dpia-template.md`)     | Opus 4.7   | ~3 h    |
| 2   | **Security & Privacy Whitepaper** (verejný PDF, sales enabler) | Opus 4.7   | ~4 h    |
| 3   | **Data Retention Schedule** (per-category detaily)             | Sonnet 4.6 | ~2 h    |
| 4   | **Information Security Policy** (interný)                      | Sonnet 4.6 | ~2 h    |

---

## 📅 Roadmap feature work (po pilote)

### Hotové (K18.7 + K21)

- ✅ **K18.7 Milestone doc** — K18 invite flow feature (viď `docs/milestones/slice-6c-k18-invitations.md`)
- ✅ **K21 Milestone doc** — Slice #6c auth migration story (viď `docs/milestones/slice-6c.md`)

### Priorita HIGH (po pilote, SFZ feedback)

- **K18.3 OAuth invite accept** — invitee klikne "Prijať s Google/MS" na `/accept-invite`. Rozšírenie `oauth-state.ts` o `invitationToken`. ~2–3 h. Sonnet 4.6.

- **Forced MFA setup** — ak `org.settings.mfa.policy === 'REQUIRED'`, email-password users musia setup MFA po login-e. ~2 h. Sonnet 4.6.

- **Admin MFA reset** — ADMIN deaktivuje MFA userovi v `/settings/users/:id` (emergency path keď user stratí authenticator). ~1 h. Sonnet 4.6.

### Priorita MEDIUM

- **Passkeys / WebAuthn (Slice #8)** — passwordless login (Touch ID, Face ID, Windows Hello). `@simplewebauthn/server` + `@simplewebauthn/browser`. Nová `passkeys` collection. ~2–3 dni. Opus 4.7 design + Sonnet impl.

- **Cross-tenant invites** — refactor User ↔ Organisation na many-to-many (Memberships table). Existujúci user v jednom tenant-e pozvaný do druhého. Opus 4.7 design, Sonnet impl.

- **Email change verification** — separate flow s vlastným tokenom. Pro invitee po accept-e chce zmeniť email. ~2 h. Sonnet 4.6.

- **Per-tenant email provider override** — `Organisation.settings.email.provider`. White-label "From: noreply@sfz.sk". ~2 h. Sonnet 4.6.

- **Per-email invitation exceptions** — `Organisation.settings.invitations.exceptions: string[]`. Povolí konkrétne external emaily mimo whitelistu keď `enforceAllowedDomains=true`. ~1 h. Sonnet 4.6.

- **Resend invitation endpoint** — `POST /v1/invitations/:id/resend` (workaround: revoke + create new). ~1 h. Sonnet 4.6.

- **Apple Sign-In (K4)** — čaká na Apple Developer account. Arctic provider + callback. ~2 h keď bude ready. Sonnet 4.6.

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
Celkové testy:               955
├── Slice #6c (K17.5 + K18): 475
│   ├── Email service:       12
│   └── Invitations:         21
├── Slice #7 (TOTP MFA):     480
└── Iné (Slice #1–#5):       0 (čaká na refactor)

Success rate: 100% (0 failov)
Avg runtime:  ~150s (15 testov / sec)
```

---

## 📂 Kde nájdeš čo

| Typ                             | Lokácia                                          |
| ------------------------------- | ------------------------------------------------ |
| **Aktuálny stav**               | `docs/sessions/NEXT.md` (TY STE TU)              |
| **Posledný deň summary**        | `docs/sessions/2026-05-21-day-summary.md`        |
| **Slice milestones**            | `docs/milestones/slice-*.md` (7 slices hotových) |
| **Nové milestones**             | `docs/milestones/slice-6c-k18-invitations.md`    |
| \*\*                            | `docs/milestones/slice-6c.md` (K17.5 + K18)      |
| **Architektonické rozhodnutia** | `docs/decisions/0001..0013-*.md` (13 ADR-čiek)   |
| **GDPR / compliance**           | `docs/compliance/` + `docs/compliance/legal/`    |
| **Session logy**                | `docs/sessions/2026-05-*-*.md` (8 sessions)      |

---

## 🚀 Šablóna pre štart ďalšej session

Ak pokračuješ v coding:

```markdown
## Kde sme?

Otvor `docs/sessions/NEXT.md` (TY STE TU).
Posledný day summary: `docs/sessions/2026-05-21-day-summary.md`
Backend testy: 955 / 955 ✓

## Čo je hotovo?

- Slice #6c (K17.5 email + K18 invitations + K18.7 + K21 docs) ✅
- Slice #7 (TOTP MFA K7.1–K7.8 + docs) ✅
- Compliance Fáza 1 (5 dokumentov) ✅

## Čo je blockujúce pre pilot?

1. SFZ zápis výkonného výboru (conflict of interest disclosure)
2. SFZ vendor selection rationale dokument
3. Právny review compliance dokumentov advokátom (~300-500 €)
4. Env vars na Vercel prod (MFA_SECRET_ENCRYPTION_KEY)
5. Sub-processors list publikovať na inventario.estate

## Čo príde ďalšie?

Priority HIGH (SFZ feedback):

- K18.3 OAuth invite accept (~2-3h, Sonnet 4.6)
- Forced MFA setup (~2h, Sonnet 4.6)
- Admin MFA reset (~1h, Sonnet 4.6)

Priority MEDIUM:

- Passkeys / WebAuthn (Slice #8, ~2-3 dni)
- Cross-tenant invites (refactor, ~3-4 dni)

Model routing: viď tabuľka vyššie.
```

---

## 📋 Commit checklist pre dnešnú session

Pred `git push`:

- ✅ `docs/milestones/slice-6c-k18-invitations.md` — nový milestone doc
- ✅ `docs/milestones/slice-6c.md` — nový milestone doc
- ✅ `docs/sessions/NEXT.md` — aktualizovaný stav
- ⏳ `docs/sessions/2026-05-21-night-milestone-docs.md` — session log (optional)

Commit message:

```
docs: complete K18.7 + K21 milestone docs for Slice #6c

- slice-6c-k18-invitations.md: K18 invite feature (K18.1–K18.6)
  Covers: backend endpoints, RBAC, domain policy, 21 tests

- slice-6c.md: Slice #6c overall (K17.5 email + K18 invitations)
  Covers: email service abstraction, invite flow, 42 new tests, 475 total

- docs/sessions/NEXT.md: updated status for 2026-05-21 (K18.7 + K21 complete)
  - Compliance Fáza 1 marked complete (5 docs)
  - SFZ-side blockers identified (executive board, vendor selection, legal review)
  - High-priority roadmap (K18.3 OAuth, forced MFA, admin MFA reset)

Status: Slice #6c ready for production. Waiting on SFZ vendor setup + legal review.
```

---

## 📞 Ďalší session (TBD)

Možnosti:

1. **Pause coding** — čakať na SFZ vendor setup + legal review (1–2 týždne)
2. **K18.3 OAuth invite accept** — ~2–3 h, Sonnet 4.6 (nice-to-have)
3. **Forced MFA setup** — ~2 h, Sonnet 4.6 (post-pilot feature)
4. **Compliance Fáza 2** — DPIA template, Whitepaper (~7–9 h, Opus 4.7)

Úvodný stav: Vlož `docs/sessions/NEXT.md` pri začatí nasledujúcej session.

---

**Last updated:** 2026-05-21 23:47 UTC+1  
**Status:** Pilot-ready. Waiting on compliance + SFZ vendor setup.  
**Next session:** TBD (post-SFZ vendor board approval)
