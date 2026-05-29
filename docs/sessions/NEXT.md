<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                             |
| ------------------------- | --------------------------------------------------- |
| **Posledná aktualizácia** | 2026-05-29 (koniec session)                         |
| **Aktuálna fáza**         | Production LIVE ✅ — všetky dnešné commity pushnuté |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`       |
| **GitHub**                | https://github.com/ltksolutions/inventario          |

---

## Čo sme spravili 2026-05-29

### MFA sessionStorage fix ✅

- `window.location.href` namiesto `router.push` pre MFA redirect — garantuje sessionStorage commit pred mountom MfaChallengePage

### email_unique index fix ✅

- Migrácia `2026-05-29c` — dropuje legacy globálny `email_unique` index (multi-tenant: dvaja useri z rôznych org môžu mať rovnaký email)
- `email-auth.routes.ts` — 3 cross-tenant `findOne` opravené na tenant-scoped lookups (registrácia, change-email, confirm-email-change)

### Platform admin Tenants page ✅

- `apps/web/src/components/TenantsContent.tsx` — list, create, edit (plan/status/meno/email), archive
- `apps/web/src/lib/organisations-hooks.ts` — TanStack Query hooks pre `/v1/organisations`
- `apps/web/src/app/admin/tenants/page.tsx` — route `/admin/tenants`
- `apps/web/src/components/AppShell.tsx` — nav item "Tenanti" s `ShieldCheck` ikonou, ADMIN only
- `apps/api/tests/integration/organisations.test.ts` — 30 integration testov (RBAC, CRUD, soft-delete, filters)
- CI fix: backdrop `<button>` namiesto `<div onClick>` (jsx-a11y), `exactOptionalPropertyTypes` spread fix

### Marketing site mobile nav fix ✅

- `shared.css` — na `≤700px` skrytý `lang-switch` v `.nav-right`
- `shared.js` — SK/EN switcher + "Otvoriť aplikáciu" CTA presunuté do `.nav-mobile-menu`

---

## Stav na 2026-05-29

### 📊 Globálny stav

| Oblasť            | Status                                             |
| ----------------- | -------------------------------------------------- |
| **Backend testy** | ✅ ~607 (37 test files) — po organisations.test.ts |
| **Frontend**      | ✅ všetky stránky funkčné + nová /admin/tenants    |
| **Production**    | ✅ LIVE — app.inventario.estate                    |
| **CI**            | ✅ Green                                           |
| **Marketing**     | ✅ mobile nav opravený                             |

---

## 🔥 Najbližšie kroky (priorita)

### 1. Smoke test po deployi (Číselníky + seed + migrácie)

Po deployi overiť:

- [ ] `migrations` kolekcia — 5 záznamov vrátane `2026-05-29c`
- [ ] `/ciselniky` ukazuje predplnené hodnoty
- [ ] `/admin/tenants` zobrazuje tenantov (len pre ADMIN)

### 2. Smoke test s kolegom

Prejsť kroky 4-8 z checklistu:

- [ ] Pridanie majetku + detail + úprava
- [ ] Žiadosť o výpožičku + schválenie + email notifikácia
- [ ] Členovia + pozvánka kolegu
- [ ] Reset hesla
- [ ] Odhlásenie + opätovné prihlásenie

### 3. MFA sessionStorage — overiť po deployi

- [ ] Login s MFA → overí `window.location.href` fix — nesmie ukazovať "Platnosť prihlásenia vypršala"

### 4. Onboarding flow pre nových tenantov

Design + rozsah pred implementáciou (model: **Opus 4.7** pre návrh, **Sonnet 4.6** pre implementáciu).

### 5. email_unique index — overiť na prod

- [ ] Atlas: skontrolovať že `email_unique` / `email_1` index na `users` kolekcii bol dropnutý migráciou

### 6. SFZ onboarding

- SFZ má user `inventario@futbalsfz.sk` s `emailVerified: true` na prod
- Treba overiť login

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

| Typ                                 | Lokácia                                        |
| ----------------------------------- | ---------------------------------------------- |
| **Aktuálny stav**                   | `docs/sessions/NEXT.md` (TY SI TU)             |
| **Session 2026-05-29**              | `docs/sessions/2026-05-29-dynamic-combobox.md` |
| **Production smoke test checklist** | `docs/sessions/smoke-test-checklist.md`        |
| **ADR-čka**                         | `docs/decisions/0001..0017-*.md`               |
| **Slice milestones**                | `docs/milestones/slice-*.md`                   |

---

**Last updated:** 2026-05-29
**Tests:** ~607 ✅
**Repo:** github.com/ltksolutions/inventario
**Status:** Production LIVE ✅ — všetko commitnuté a pushnuté ✅
