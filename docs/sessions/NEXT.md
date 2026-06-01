<!--
SPDX-FileCopyrightText: 2026 Jan Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — co robit v dalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                 |
| ------------------------- | ------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-06-01 (DSAR #3 + #4 DONE — export + self-patch)    |
| **Aktuálna fáza**         | Production LIVE — smoke test + pilot onboarding je next |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`           |
| **GitHub**                | https://github.com/ltksolutions/inventario              |

---

## DSAR práva dotknutých osôb — čiastočne DONE

- ✅ **#3 Right to data portability (čl. 20):** `GET /v1/me/export` — JSON export profil + memberships + audit logy ako actor
- ✅ **#4 Self-service oprava profilu (čl. 16):** `PATCH /v1/me` — firstName, lastName, displayName, preferences; strict Zod schema
- ⏳ **#5 Right to erasure (čl. 17):** asynchrónny hard-erasure job po 30 dňoch
- ⏳ **#6 Right to restrict (čl. 18):** `isRestricted` flag + obmedzenie spracovania

Session doc: `docs/sessions/2026-06-01-dsar-export-patch-me.md`

---

## ADR-0021 — QR kódy majetku ✅ KOMPLETNE

K1–K7 DONE. Session doc: `docs/sessions/2026-06-01-adr-0021-qr-k1-k3.md`

---

## 🔥 Najbližšie kroky

### 1. OpenAPI regen + full test suite

```bash
pnpm --filter @inventario/api openapi:export:offline
pnpm test
```

### 2. Smoke test po deployi

- [ ] `GET /v1/me/export` — vráti JSON so všetkými sekciami
- [ ] `PATCH /v1/me` — firstName/lastName/preferences sa uložia
- [ ] `/scan/[publicToken]` + QR na detaile assetu
- [ ] `/settings/organisation` — foundContactInfo

### 3. Pilot tenant onboarding

SFZ (`inventario@futbalsfz.sk`) — pred onboardingom skontrolovať `email_unique` index na prod Atlas.

### 4. Ďalšie DSAR práva (P1)

- `#5` Right to erasure (čl. 17) — hard-erasure job
- `#6` Right to restrict (čl. 18) — `isRestricted` flag

---

## 🧭 Model routing

| Task typ                                                    | Model          |
| ----------------------------------------------------------- | -------------- |
| Strategické rozhodnutia, ADR, DPIA, security architecture   | **Opus 4.8**   |
| CRUD endpoints, frontend pages, debug, tests, implementácia | **Sonnet 4.6** |
| Milestone docs, mechanické edits, scoped docs               | **Haiku 4.5**  |

---

**Last updated:** 2026-06-01 (DSAR #3 + #4 DONE)
**Tests:** zelené ✅ | **Repo:** github.com/ltksolutions/inventario | **Status:** Production LIVE ✅
