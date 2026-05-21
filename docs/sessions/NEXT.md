<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                  |
| ------------------------- | -------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-05-21 (noc — po Threshold Assessment)               |
| **Aktuálna fáza**         | Pre-pilot compliance preparation                         |
| **Posledný session log**  | [`2026-05-21-day-summary.md`](2026-05-21-day-summary.md) |

---

## Stav na konci dňa 2026-05-21

### ✅ Hotové 2026-05-21

- **Slice #6c K18** invite flow (backend + frontend) — kompletný
- **Slice #7 TOTP MFA** — kompletný, 480/480 testov
- **6 compliance dokumentov** vyrobených (DPA Template, 2× ROPA, sub-processors, Compliance README, Threshold Assessment / DPIA Pre-screen)
- **Strategický pivot ujasnený** — Inventario je komerčný produkt LTK Solutions, SFZ je tenant #1

### 🎯 Stratégia jasná

**LTK Solutions, s.r.o. je multi-tenant SaaS poskytovateľ.** Pred prvým produkčným tenant-om treba:

1. Dokončiť compliance balík (Fáza 1)
2. Získať právny review slovenským GDPR/IT advokátom
3. Aktivovať mailboxy + publikovať sub-processors list
4. SFZ-side: conflict-of-interest disclosure + vendor selection rationale

---

## ⏭️ Najbližšie kroky (priorita HIGH)

### 1. Compliance Fáza 1 — dokončenie (~9 h zostáva)

| #   | Dokument                                                           | Model      | Trvanie | Stav               |
| --- | ------------------------------------------------------------------ | ---------- | ------- | ------------------ |
| 1   | **Privacy Policy** pre `inventario.estate` (verejná stránka)       | Sonnet 4.6 | ~3 h    | ⏳ Pending         |
| 2   | **Terms of Service** LTK ↔ tenant                                  | Opus 4.7   | ~4 h    | ⏳ Pending         |
| 3   | **Breach Notification Plan** (interný, čl. 33–34)                  | Sonnet 4.6 | ~1 h    | ⏳ Pending         |
| 4   | **Disaster Recovery Plan** (kontinuita prevádzky)                  | Sonnet 4.6 | ~1 h    | ⏳ Pending         |
| 5   | **Threshold Assessment / DPIA Pre-screen** pre Inventario platform | Opus 4.7   | ~2 h    | ✅ Done 2026-05-21 |

> Privacy Policy je najpraktickejšia — môžeš ju potrebovať na webe skôr ako čokoľvek iné. Po Threshold Assessmente je logický ďalší krok buď Privacy Policy (Sonnet) alebo ToS (Opus, ak ostaneš v tejto session).

### 2. SFZ-side akčné body (pred podpisom DPA)

| #   | Úloha                                                                                   | Vlastník                      |
| --- | --------------------------------------------------------------------------------------- | ----------------------------- |
| 1   | Vytvoriť mailboxy `privacy@`, `security@`, `legal@` na inventario.estate (catch-all OK) | Ján (technicky, doménový kôš) |
| 2   | Zápis výkonného výboru SFZ — disclosure konfliktu, vendor selection, recusal Ing. Letka | SFZ-strana (gen. sekretár)    |
| 3   | Vendor selection rationale dokument (porovnanie alternatív, prečo Inventario)           | SFZ-strana                    |
| 4   | **Právny review compliance dokumentov** slovenským GDPR/IT advokátom (~300–500 €)       | Externý advokát               |
| 5   | Pripraviť verejnú stránku `https://inventario.estate/sub-processors`                    | Marketing site / dev          |

### 3. Technické pred-pilot úlohy

- **Env vars na Vercel prod** — `MFA_SECRET_ENCRYPTION_KEY` (32-byte hex), `ECOMAIL_API_KEY`, ostatné z `.env.example`
- **Disaster recovery test** — manuálne restore z MongoDB backup, dokumentovať RTO/RPO
- **Penetration testing** — prvý test pred go-live (planned)
- **Atlas allowlist konfigurácia** — Vercel IPs pre prod, žiadne 0.0.0.0/0

---

## ⏳ Compliance Fáza 2 (po prvom tenant launchom)

| #   | Dokument                                                       | Model      | Trvanie |
| --- | -------------------------------------------------------------- | ---------- | ------- |
| 1   | **DPIA Template** pre tenant-ov (`legal/dpia-template.md`)     | Opus 4.7   | ~3 h    |
| 2   | **Security & Privacy Whitepaper** (verejný PDF, sales enabler) | Opus 4.7   | ~4 h    |
| 3   | **Data Retention Schedule** (detailný per-category dokument)   | Sonnet 4.6 | ~2 h    |
| 4   | **Information Security Policy** (interný)                      | Sonnet 4.6 | ~2 h    |

---

## 📅 Roadmap odložených feature prác

### Priorita HIGH (po pilote alebo na požiadanie)

- **K18.3 OAuth invite accept** — invitee klikne "Prijať s Google/MS" na `/accept-invite`. Rozšírenie `oauth-state.ts` o `invitationToken` + úprava OAuth callback handleru. ~2–3 h. Sonnet 4.6.

- **K18.7 + K21 Milestone docs** — K18 invite flow milestone + Slice #6c celkový milestone (auth migration story #6a → #6c). Haiku 4.5, ~30 min.

### Priorita MEDIUM

- **Passkeys / WebAuthn (Slice #8)** — passwordless login (Touch ID, Face ID, Windows Hello). `@simplewebauthn/server` + `@simplewebauthn/browser`. Nová `passkeys` collection. Registration + authentication ceremony. ~2–3 dni. Opus 4.7 pre architektonický návrh, Sonnet pre implementáciu.

- **MFA REQUIRED policy enforcement** — ak `org.settings.mfa.policy === 'REQUIRED'` a user nemá MFA, forced setup po úspešnom logine. ~2 h. Sonnet 4.6.

- **Admin MFA reset** — ADMIN deaktivuje MFA konkrétnemu userovi cez `/settings/users/:id`. Emergency path keď user stratí authenticator + recovery codes. ~1 h. Sonnet 4.6.

- **Cross-tenant invites** — User ↔ Organisation many-to-many refactor (Memberships table). Existujúci user v inom tenant-e pozvaný do druhého. Vlastný slice, Opus 4.7 pre design.

- **Email change v user profile** — separate verification flow s vlastným tokenom. Pre invitee ktorý chce zmeniť email po accepte.

- **Per-tenant email provider override** — `Organisation.settings.email.provider`. Pridá sa keď prvý tenant bude chcieť white-label "From: noreply@sfz.sk".

- **Apple Sign-In (K4)** — čaká na Apple Developer account. ~2 h keď bude pripravený (arctic provider + callback handler).

- **Per-email exception list** pre invitation domain policy — `Organisation.settings.invitations.exceptions: string[]`. Umožní pozvať konkrétne emaily mimo whitelistu bez vypnutia `enforceAllowedDomains`.

### Priorita LOW (budúcnosť)

- **SOC 2 Type II** roadmap — pri prvom enterprise zákazníkovi
- **ISO/IEC 27001** roadmap — pri verejnom obstarávaní s touto požiadavkou
- **Trust Center stránka** — po 5+ tenant-och
- **DPO designation** — pri raste tímu / scope nad threshold

---

## 🧭 Model routing

| Task                                                                 | Model      |
| -------------------------------------------------------------------- | ---------- |
| Strategické rozhodnutia, ADR, DPIA, compliance docs (TOS, Threshold) | Opus 4.7   |
| CRUD endpoints, tests, frontend pages, debug, scoped Privacy Policy  | Sonnet 4.6 |
| Milestone docs, mechanické cleanupy, scoped edits                    | Haiku 4.5  |

> Pri začiatku každej session Claude zhodnotí či aktuálny model pasuje a upozorní pri nesúlade.

---

## 📂 Kde nájdeš čo

| Typ dokumentu               | Lokácia                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| Aktuálny stav projektu      | tento dokument (`docs/sessions/NEXT.md`)                               |
| Posledný day summary        | [`docs/sessions/2026-05-21-day-summary.md`](2026-05-21-day-summary.md) |
| Slice milestones            | `docs/milestones/slice-*.md`                                           |
| Architektonické rozhodnutia | `docs/decisions/0001..0013-*.md`                                       |
| GDPR / compliance dokumenty | `docs/compliance/` ([README](../compliance/README.md))                 |
| DPA + sub-processors        | `docs/compliance/legal/`                                               |
| Predošlé session logy       | `docs/sessions/2026-05-*-*.md`                                         |

---

## 🚀 Šablóna pre štart ďalšej session

```
Pokračujeme — kde sme skončili?

Otvor docs/sessions/NEXT.md pre aktuálny stav.
Najnovší day summary: docs/sessions/2026-05-21-day-summary.md

Najbližšie kroky:
1. Compliance Fáza 1 dokončenie — Privacy Policy / ToS / Breach Plan
2. Alebo K18.3 OAuth invite accept (~2-3 h, technický feature)
3. Alebo K18.7 + K21 milestone docs (~30 min, rýchle uzavretie)

Model: závisí od úlohy — viď NEXT.md "Model routing" sekciu.

Pred kódovou prácou ujasniť čo má prioritu (pilot blocker vs nice-to-have).
```
