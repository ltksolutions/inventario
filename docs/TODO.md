<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# TODO — implementačný backlog Inventario

> **Účel.** Zdroj pravdy pre „čo treba dorobiť". Položky, kde je rozhodnutie spravené
> (ADR Accepted) alebo právna povinnosť identifikovaná, ale **kód/dokument ešte nie je**.
>
> Tento súbor je **backlog**, nie denný plán. Aktuálny stav a najbližšie 2–3 kroky drží
> [`docs/sessions/NEXT.md`](./sessions/NEXT.md). Testovanie sa rieši priebežne pri každej
> položke (workflow pravidlo: testy s každou zmenou) — preto tu nie je samostatná „testovacia" sekcia.

| Atribút                   | Hodnota                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------ |
| **Posledná aktualizácia** | 2026-06-01 (retention job #8 DONE)                                                   |
| **Stav projektu**         | Production LIVE ✅ — 0 otvorených ADR, 0 tech-dlhu                                   |
| **Legenda priorít**       | 🔴 P0 pilot · 🟠 P1 GDPR práva · 🟡 P2 ADR impl · 🟢 P3 docs · 🔵 P4 neskôr          |
| **Legenda modelu**        | Opus = architektúra/ADR/security · Sonnet = impl/CRUD/frontend · Haiku = scoped docs |

---

## 🔴 P0 — pred / krátko po SFZ pilote

### 1. ADR-0021 — QR kódy majetku ✅ DONE (2026-06-01)

- **Stav:** K1-K7 kompletné
- **Session:** [`docs/sessions/2026-06-01-adr-0021-qr-k1-k3.md`](./sessions/2026-06-01-adr-0021-qr-k1-k3.md)
- **Čo bolo implementované:**
  - [x] `publicToken` na `AssetSchema` + generovanie pri POST (K1+K2)
  - [x] `inventoryNumberFormat` per tenant (K2)
  - [x] on-demand QR render `GET /v1/assets/:id/qr?format=svg|png` (K3)
  - [x] verejný `GET /v1/public/scan/:token` — opt-in, `PublicAssetView` whitelist, rate-limited (K4)
  - [x] frontend: `/scan/[token]` route + QR na detaile + Settings foundContactInfo (K5)
  - [x] whitelist test pre `PublicAssetViewSchema` (K6)
  - [x] openapi regen (K7)

### 2. email_unique index — reziduálny globálny index ✅ DONE (2026-06-01)

- **Stav:** ✅ vyriešené (manuálny drop na prod + nová migrácia ako poistka)
- **Session:** [`docs/sessions/2026-06-01-email-index-fix.md`](./sessions/2026-06-01-email-index-fix.md)
- **Root cause:** migrácia `2026-05-29c` mala fixný zoznam mien (`email_unique`, `email_1`, `users_email_unique`), ale reálny index na prod sa volal `users_email_global_unique` → drop ho minul, migrácia sa zapísala ako completed (už sa nespustí znova). Reziduálny globálny `{ email: 1 } UNIQUE` by spôsobil E11000 pri 2. tenantovi (rovnaký email v dvoch orgoch).
- **Čo bolo spravené:**
  - [x] manuálny drop `users_email_global_unique` na prod Atlas → users má teraz správne 4 indexy
  - [x] nová migrácia `2026-06-01b-drop-residual-email-index` — inšpektuje živý zoznam indexov, dropne ANY single-field unique index na `email` bez ohľadu na meno; composite `organisationId_email_unique` nechá; idempotentná
  - [x] zaregistrovaná v `runner.ts` (poistka pre dev cluster + budúce forky, self-healing)
  - [x] 6 unit testov `migration-drop-residual-email-index.test.ts`
- **Cieľový stav prod (overené):** `_id_`, `organisationId_isActive_deletedAt`, `entraOid_unique_partial`, `organisationId_email_unique` — žiadny globálny email index

---

## 🟠 P1 — GDPR práva dotknutých osôb (DSAR)

> ROPA ich deklaruje ([`gdpr-article-30.md`](./compliance/gdpr-article-30.md) sekcia 3), ale
> v `apps/api/src/modules/users/users.routes.ts` reálne **nie sú**. Sú to **právne záväzky**,
> nie nice-to-have — musia fungovať skôr, než príde tenant so živými dátami subjektov.

### 3. Right to data portability (čl. 20) ✅ DONE (2026-06-01)

- **Stav:** ✅ implementované
- **Session:** [`docs/sessions/2026-06-01-dsar-export-patch-me.md`](./sessions/2026-06-01-dsar-export-patch-me.md)
- **Čo bolo implementované:**
  - [x] `AuditLogRepository.findByActor(userId)` — efektívny lookup cez existujúci `actor_userId` index
  - [x] `UsersService.exportSelf()` — paralelný fetch memberships + audit logov, `toSafeProfileShape` (secrets strip), fire-and-forget `DATA_EXPORT_REQUESTED` audit event
  - [x] `GET /v1/me/export` endpoint — RBAC: každý autentifikovaný používateľ (self)
  - [x] 10 integračných testov v `users-export.test.ts`

### 4. Self-service oprava profilu (čl. 16) ✅ DONE (2026-06-01)

- **Stav:** ✅ implementované
- **Session:** [`docs/sessions/2026-06-01-dsar-export-patch-me.md`](./sessions/2026-06-01-dsar-export-patch-me.md)
- **Čo bolo implementované:**
  - [x] `UpdateSelfInput` typ — `Partial<Pick<User, 'firstName' | 'lastName' | 'displayName' | 'preferences'>>`
  - [x] `UsersService.updateSelf()` — auto-derivácia `displayName`, `toSafeProfileShape`, fire-and-forget `USER_UPDATED` audit event
  - [x] `PatchMeBodySchema` so `.strict().partial()` — zakazáné polia (roles, email, isActive) vrátia 400
  - [x] `PATCH /v1/me` endpoint — RBAC: každý autentifikovaný používateľ (self)
  - [x] 16 integračných testov v `users-patch-me.test.ts`

### 5. Right to erasure / hard delete (čl. 17) ✅ DONE (2026-06-01)

- **Stav:** ✅ implementované (okamžitá pseudonymizácia)
- **Session:** [`docs/sessions/2026-06-01-dsar-erasure-restrict.md`](./sessions/2026-06-01-dsar-erasure-restrict.md)
- **Čo bolo implementované:**
  - [x] `DELETE /v1/auth/me` (už existoval z K17) — okamžitá pseudonymizácia User + soft-delete všetkých memberships v transakcii
  - [x] last-admin guard (`assertNotLastAdminForDeletion` per-org) — sólo admin sa nedá zmazať
  - [x] audit `DATA_DELETION_REQUESTED` refaktorovaný na `AuditLogService` (legalBasis, dataCategories, plný actor snapshot)
  - [x] testy `auth-erasure.test.ts` (endpoint predtým nemal žiadne)
- **Pozn.:** 30-dňový grace period pre admin soft-delete pokrýva `RetentionService.pseudonymizeSoftDeletedUsers` (#8).

### 6. Right to restrict (čl. 18) ✅ DONE (2026-06-01)

- **Stav:** ✅ implementované
- **Session:** [`docs/sessions/2026-06-01-dsar-erasure-restrict.md`](./sessions/2026-06-01-dsar-erasure-restrict.md)
- **Čo bolo implementované:**
  - [x] `isRestricted` + `restrictedAt` + `restrictionReason` na User schéme (samostatné od `isActive`)
  - [x] `POST /v1/users/:id/restriction` (admin) — set/clear flag, idempotencia (400), audit `USER_RESTRICTED`/`USER_UNRESTRICTED`
  - [x] enforcement v auth middleware: restricted user = read-only (mutujúce metódy → 403, GET povolené; erasure čl. 17 má prednosť)
  - [x] testy `users-restriction.test.ts`

---

## 🟡 P2 — Accepted ADR čakajúce na implementáciu

### 7. ADR-0022 — Preberacie protokoly (on-demand PDF)

- **Stav:** ADR ✅ Accepted (revidované Vlna 2), **žiadny `protocols` modul v API**
- **Model:** Sonnet
- **ADR:** [`docs/decisions/0022-loan-protocol-pdf.md`](./decisions/0022-loan-protocol-pdf.md)
- **Rozsah (K1–K8):**
  - [ ] K1 — odstrániť `pdfAttachmentId` zo schémy
  - [ ] K2 — `pdf-lib` + `@pdf-lib/fontkit` + embedovaný TTF (SK diakritika) renderer
  - [ ] K3 — `protocolNumber` generátor
  - [ ] K4 — repo + service: HANDOVER protokol vzniká pri `fulfil`/`createDirectLoan`, RETURN pri `return`
  - [ ] K5 — routes vrátane `GET /v1/protocols/:id/pdf` (on-demand)
  - [ ] K6 — CLICK_TO_SIGN podpis
  - [ ] K7 — testy
  - [ ] K8 — milestone doc
- **Kritický invariant:** determinizmus renderu (povinný byte-equality test) — PDF sa neukladá, `pdfSha256` lazy dopočítaný

### 8. Audit log retention job — automatická pseudonymizácia ✅ DONE (2026-06-01)

- **Stav:** ✅ implementované
- **Session:** [`docs/sessions/2026-06-01-retention-job.md`](./sessions/2026-06-01-retention-job.md)
- **Čo bolo implementované:**
  - [x] `RetentionRepository` — jediný povolený UPDATE na `audit_logs`; `pseudonymizeAuditLogs(actions, cutoff)` + `pseudonymizeSoftDeletedUsers(cutoff)`; append-only invariant zachovaný (samostatná trieda od `AuditLogRepository`)
  - [x] `RetentionService.run(now?)` — 3 buckety: CRUD (24m), security/GDPR (60m), org lifecycle (84m); soft-deleted users (24m); sekvenčné kroky; idempotentné; testovateľné cez `now` parameter
  - [x] `POST /v1/system/retention/run` — chránený `CRON_SECRET` headerom; 503 ak nekonfigurovaný; 401 na zlý token; 200 + `RetentionRunResult` JSON
  - [x] `vercel.json` cron: `0 3 1 * *` (1. každého mesiaca o 03:00 UTC)
  - [x] `CRON_SECRET` do `config.ts` + `turbo.json` globalEnv
  - [x] unit testy `retention.test.ts` (16 testov) + integračné `retention-cron.test.ts` (4 testy)
- **Po deployi treba:** nastaviť `CRON_SECRET` v Vercel → Settings → Environment Variables (`openssl rand -hex 32`)

---

## 🟢 P3 — Compliance Fáza 2 dokumenty

> Nie kód, ale „dorobiť" v zmysle dopísať. Roadmap v [`compliance/README.md`](./compliance/README.md).

### 9. Security & Privacy Whitepaper

- **Model:** Opus
- **Rozsah:** verejný PDF — sales enabler, šetrí customer due diligence

### 10. Data Retention Schedule (detail)

- **Model:** Haiku / Sonnet
- **Rozsah:** detailný per-category dokument nad rámec sumáru v ROPA sekcia 6

### 11. Information Security Policy

- **Model:** Opus
- **Rozsah:** interný dokument

### 12. DPIA Reference Pack

- **Model:** Haiku
- **Rozsah:** verejná verzia DPIA template, publikovaná na `inventario.estate/dpia`
- **Súvis:** vychádza z hotového [`legal/dpia-template.md`](./compliance/legal/dpia-template.md)

---

## 🔵 P4 — neskôr / podľa dopytu

### 13. Slice #6c follow-up featury (nový vývoj, NIE dlh)

- **Model:** Sonnet, podľa potreby
- **Pozn.:** nové funkčnosti nad rámec hotového Slice #6c (invitations) — otvoria sa, keď reálny tenant požiada. SFZ pilot ich nepotrebuje.
- **Rozsah:**
  - [ ] Resend invitation (nový token pre expired/lost e-mail)
  - [ ] Per-email domain exception (pozvať mimo `allowedDomains` s explicitnou výnimkou)
  - [ ] Email change verification (overovací flow pri zmene e-mailu)
  - [ ] Bulk invite cez CSV
  - [ ] Per-tenant email provider override (vlastný Resend namiesto default Ecomail)

### 14. Slice #10 — MCP server

- **Stav:** plánované Q1 2027 (~10 dní)
- **Model:** Sonnet
- **Rozsah:** K1–K23 — backend foundation, MCP scaffold, tools (10 read + 7 write), frontend `/settings/integrations`, docs + Vercel + DNS

### 15. Post-launch drobnosti (LOW)

- `Cmd+K` tenant picker · SOC 2 Type II roadmap · dashboard štatistiky · QR štítky PDF (batch tlač)

---

## Ako čítať tento backlog

- **Najbližší balík pred pilotom:** ✅ hotový (QR + email index) — SFZ pilot je odomknutý
- **DSAR práva (čl. 16/17/18/20) + retention job:** ✅ hotové (položky 3–8)
- **Najväčšia jednotlivá feature v zálohe:** položka 7 (PDF protokoly)
- **Čisto dokumentácia, dá sa kedykoľvek:** položky 9–12

**Pravidlo aktualizácie:** položku zatvor (✅ / presun do „Hotové" v príslušnom milestone/session doc)
v tej istej session, v ktorej ju dokončíš. Nové položky pridávaj sem, nie do NEXT.md.
