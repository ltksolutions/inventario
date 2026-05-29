<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                       |
| ------------------------- | --------------------------------------------- |
| **Posledná aktualizácia** | 2026-05-30 (koniec session 2026-05-29)        |
| **Aktuálna fáza**         | Production LIVE ✅ — UX polish session        |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario` |
| **GitHub**                | https://github.com/ltksolutions/inventario    |

---

## Čo sme spravili 2026-05-29 (večerná session)

### Číselníky — kategórie zoskupené podľa typov ✅

- `CiselnikyContent.tsx` — tab Kategórie prepísaný: skupiny podľa `assetType`, farebné badge-y
  pre každý typ, abecedné zoradenie skupín, `pluralCount` helper (1/2-4/5+),
  stĺpec „Typ majetku" odstránený ako redundantný
- `ASSET_TYPE_COLORS` konštanta — 7 farebných rampov (blue/teal/green/gray/purple/amber/red)

### SelectField custom dropdown + ADR-0018 ✅

- `apps/web/src/components/SelectField.tsx` (nový) — plne custom dropdown, WAI-ARIA combobox
  pattern, klávesnica ↑↓ Enter Esc Tab, check mark pri vybranej položke, animovaná šípka
- `apps/web/src/components/TenantsContent.tsx` — všetky `<select>` nahradené `SelectField`
  (filtre: Stav, Plán, Veľkosť strany; dialógy: Edit Tenant, Create Tenant)
- `docs/decisions/0018-select-field-component.md` — ADR s pravidlami kedy použiť SelectField
  vs Combobox vs natívny select
- ESLint fix — odstrániť komentár na neexistujúce pravidlo `jsx-a11y/no-noninteractive-element-to-interactive-role`

### ROADMAP + docs aktualizované ✅

- `ROADMAP.md` — v0.4 označené ako Completed, Done sekcia rozšírená o celú históriu
  frontend stránok, testov a bugfixov, v0.5 Next aktualizované
- `docs/milestones/slice-4-frontend-web.md` — nová sekcia „Rozšírenia po 2026-05-20"
  (grouped categories, platform admin, bugfixy)

---

## Stav na koniec 2026-05-29

### 📊 Globálny stav

| Oblasť            | Status                                               |
| ----------------- | ---------------------------------------------------- |
| **Backend testy** | ✅ ~607 (37 test files)                              |
| **Frontend**      | ✅ všetky stránky + grouped categories + SelectField |
| **Production**    | ✅ LIVE — app.inventario.estate                      |
| **CI**            | ✅ Green                                             |
| **ADR-čka**       | ✅ 0001–0018                                         |

---

## 🔥 Najbližšie kroky (priorita)

### 1. Smoke test po deployi

Po deployi overiť:

- [ ] `/ciselniky` — kategórie sú zoskupené podľa typu, abecedne zoradené
- [ ] `/admin/tenants` — Stav/Plán/Veľkosť strany filtre používajú nový SelectField
- [ ] Edit + Create dialog v Tenantoch — SelectField funguje (klávesnica + myš)
- [ ] `migrations` kolekcia — 5 záznamov vrátane `2026-05-29c`
- [ ] MFA redirect — nesmie ukazovať "Platnosť prihlásenia vypršala"

### 2. Rozšíriť SelectField do ďalších stránok

Ďalšie `<select>` na nahradenie (podľa ADR-0018):

- [ ] `UsersContent.tsx` — filter Rola + filter Stav + Veľkosť strany
- [ ] `AssetsListContent.tsx` — filter Typ majetku + filter Stav + Veľkosť strany
- [ ] `LoansContent.tsx` — filter Status

### 3. Smoke test s kolegom

- [ ] Pridanie majetku + detail + úprava
- [ ] Žiadosť o výpožičku + schválenie
- [ ] Členovia + pozvánka kolegu
- [ ] Reset hesla

### 4. Onboarding flow pre nových tenantov

Design + rozsah pred implementáciou (model: **Opus 4.7** pre návrh, **Sonnet 4.6** pre implementáciu).

### 5. email_unique index — overiť na prod

- [ ] Atlas: skontrolovať že `email_unique` / `email_1` index na `users` kolekcii bol dropnutý migráciou

### 6. SFZ onboarding

- `inventario@futbalsfz.sk` — overiť login na prod

---

## 📅 Plánované (neskôr)

### Slice #10 — MCP server (Q1 2027, ~10 dní)

| Fáza | Bloky   | Popis                                                                                    |
| ---- | ------- | ---------------------------------------------------------------------------------------- |
| #10a | K1–K4   | Backend foundation: mcp-access-token schema, repository, routes, cleanup job             |
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
- Migrácie do deploy-time kroku (tech debt, pred scale)

---

## 🏗️ Backend status

```
Celkové testy:                ~607
├── Slice #1–#3:              ~310
├── Slice #4–#6b:             ~169
├── Slice #6c:                  21
├── Slice #7 + K12a/b:          29
├── Slice #9:                   28
├── Slice #8 (Passkeys):        16
├── Dynamic Combobox K7:        35
└── Organisations CRUD:         30

Test files:   37
Duration:     ~85s
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

| Typ                                 | Lokácia                                               |
| ----------------------------------- | ----------------------------------------------------- |
| **Aktuálny stav**                   | `docs/sessions/NEXT.md` (TY SI TU)                    |
| **Session 2026-05-29 (večer)**      | `docs/sessions/2026-05-29-ux-polish-selectfield.md`   |
| **Session 2026-05-29 (deň)**        | `docs/sessions/2026-05-29-tenants-admin-and-fixes.md` |
| **Production smoke test checklist** | `docs/sessions/smoke-test-checklist.md`               |
| **ADR-čka**                         | `docs/decisions/0001..0018-*.md`                      |
| **Slice milestones**                | `docs/milestones/slice-*.md`                          |

---

**Last updated:** 2026-05-30
**Tests:** ~607 ✅
**Repo:** github.com/ltksolutions/inventario
**Status:** Production LIVE ✅
