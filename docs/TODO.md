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
| **Posledná aktualizácia** | 2026-06-01 (založené po Vlnách 1–4 upratovania)                                      |
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

### 2. email_unique index — overiť/dotiahnuť na prod Atlas

- **Stav:** migrácia `2026-05-29c` existuje, treba overiť reálny efekt na produkcii
- **Model:** Sonnet / manuál
- **Rozsah:**
  - [ ] Skontrolovať, či bol starý `email_unique` / `email_1` index reálne dropnutý na prod Atlas
  - [ ] Ak nie → dobehnúť pred onboardingom 2. tenanta (inak E11000 kolízie pri JIT naprieč tenantmi)
- **Pozn.:** skôr overenie + prípadný fix než feature

---

## 🟠 P1 — GDPR práva dotknutých osôb (DSAR)

> ROPA ich deklaruje ([`gdpr-article-30.md`](./compliance/gdpr-article-30.md) sekcia 3), ale
> v `apps/api/src/modules/users/users.routes.ts` reálne **nie sú**. Sú to **právne záväzky**,
> nie nice-to-have — musia fungovať skôr, než príde tenant so živými dátami subjektov.

### 3. Right to data portability (čl. 20)

- **Stav:** ⏳ plánované (ROPA)
- **Model:** Sonnet
- **Rozsah:** `GET /v1/me/export` — JSON export celého profilu dotknutej osoby

### 4. Self-service oprava profilu (čl. 16)

- **Stav:** ⏳ čiastočné — vie to len ADMIN cez `PATCH /v1/users/:id`
- **Model:** Sonnet
- **Rozsah:** `PATCH /v1/me` — používateľ si sám opraví vlastné údaje

### 5. Right to erasure / hard delete (čl. 17)

- **Stav:** ⏳ existuje len soft-delete
- **Model:** Sonnet
- **Rozsah:** asynchrónny hard-erasure job po 30 dňoch od soft-delete
- **Súvis:** zdieľa „pseudonymizačnú/mazaciu" vrstvu s položkou 8 (retention job)

### 6. Right to restrict (čl. 18)

- **Stav:** ⏳ plánované (ROPA)
- **Model:** Sonnet
- **Rozsah:** `isRestricted` flag na `User` + obmedzenie spracovania v UI

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

### 8. Audit log retention job — automatická pseudonymizácia

- **Stav:** ⏳ základ existuje (`pseudonymizedAt` pole + helpery `defaultLegalBasisFor`/`defaultDataCategoriesFor`)
- **Model:** Sonnet
- **Špec:** detailne v [`NEXT.md`](./sessions/NEXT.md) (Compliance Fáza 2)
- **Rozsah:**
  - [ ] Retention buckety: bežné CRUD = 24 mes, auth/security = 60 mes, `ORGANISATION_*` = 84 mes
  - [ ] Pseudonymizácia (NIE delete): `actor.userId` → `'PSEUDONYMIZED'`, vymazať `displayName`/`ipAddress`/`userAgent`, zachovať `action`/`at`/`severity`, nastaviť `pseudonymizedAt`
  - [ ] Append-only invariant: pseudonymizácia = jediný povolený UPDATE na `audit_logs` (dedikovaný service)
  - [ ] Vercel cron mesačne, idempotentný (`pseudonymizedAt: null AND at < cutoff`)
  - [ ] Soft-deleted `users` po 24 mes → pseudonymizácia (rovnaký princíp)

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

- **Najbližší balík pred pilotom:** položky 1 + 2 (QR + index overenie)
- **Hneď ako budú živé dáta tenanta:** položky 3–6 (DSAR práva — právna povinnosť)
- **Najväčšia jednotlivá feature v zálohe:** položka 7 (PDF protokoly)
- **Čisto dokumentácia, dá sa kedykoľvek:** položky 9–12

**Pravidlo aktualizácie:** položku zatvor (✅ / presun do „Hotové" v príslušnom milestone/session doc)
v tej istej session, v ktorej ju dokončíš. Nové položky pridávaj sem, nie do NEXT.md.
