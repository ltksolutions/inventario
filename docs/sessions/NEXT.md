<!--
SPDX-FileCopyrightText: 2026 Jan Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                        |
| ------------------------- | -------------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-06-02 (ADR-0022 K2–K4 hotové)                             |
| **Aktuálna fáza**         | Production LIVE — dev pokračuje, cieľ: čím skôr reálny testing |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`                  |
| **GitHub**                | https://github.com/ltksolutions/inventario                     |

---

## 🎯 Vedúci princíp

**Všetko musí byť praktické pre bežnú dennú prevádzku z reálneho života.** Pri každom kroku sa pýtať: „zvládne to človek pri pulte / v sklade / na ihrisku bez školenia?". **Cieľ: čím skôr reálny testing so SFZ.**

---

## ✅ Hotové (posledná session, 2026-06-02)

**ADR-0022 K2–K4** — session doc: [`docs/sessions/2026-06-02-adr-0022-k2-k4.md`](./2026-06-02-adr-0022-k2-k4.md)

- **K2** — `pdf-lib` + `@pdf-lib/fontkit`; DejaVu Sans TTF + default logo PNG v repo; `renderProtocolPdf()` deterministický renderer (A4/LETTER, hlavička, tabuľka, stránkovanie 25+, pätka s podpismi); `loadLogo()` helper (fetch + timeout + fallback, SVG odmietnutý); 9 unit testov vrátane kritického byte-equality determinizmus testu
- **K3** — `generateProtocolNumber()` cez `counters` collection, `$inc + upsert`, race-safe (10 súbežných → 10 unikátnych), 7 unit testov
- **K4** — `LoanProtocolsRepository` (insert, findById, findByLoanId, update, indexy); `insertDraftProtocol()` helper v `LoansService`; HANDOVER protokol v `fulfilLoanRequest` + `createDirectLoan`; RETURN protokol v `returnLoan`; `Loan.*ProtocolId` nastavený v tej istej transakcii

**Stav testov:** 783/783 zelené ✅

---

## 🔥 Ďalší krok — ADR-0022 K5–K8

**Session B** (routes + podpis + testy + docs). Odporúčaný model: **Sonnet 4.6** (K5–K7), **Haiku 4.5** (K8).

### K5 — Routes (read + PDF on-demand)

- `GET /v1/loans/:id/protocols` — zoznam protokolov k zápožičke
- `GET /v1/protocols/:id` — metadata protokolu (JSON)
- `GET /v1/protocols/:id/pdf` — on-demand render; doplniť borrower snapshot + paperSize pri inserte; voliteľný lazy `pdfSha256`
- RBAC: účastník protokolu (borrower) ALEBO ASSET_MANAGER+ADMIN
- Cross-tenant izolácia (organisationId scope)
- **Doplniť** `LoanProtocolsRepository.ensureIndexes()` do server startup (loans routes plugin)

### K6 — Podpis (CLICK_TO_SIGN)

- `POST /v1/protocols/:id/sign` — zapíše `signatures.handover` / `.receive`
- Keď obe strany podpísané → `DRAFT → SIGNED`
- Pri SIGNED: dopočítať + fixovať `pdfSha256`
- Rozhodnutie logo-vs-hash (ADR-0022 R3 poznámka) — zafixovať logo bytes pri podpise, alebo akceptovať verziu v čase podpisu?
- RBAC: len príslušná strana

### K7 — Testy

- Determinizmus: dvojitý render → rovnaký hash (kritický invariant)
- Diakritika SK
- `protocolNumber` race (dva súbežné fulfil)
- RBAC — borrower vidí svoje, manager všetky, cudzí 403
- Cross-tenant izolácia
- Snapshot-not-live — zmena assetu po vzniku nezmení protokol
- Logo fallback — neplatná URL → default logo, render nespadne
- Stránkovanie 25+ položiek
- Multi-fulfil: každý fulfil = vlastný HANDOVER protokol

### K8 — Docs (Haiku)

- Milestone doc
- Session log
- Zatvoriť #7 v TODO.md → presun do milestone docu
- Aktualizovať NEXT.md

---

## 📋 Po ADR-0022 — ADR-0027 Tlač QR štítkov

Zdieľa `pdf-lib` + DejaVu Sans s protokolmi — rozumné robiť hneď po K8.
Viď TODO.md položka #16.

---

## 🧭 Model routing

| Task typ                                                    | Model          |
| ----------------------------------------------------------- | -------------- |
| Strategické rozhodnutia, ADR, DPIA, security architecture   | **Opus 4.8**   |
| CRUD endpoints, frontend pages, debug, tests, implementácia | **Sonnet 4.6** |
| Milestone docs, mechanické edits, scoped docs               | **Haiku 4.5**  |

---

## Workflow pripomienka

- Po zmene schém: `pnpm --filter @inventario/shared-types build` → `openapi:export:offline` → `pnpm test`
- Header-only commit messages (GitHub Desktop blank-line pasca)
- `LoanProtocolsRepository.ensureIndexes()` treba zaregistrovať v loans routes plugin pri K5
- Borrower snapshot + paperSize sa doplnia v K5 route handleri (pred insertom cez service)

---

**Last updated:** 2026-06-02 (K2–K4 hotové)
**Tests:** 783 zelených ✅ | **Repo:** github.com/ltksolutions/inventario | **Status:** Production LIVE ✅
