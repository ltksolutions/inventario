<!--
SPDX-FileCopyrightText: 2026 Jan Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — co robit v dalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                 |
| ------------------------- | ------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-06-01 (retention job #8 DONE)                      |
| **Aktuálna fáza**         | Production LIVE — smoke test + pilot onboarding je next |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`           |
| **GitHub**                | https://github.com/ltksolutions/inventario              |

---

## DSAR práva dotknutých osôb ✅ KOMPLETNE (čl. 16, 17, 18, 20)

- ✅ **#3 Right to data portability (čl. 20):** `GET /v1/me/export`
- ✅ **#4 Self-service oprava profilu (čl. 16):** `PATCH /v1/me`
- ✅ **#5 Right to erasure (čl. 17):** `DELETE /v1/auth/me` — okamžitá pseudonymizácia, last-admin guard
- ✅ **#6 Right to restrict (čl. 18):** `POST /v1/users/:id/restriction` + enforcement v auth middleware

Session docs: `2026-06-01-dsar-export-patch-me.md` (#3+#4), `2026-06-01-dsar-erasure-restrict.md` (#5+#6)

---

## Retention job #8 ✅ DONE

`RetentionRepository` + `RetentionService` (3 buckety: CRUD 24m / security+GDPR 60m / org 84m + soft-deleted users 24m) + `POST /v1/system/retention/run` (CRON_SECRET) + Vercel cron `0 3 1 * *`. Session doc: `docs/sessions/2026-06-01-retention-job.md`

**Po deployi: nastaviť `CRON_SECRET` v Vercel Settings → Environment Variables** (`openssl rand -hex 32`)

---

## ADR-0021 — QR kódy majetku ✅ KOMPLETNE

K1–K7 DONE. Session doc: `docs/sessions/2026-06-01-adr-0021-qr-k1-k3.md`

---

## email_unique index ✅ VYRIEŠENÉ

Reziduálny `users_email_global_unique` dropnutý manuálne na prod + migrácia `2026-06-01b` ako poistka. Session doc: `docs/sessions/2026-06-01-email-index-fix.md`. **SFZ pilot odblokovaný.**

---

## 🔥 Najbližšie kroky

### 1. Smoke test po deployi

- [ ] Nastaviť `CRON_SECRET` vo Vercel Settings → Environment Variables
- [ ] `GET /v1/me/export` — vráti JSON so všetkými sekciami
- [ ] `PATCH /v1/me` — firstName/lastName/preferences sa uložia
- [ ] `POST /v1/users/:id/restriction` — restrict → write → 403; unrestrict → write OK
- [ ] `POST /v1/system/retention/run` s CRON_SECRET — 200, counts = 0 (prázdna prod DB)
- [ ] over v Atlase že `users` má 4 indexy

### 2. Pilot tenant onboarding

SFZ (`inventario@futbalsfz.sk`) — všetky P0 závislosti hotové. Onboarding je odblokovaný.

### 3. ADR-0022 Preberacie protokoly — K1 DONE, K2–K8 čaká

K1 hotový (schéma: `pdfAttachmentId` odstránený, openapi regen OK). Zvyšok je naplánovaný — viac sessions.
**Plán:** [`docs/sessions/2026-06-01-loan-protocols-plan.md`](./2026-06-01-loan-protocols-plan.md)
Pred K2 rozhodnúť: font (DejaVu vs Noto) + logo cache (teraz vs Fáza 2). K2 (renderer) = samostatná session, chce čistú hlavu (determinizmus je kritický invariant).

### 4. Po protokoloch (poradie podľa Jana)

- REUSE/EUPL technická compliance — `reuse lint` zelený, SPDX hlavičky, LICENSES/ (Jan to chce kompletne dotiahnuť)
- Onboarding wizard — **až po pilote** (pilot povie čo má wizard riešiť; stavať naslepo = prerábka)
- EÚ fondy — až keď bude konkrétna výzva (právna/dotačná oblasť, nie kódovanie)
- Compliance docs (položky 9–12 v TODO.md)
- SFZ pilot onboarding — plán hotový: [`docs/sessions/2026-06-01-sfz-pilot-onboarding-plan.md`](./2026-06-01-sfz-pilot-onboarding-plan.md)

---

## 🧭 Model routing

| Task typ                                                    | Model          |
| ----------------------------------------------------------- | -------------- |
| Strategické rozhodnutia, ADR, DPIA, security architecture   | **Opus 4.8**   |
| CRUD endpoints, frontend pages, debug, tests, implementácia | **Sonnet 4.6** |
| Milestone docs, mechanické edits, scoped docs               | **Haiku 4.5**  |

---

**Last updated:** 2026-06-01 (retention job #8 DONE)
**Tests:** zelené ✅ | **Repo:** github.com/ltksolutions/inventario | **Status:** Production LIVE ✅
