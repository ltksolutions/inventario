<!--
SPDX-FileCopyrightText: 2026 Jan Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — co robit v dalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                 |
| ------------------------- | ------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-06-01 (ADR-0021 K1-K7 DONE — QR kódy kompletné)    |
| **Aktuálna fáza**         | Production LIVE — smoke test + pilot onboarding je next |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`           |
| **GitHub**                | https://github.com/ltksolutions/inventario              |

---

## ADR-0021 — QR kódy majetku ✅ KOMPLETNE

K1 schémy · K2 publicToken + inventoryNumberFormat · K3 QR endpoint · K4 verejný scan ·
K5 frontend (scan page, QR na detaile, foundContactInfo settings) · K6 whitelist test · K7 openapi regen

Session doc: `docs/sessions/2026-06-01-adr-0021-qr-k1-k3.md`

---

## 🔥 Najbližšie kroky

### 1. Smoke test po deployi

- [ ] `/scan/[publicToken]` — verejná stránka funguje po naskenovaní QR
- [ ] `GET /v1/assets/:id/qr` — QR sa zobrazí na detaile assetu
- [ ] `/settings/organisation` — foundContactInfo sa uloží a zobrazí na scan stránke
- [ ] ADR-0026 formulár žiadosti (kategória + množstvo) + vydávanie

### 2. Pilot tenant onboarding

SFZ (`inventario@futbalsfz.sk`) — overiť login na prod a prejsť onboardingom.
**Pred onboardingom:** nastaviť `inventoryNumberFormat` + `appBaseUrl` + `foundContactInfo` na org.

### 3. email_unique index — overiť na prod Atlas

- [ ] Skontrolovať že `email_unique` / `email_1` index bol dropnutý migráciou 2026-05-29c

---

## Planované (neskôr)

### ADR-0022 — Preberacie protokoly (on-demand PDF) — P2

K1-K8 čakajú. Session doc a plán v TODO.md položka #7.

### ADR-0026 ✅ / ADR-0025 ✅ / ADR-0024 ✅ / ADR-0023 ✅

---

## 🧭 Model routing

| Task typ                                                    | Model          |
| ----------------------------------------------------------- | -------------- |
| Strategické rozhodnutia, ADR, DPIA, security architecture   | **Opus 4.8**   |
| CRUD endpoints, frontend pages, debug, tests, implementácia | **Sonnet 4.6** |
| Milestone docs, mechanické edits, scoped docs               | **Haiku 4.5**  |

---

**Last updated:** 2026-06-01 (ADR-0021 DONE)
**Tests:** zelené ✅ | **Repo:** github.com/ltksolutions/inventario | **Status:** Production LIVE ✅
