<!--
SPDX-FileCopyrightText: 2026 Jan Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

| Atribút                   | Hodnota                                                       |
| ------------------------- | ------------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-06-02 (ADR-0017 rev — MCP tool catalog + Slice #10 TODO) |
| **Aktuálna fáza**         | Production LIVE — všetky pred-pilotné featury hotové          |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`                 |
| **GitHub**                | https://github.com/ltksolutions/inventario                    |

---

## 🎯 Vedúci princíp

**Všetko musí byť praktické pre bežnú dennú prevádzku z reálneho života.**

---

## ✅ Hotové (posledná session, 2026-06-02)

**ADR-0017 rev** (MCP server — aktualizácia tool catalogu) — session doc: [`docs/sessions/2026-06-02-adr-0017-mcp-rev.md`](./2026-06-02-adr-0017-mcp-rev.md)

- Tool catalog zosúladený s modulmi ADR-0020 až 0027: read 10 → 18, write 7 → 11 (29 tools)
- Opravené nereálne nástroje (`extend_loan` → fulfil/direct/return/lost po ADR-0023/0026)
- EXCLUDED rozšírený (podpis protokolu, QR/štítky download, verejný scan, stock reconcile)
- Implementačný plán: 24 K-blokov (pribudol K13b stock read), baseline 825 → target ~848 testov
- TODO.md #14 prepísaný na odpracovateľný plán (5 fáz, K-bloky, modely, checkboxy)

**Housekeeping:** CRON_SECRET potvrdený (Vercel) → TODO #8 ✅; TODO #16 (ADR-0027) hlavička opravená na ✅ DONE.

---

## 🔥 Ďalší krok

### 1. Push

Commit `096702e` (ADR-0017 rev + TODO) + tento „poupratuj" commit (NEXT.md + session doc) → **push cez GitHub Desktop**.

### 2. SFZ pilot onboarding

Hlavný ďalší krok — reálny testing s prvým tenantom. Celý systém je pripravený:

- Auth (SSO, email, MFA, passkeys), assets, číselníky, loans + protokoly, QR + štítky,
  stock, DSAR práva — všetko hotové a otestované (825 testov).
- Počas pilotu overiť dve veci, ktoré nejdú bez hardvéru: Zebra Browser Print + ZD420
  (ZPL tlač + SK diakritika), a retention cron (CRON_SECRET je nastavený).

---

## 📋 Otvorené položky (z TODO.md)

- **SFZ pilot onboarding** (ďalší krok)
- **P3 compliance docs** — whitepaper, security policy, data retention schedule, DPIA pack (písanie, nie kód)
- **P4 podľa dopytu** — Slice #10 MCP server (Q1 2027, pripravený v TODO #14), follow-up featury
- Migrations at deploy-time (dlhodobé, pri škálovaní)
- Zmazať staré SFZ Atlas clustre

---

## 🧭 Model routing

| Task typ                                                    | Model          |
| ----------------------------------------------------------- | -------------- |
| Strategické rozhodnutia, ADR, DPIA, security architecture   | **Opus 4.8**   |
| CRUD endpoints, frontend pages, debug, tests, implementácia | **Sonnet 4.6** |
| Milestone docs, mechanické edits, scoped docs               | **Haiku 4.5**  |

---

**Last updated:** 2026-06-02 (ADR-0017 rev — MCP pripravený na Slice #10)
**Tests:** 825 zelených (backend) | **Repo:** github.com/ltksolutions/inventario | **Status:** Production LIVE ✅
