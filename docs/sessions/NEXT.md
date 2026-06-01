<!--
SPDX-FileCopyrightText: 2026 Jan Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — co robit v dalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                 |
| ------------------------- | ------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-06-01 (DSAR #3–#6 + email index fix DONE)          |
| **Aktuálna fáza**         | Production LIVE — smoke test + pilot onboarding je next |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`           |
| **GitHub**                | https://github.com/ltksolutions/inventario              |

---

## DSAR práva dotknutých osôb ✅ KOMPLETNE (čl. 16, 17, 18, 20)

- ✅ **#3 Right to data portability (čl. 20):** `GET /v1/me/export` — JSON export profil + memberships + audit logy ako actor
- ✅ **#4 Self-service oprava profilu (čl. 16):** `PATCH /v1/me` — strict Zod schema (4 polia)
- ✅ **#5 Right to erasure (čl. 17):** `DELETE /v1/auth/me` — okamžitá pseudonymizácia + soft-delete memberships, last-admin guard, audit cez AuditLogService
- ✅ **#6 Right to restrict (čl. 18):** `POST /v1/users/:id/restriction` (admin) + `isRestricted` flag + enforcement v auth middleware (restricted = read-only)

Session docs:
`docs/sessions/2026-06-01-dsar-export-patch-me.md` (#3+#4)
`docs/sessions/2026-06-01-dsar-erasure-restrict.md` (#5+#6)

> **Budúce zlepšenie (P2, viazané na retention job #8):** erasure (#5) je teraz okamžitá pseudonymizácia.
> 30-dňový grace period sa dorobí až keď sa stavá Vercel cron pre retention job — zdíľa s ním pseudonymizačnú vrstvu.

---

## ADR-0021 — QR kódy majetku ✅ KOMPLETNE

K1–K7 DONE. Session doc: `docs/sessions/2026-06-01-adr-0021-qr-k1-k3.md`

---

## email_unique index ✅ VYRIEŠENÉ (P0 pred pilotom)

Reziduálny globálny `users_email_global_unique` ({ email } UNIQUE) na prod — migrácia `2026-05-29c` ho minula (zlé meno v drop liste). Manuálne dropnutý na prod Atlas + nová migrácia `2026-06-01b` (inšpektuje živé indexy, poistka pre dev/forky). Prod má teraz správne 4 indexy. Session doc: `docs/sessions/2026-06-01-email-index-fix.md`

**SFZ pilot je tým odomknutý** — žiadne E11000 riziko pri 2. tenantovi.

---

## 🔥 Najbližšie kroky

### 1. Smoke test po deployi (nové DSAR + erasure/restrict)

- [ ] `GET /v1/me/export` — vráti JSON so všetkými sekciami
- [ ] `PATCH /v1/me` — firstName/lastName/preferences sa uložia
- [ ] `POST /v1/users/:id/restriction` — restrict testovacieho usera → jeho write → 403; unrestrict → write OK
- [ ] `DELETE /v1/auth/me` — NEtestovať na reálnom admin účte (nezvratné!); ak treba, na vyhradenom test useri
- [ ] over v Atlase že `users` má 4 indexy (migrácia `2026-06-01b` na prod = no-op, index už dropnutý ručne)

### 2. Pilot tenant onboarding (P0 závislosti hotové)

SFZ (`inventario@futbalsfz.sk`) — email index vyriešený, QR hotové, DSAR hotové. Onboarding je odblokovaný.

### 3. Compliance Fáza 2 (P2/P3)

- Audit log retention job (#8) — Vercel cron + pseudonymizácia; pri ňom dorobiť 30-dňový grace period pre erasure (#5)
- ADR-0022 Preberacie protokoly (PDF)

---

## 🧭 Model routing

| Task typ                                                    | Model          |
| ----------------------------------------------------------- | -------------- |
| Strategické rozhodnutia, ADR, DPIA, security architecture   | **Opus 4.8**   |
| CRUD endpoints, frontend pages, debug, tests, implementácia | **Sonnet 4.6** |
| Milestone docs, mechanické edits, scoped docs               | **Haiku 4.5**  |

---

**Last updated:** 2026-06-01 (DSAR #3–#6 + email index fix DONE)
**Tests:** zelené ✅ | **Repo:** github.com/ltksolutions/inventario | **Status:** Production LIVE ✅
