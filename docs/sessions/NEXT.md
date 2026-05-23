<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-05-23 (Slice #9 cross-tenant memberships — DOKONČENÝ)                                                 |
| **Aktuálna fáza**         | Pre-launch compliance finalization + legal review                                                          |
| **Posledný session log**  | [`docs/milestones/slice-9-cross-tenant-memberships.md`](../milestones/slice-9-cross-tenant-memberships.md) |

---

## Stav na konci 2026-05-23

### ✅ Hotové dnes

- **Slice #9 — Cross-tenant memberships** — KOMPLETNÝ (#9a–#9f)
  - K1–K4: schemas + migration runner + repositories
  - K5–K9: JWT `mid` claim + auth middleware refactor + switch-org + auth/me
  - K10–K14: cross-tenant invite logic (new-user / existing-user / rejoin)
  - K15–K18: memberships CRUD + last-admin protection + GDPR erasure + audit events
  - K19–K22: tenant switcher + accept-invite existing-user + members admin + org settings
  - K23–K25: milestone doc + NEXT.md + (API reference docs — deferred)
- **553 / 553 testov passing** (+28 oproti 525)

### 📊 Globálny stav

| Oblasť                      | Status                                                     |
| --------------------------- | ---------------------------------------------------------- |
| **Slice #6c (auth)**        | ✅ HOTOVÝ                                                  |
| **Slice #7 (TOTP MFA)**     | ✅ HOTOVÝ                                                  |
| **K12a Forced MFA**         | ✅ HOTOVÝ                                                  |
| **K12b Admin MFA reset**    | ✅ HOTOVÝ                                                  |
| **Slice #9 (cross-tenant)** | ✅ HOTOVÝ — K1–K22 + docs                                  |
| **Compliance Fáza 1**       | ✅ HOTOVÁ — 5 dokumentov                                   |
| **Frontend pages**          | ✅ 9/9 stránok + tenant switcher + members + organisations |
| **Production deploy**       | ✅ LIVE — inventario.estate                                |
| **DR Test #1**              | ✅ PASS — RPO ~23h, RTO < 1 min                            |
| **Backend testy**           | ✅ 553 / 553 (32 test files)                               |
| **Launch ready**            | ✅ 100% — čaká len na legal review (beží externe)          |

---

## ⏭️ Najbližšie kroky

### 🔥 Priorita HIGH — pred prvým tenantom

| #   | Úloha                                                    | Model   | Trvanie     |
| --- | -------------------------------------------------------- | ------- | ----------- |
| 1   | **Právny review** compliance dokumentov advokátom        | Externý | ⏳ PENDING  |
| 2   | **Atlas allowlist** — Vercel Secure Compute (post-pilot) | Ján     | POST-LAUNCH |
| 3   | **Production smoke test** po Slice #9 deploy             | Ján     | ~30 min     |

### Priorita MEDIUM (post-launch)

- **K13 OAuth callback cross-tenant** — accept existing-user invite cez Google/MS SSO. ~2h Sonnet 4.6.
- **Resend invitation endpoint** (`POST /v1/invitations/:id/resend`). ~1h Sonnet 4.6.
- **Per-email invitation exceptions** (`Organisation.settings.invitations.exceptions[]`). ~1h Sonnet 4.6.
- **Email change verification flow**. ~2h Sonnet 4.6.
- **MCP server (`apps/mcp-server`)** — v0.7 / Q1 2027. Opus 4.7 design + Sonnet impl.
- **Passkeys / WebAuthn (Slice #8)** — passwordless login. Opus 4.7 design + Sonnet impl.
- **API reference docs update** — auth + memberships endpoints. ~1h Haiku 4.5.

### Priorita LOW

- **Keyboard shortcut `Cmd+K` tenant picker** — ~30 min Sonnet, UX polish.
- **Apple Sign-In (K4)** — čaká na Apple Developer account.
- **SOC 2 Type II** — pri prvom enterprise tenantovi.
- **ISO/IEC 27001** — pri verejnom obstarávaní.

---

## Compliance Fáza 2 (po prvom tenant launchom)

| #   | Dokument                          | Model      | Trvanie |
| --- | --------------------------------- | ---------- | ------- |
| 1   | **DPIA Template** pre tenantov    | Opus 4.7   | ~3 h    |
| 2   | **Security & Privacy Whitepaper** | Opus 4.7   | ~4 h    |
| 3   | **Data Retention Schedule**       | Sonnet 4.6 | ~2 h    |
| 4   | **Information Security Policy**   | Sonnet 4.6 | ~2 h    |

---

## 🏗️ Backend status

```
Celkové testy:                553
├── Slice #1–#3 (backend CRUD + categories + locations + users): ~310
├── Slice #4–#6b (frontend auth, loans, invitations):            ~169
├── Slice #6c (K17.5 + K18 + K18.3):                              21
├── Slice #7 (TOTP MFA):                                            9
├── K12a + K12b (Forced MFA + Admin reset):                        20
└── Slice #9 (cross-tenant memberships):                           28

Test files:   32
Success rate: 100% (0 failov)
Duration:     ~70s
```

---

## 🧭 Model routing

| Task typ                                       | Model      | Notes           |
| ---------------------------------------------- | ---------- | --------------- |
| Strategické rozhodnutia, ADR, DPIA, compliance | Opus 4.7   | —               |
| CRUD endpoints, frontend pages, debug, tests   | Sonnet 4.6 | Standard impl   |
| Milestone docs, mechanické edits, scoped docs  | Haiku 4.5  | Structure known |

> **Pri začiatku každej session:** Claude zhodnotí či model pasuje a upozorní pri nesúlade.

---

## 📂 Kde nájdeš čo

| Typ                   | Lokácia                            |
| --------------------- | ---------------------------------- |
| **Aktuálny stav**     | `docs/sessions/NEXT.md` (TY SI TU) |
| **Slice milestones**  | `docs/milestones/slice-*.md`       |
| **ADR-čka**           | `docs/decisions/0001..0015-*.md`   |
| **GDPR / compliance** | `docs/compliance/`                 |
| **Session logy**      | `docs/sessions/2026-05-*-*.md`     |

---

**Last updated:** 2026-05-23 — Slice #9 cross-tenant memberships DONE. 553/553 testov.  
**Status:** Launch-ready. Čaká len na legal review.
