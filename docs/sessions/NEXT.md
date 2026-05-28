<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                |
| ------------------------- | ------------------------------------------------------ |
| **Posledná aktualizácia** | 2026-05-29 (Dynamic Combobox K1–K7 kompletný)          |
| **Aktuálna fáza**         | Production LIVE — Dynamic Combobox plne implementovaný |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`          |
| **GitHub**                | https://github.com/ltksolutions/inventario             |

---

## Čo sme spravili 2026-05-29

### Dynamic Combobox K1–K7 ✅ KOMPLETNÝ

| Blok | Popis                                                              | Status |
| ---- | ------------------------------------------------------------------ | ------ |
| K1   | `<Combobox>` + `<TagsCombobox>` reusable komponenty                | ✅     |
| K2   | Backend: `asset_types` + `asset_conditions` CRUD + seed defaults   | ✅     |
| K3   | Migrácia enum → slug, `asset.ts` `type`/`condition` → `z.string()` | ✅     |
| K4   | Frontend: AssetCreate + AssetEdit s Combobox                       | ✅     |
| K5   | Tags multi-select (`TagsCombobox`) integrovaný                     | ✅     |
| K6   | Slug pri rename — by design: PATCH `name` neregeneruje slug        | ✅     |
| K7   | Testy: RBAC, FK protection, slug — 35 nových testov, CI green      | ✅     |

---

## Stav na 2026-05-29

### 📊 Globálny stav

| Oblasť                   | Status                                              |
| ------------------------ | --------------------------------------------------- |
| **Backend testy**        | ✅ ~577 (35 test files) — po K7 commite             |
| **Frontend**             | ✅ všetky stránky funkčné                           |
| **Production**           | ✅ LIVE — app.inventario.estate                     |
| **CI**                   | ✅ Green (lint + typecheck + tests + openapi check) |
| **Combobox**             | ✅ type, condition, category, location, tags        |
| **asset_types kolekcia** | ✅ CRUD + seed + FK protection + audit + testy      |
| **asset_conditions**     | ✅ CRUD + seed + FK protection + audit + testy      |
| **Migrácia enum→slug**   | ✅ Runner zaregistrovaný, spustí sa pri deployi     |
| **Smoke test s kolegom** | ⏳ kroky 4-8 pending                                |
| **Legal review**         | ⏳ externe                                          |

---

## 🔥 Najbližšie kroky (priorita)

### 1. Smoke test formulárov na produkcii (po deployi)

Po deployi overiť:

- [ ] AssetCreate — Combobox polia fungujú (type, condition, category, location, tags)
- [ ] AssetEdit — rovnaké
- [ ] ASSET_MANAGER môže pridať novú hodnotu cez "+ Vytvoriť"
- [ ] Inline rename funguje
- [ ] Migrácia prebehla — existujúce assety majú slug values (nie enum values)

### 2. Smoke test s kolegom

Prejsť kroky 4-8 z checklistu:

- [ ] Pridanie majetku + detail + úprava
- [ ] Žiadosť o výpožičku + schválenie + email notifikácia
- [ ] Členovia + pozvánka kolegu
- [ ] Reset hesla
- [ ] Odhlásenie + opätovné prihlásenie

### 3. Zmazať staré SFZ clustre (manuálne)

**Atlas → Slovenský futbalový zväz projekt:**

- Zmazať `sfz-asset-mgmt-dev`
- Zmazať `sfz-asset-mgmt-prod`

### 4. `email_unique` index — systémový problém

`users` kolekcia má globálny unique index na `email` — blokuje dvoch userov z rôznych org s rovnakým emailom.

**Fix:** zmazať `email_unique`, nahradiť s `{ email: 1, deletedAt: 1 }` non-unique.
**Kedy:** pred onboardingom SFZ alebo prvého externého tenanta.

### 5. SFZ onboarding

- SFZ má user `inventario@futbalsfz.sk` s `emailVerified: true` na prod
- Treba overiť login po novom prod clustri

---

## 📅 Plánované

### Slice #10 — MCP server (Q1 2027, ~10 dní)

Design: [ADR-0017](../decisions/0017-mcp-server.md)

| Fáza | Bloky   | Popis                                                                                    |
| ---- | ------- | ---------------------------------------------------------------------------------------- |
| #10a | K1–K4   | Backend foundation: `mcp-access-token` schema, repository, routes, cleanup job           |
| #10b | K5–K10  | MCP server scaffold: SDK setup, token resolver, JWT issuer, openapi-fetch, rate limiting |
| #10c | K11–K16 | Tool implementation: 10 read tools + 7 write tools + audit log                           |
| #10d | K17–K18 | Frontend `/settings/integrations` page                                                   |
| #10e | K19–K23 | Tests + docs + Vercel deployment + DNS                                                   |

### Compliance Fáza 2 (po 1. tenantovi)

| Dokument                      | Model      | Odhad |
| ----------------------------- | ---------- | ----- |
| DPIA Template                 | Opus 4.7   | ~3h   |
| Security & Privacy Whitepaper | Opus 4.7   | ~4h   |
| Data Retention Schedule       | Sonnet 4.6 | ~2h   |
| Information Security Policy   | Sonnet 4.6 | ~2h   |

### Post-launch (LOW priority)

- `Cmd+K` tenant picker
- SOC 2 Type II — pri prvom enterprise tenantovi
- Dashboard — reálne štatistiky
- QR kód — tlačiteľné štítky PDF

---

## 🏗️ Backend status

```
Celkové testy:                ~577
├── Slice #1–#3:              ~310
├── Slice #4–#6b:             ~169
├── Slice #6c:                  21
├── Slice #7 + K12a/b:          29
├── Slice #9:                   28
├── Slice #8 (Passkeys):        16
└── Dynamic Combobox K7:        35 (asset-types + asset-conditions)

Test files:   35
Duration:     ~80s
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

| Typ                                 | Lokácia                                        |
| ----------------------------------- | ---------------------------------------------- |
| **Aktuálny stav**                   | `docs/sessions/NEXT.md` (TY SI TU)             |
| **Session 2026-05-29**              | `docs/sessions/2026-05-29-dynamic-combobox.md` |
| **Production smoke test checklist** | `docs/sessions/smoke-test-checklist.md`        |
| **ADR-čka**                         | `docs/decisions/0001..0017-*.md`               |
| **Slice milestones**                | `docs/milestones/slice-*.md`                   |

---

**Last updated:** 2026-05-29
**Tests:** ~577 ✅
**Repo:** github.com/ltksolutions/inventario
**Status:** Production LIVE ✅ — Dynamic Combobox K1–K7 ✅ — CI green ✅
