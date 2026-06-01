<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-06-01 (Vlna 2: ADR-0022 revidované → Accepted, PDF on-demand bez ukladania; Vlna 1: ADR-0006/0008/0021 Accepted) |
| **Aktuálna fáza**         | Production LIVE ✅ — ADR-0026 implementované, smoke test + pilot nasleduje                                            |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`                                                                         |
| **GitHub**                | https://github.com/ltksolutions/inventario                                                                            |

---

### ADR-0026 — Katalógové žiadosti + oddelené vydávanie ✅ IMPLEMENTOVANÉ

**✅ HOTOVÉ** — K1–K7 hotové, 690 testov zelených. Session: `docs/sessions/2026-06-01-adr-0026-implementation.md`.

**Zostatok:** OpenAPI regen po deployi, smoke test formulára.

---

### ADR-0025 — Open-ended výpožičky + dotiahnutie formulára žiadosti ✅ IMPLEMENTOVANÉ

ADR: `docs/decisions/0025-open-ended-loans-and-request-form.md` (Accepted).

---

### ADR-0024 — Odstránenie role TEAM_MANAGER ✅ IMPLEMENTOVANÉ

ADR: `docs/decisions/0024-remove-team-manager-role.md`.

---

### ADR-0023 — Žiadosť v mene inej osoby + priama výpožička ✅ IMPLEMENTOVANÉ

ADR: `docs/decisions/0023-loan-beneficiary-and-direct-loan.md`.

---

### ADR-0022 — Preberacie protokoly (on-demand PDF) ✅ ACCEPTED (revid. 2026-06-01)

Revidované: PDF sa **neukladá** — `LoanProtocol` záznam (číslo, snapshoty, podpisy) zostáva, ale PDF
sa generuje čisto **on-demand** pri stiahnutí. Attachments infra **nie je** predpoklad. HANDOVER
protokol vzniká pri `fulfil` (nie approve — zosúladené s ADR-0026), 1 žiadosť → N Loanov → N protokolov.
Determinizmus renderu je kritický invariant (povinný byte-equality test).

**Implementácia (K1–K8, na Sonnet, keď bude potreba):** K1 odstrániť `pdfAttachmentId` zo schémy,
K2 `pdf-lib` + font + renderer, K3 `protocolNumber` generátor, K4 repo+service (vznik v `fulfil`/`return`),
K5 routes (vrátane `GET /v1/protocols/:id/pdf` on-demand), K6 sign (CLICK_TO_SIGN), K7 testy, K8 milestone.
ADR: `docs/decisions/0022-loan-protocol-pdf.md` (Accepted).

---

### Slice #5a K2–K5 — repository, service, routes, testy ✅

- 18 integračných testov, stock endpointy, StockService, `openapi.json` refreshnutý

### Slice #5a K1 — schémy (ADR-0020) ✅

- `TrackingMode` enum, `StockMovementSchema`, `AssetSchema` rozšírená

---

## 🔥 Najbližšie kroky (priorita)

### 1. ADR-0022 revízia — on-demand PDF bez ukladania (Opus)

PDF protokoly bez attachments infra. ADR-0022 prepísať podľa nového modelu → Accepted.

### 2. Smoke test po deployi

- [ ] `/settings/organisation` — formulár + uloženie billing funguje
- [ ] IČO zadané pri novej registrácii sa objaví v billing
- [ ] RouteProgressBar — viditeľný počas načítavania
- [ ] `/stock` — sklad prehľad pre ASSET_MANAGER+
- [ ] ADR-0026 formulár žiadosti (kategória+množstvo) + vydávanie (Vydať tlačidlo)

### 3. Pilot tenant onboarding

SFZ (`inventario@futbalsfz.sk`) — overiť login na prod a prejsť onboardingom.

### 4. email_unique index — overiť na prod Atlas

- [ ] Skontrolovať že `email_unique` / `email_1` index bol dropnutý migráciou 2026-05-29c

### 5. QR kódy majetku — ADR-0021 ✅ Accepted → implementácia (Sonnet)

ADR rozhodnutý, všetky detaily v `docs/decisions/0021-asset-qr-codes.md`.

---

## 📅 Plánované (neskôr)

### Slice #5 — Loans Backend ✅ HOTOVÉ

- **#5a — Sklad foundation** ✅ (2026-05-31)
- **Loans MVP** ✅ (2026-05-31): ADR-0012/0023/0025
- **ADR-0026** ✅ (2026-06-01): katalógové žiadosti + oddelené vydávanie, 690 testov

Milestone: `docs/milestones/slice-5-loans-mvp.md`

### Compliance Fáza 2 (po 1. tenantovi)

DPIA, Threat model STRIDE, Audit log retention job, Security Whitepaper.

### Slice #10 — MCP server (Q1 2027, ~10 dní)

| Fáza | Bloky   | Popis                                                     |
| ---- | ------- | --------------------------------------------------------- |
| #10a | K1–K4   | Backend foundation: mcp-access-token, repository, routes  |
| #10b | K5–K10  | MCP server scaffold: SDK, token resolver, JWT, rate limit |
| #10c | K11–K16 | Tools: 10 read + 7 write + audit log                      |
| #10d | K17–K18 | Frontend `/settings/integrations`                         |
| #10e | K19–K23 | Tests + docs + Vercel + DNS                               |

### Post-launch (LOW priority)

`Cmd+K` tenant picker, SOC 2 Type II, dashboard štatistiky, QR štítky PDF.

---

## 🏗️ Backend status

```
Celkové testy:                690
├── Slice #1–#3:              ~310
├── Slice #4–#6b:             ~169
├── Slice #6c:                  21
├── Slice #7 + K12a/b:          29
├── Slice #9:                   28
├── Slice #8 (Passkeys):        16
├── Dynamic Combobox K7:        35
├── Organisations CRUD:         56
├── Slice #5a (Sklad):          18
├── ADR-0023 (loans bndf):      ~16
├── ADR-0025 (open-ended):       13
└── ADR-0026 (katalóg. žiad.):   28

Test files:   ~43
Duration:     ~95s
```

---

## 🧭 Model routing

| Task typ                                                    | Model          |
| ----------------------------------------------------------- | -------------- |
| Strategické rozhodnutia, ADR, DPIA, security architecture   | **Opus 4.7**   |
| CRUD endpoints, frontend pages, debug, tests, implementácia | **Sonnet 4.6** |
| Milestone docs, mechanické edits, scoped docs               | **Haiku 4.5**  |

---

## 📂 Kde nájdeš čo

| Typ                               | Lokácia                                                 |
| --------------------------------- | ------------------------------------------------------- |
| **Aktuálny stav**                 | `docs/sessions/NEXT.md` (TY SI TU)                      |
| **Session 2026-06-01 (ADR-0026)** | `docs/sessions/2026-06-01-adr-0026-implementation.md`   |
| **Session 2026-06-01 (ADR-0025)** | `docs/sessions/2026-06-01-adr-0025-open-ended-loans.md` |
| **Session 2026-05-31 (večer)**    | `docs/sessions/2026-05-31-adr-0024-0023-loans.md`       |
| **Session 2026-05-31 (QR)**       | `docs/sessions/2026-05-31-qr-publictoken-revizia.md`    |
| **Session 2026-05-30**            | `docs/sessions/2026-05-30-billing-and-tenant-detail.md` |
| **ADR-čka**                       | `docs/decisions/0001..0026-*.md`                        |
| **Slice milestones**              | `docs/milestones/slice-*.md`                            |

---

**Last updated:** 2026-06-01 (Vlna 1 upratovania: ADR-0006/0008/0021 Accepted; ADR-0022 čaká na revíziu)
**Tests:** 690 ✅ | **CI:** zelené ✅ | **OpenAPI:** 69 endpointov ✅
**Repo:** github.com/ltksolutions/inventario | **Status:** Production LIVE ✅
