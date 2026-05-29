<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                    |
| ------------------------- | ---------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-05-29 (login JWT roles fix — root cause redirect bug) |
| **Aktuálna fáza**         | Production LIVE — login redirect bug opravený, čaká deploy |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`              |
| **GitHub**                | https://github.com/ltksolutions/inventario                 |

---

## Čo sme spravili 2026-05-29 (pokračovanie)

### Zjednotená stránka Číselníky ✅

- Nová `/ciselniky` so 4 záložkami: Kategórie · Lokality · Typy majetku · Stavy
- Generická `TaxonomyTable` — názov, slug, extra stĺpec, inline rename (ceruzka), delete (FK protected)
- `AddInlineDialog` modál na pridanie
- RBAC: zobrazenie všetci · pridať/premenovať ASSET_MANAGER+ADMIN · zmazať ADMIN only
- AppShell menu: `Kategórie` + `Lokality` nahradené jedným `Číselníky` (ListChecks)
- Combobox v asset forme ostáva (rýchle pridanie za behu); Číselníky = správa
- Staré `/categories` a `/locations` routes ostali funkčné (nie v menu)

### Oprava: migration runner sa nikdy nevolal 🐛✅

- **Bug:** `runPendingMigrations` nebol napojený NIKDE (ani server.ts, ani Vercel `api/index.ts`)
- Dôsledok: `migrations` kolekcia neexistovala, `asset_types`/`asset_conditions` prázdne na prode
- **Fix:** napojené do `buildServer()` po mongo plugine; skip v EXPORT_ONLY + test mode
- Idempotentné (completedAt guard), beží pri cold starte
- ⚠️ POZNÁMKA: pre vyšší traffic / veľa tenantov presunúť migrácie do deploy-time kroku (nie request-time)

### Auto-seed default číselníkov pre KAŽDÝ nový tenant + fork ✅

- **Jeden zdroj pravdy:** `packages/shared-types/src/defaults/taxonomy-defaults.ts`
  - `DEFAULT_ASSET_TYPES` (7), `DEFAULT_ASSET_CONDITIONS` (6), `DEFAULT_CATEGORIES` (hierarchické)
- **Helper:** `apps/api/src/lib/seed-tenant-defaults.ts` — `seedTenantDefaults(db, orgId, createdBy)`
- **Napojené na 3 miestach:** JIT provisioning + admin create (organisations.service) + migrácie
- Seed je best-effort (try/catch) — chyba nezhodí login. Idempotentný upsert/find-by-slug.
- **Kategórie hierarchicky** — 6 hlavných, 3 s podkategóriami (učí používateľa že sa dá vnárať)
- Lokality zámerne prázdne (fyzické miesta si nastaví tenant)
- Migrácie: `2026-05-29` (types+conditions+migrate enum→slug) + `2026-05-29b` (categories backfill)
- Fork prepíše defaulty v shared-types a má vlastný štandard

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

## 🐛✅ OPRAVENÉ 2026-05-29: login → redirect späť na login (chýbajúce roles v JWT)

**Symptom:** po úspešnom logine (204, cookie OK) ťa appka hodila späť na /login.
**Root cause:** `issueAccessToken` bral `roles: user.roles`, ale po ADR-0015 migrácii
sa `roles` z User dokumentu odstránili (sú na Membership). Token sa podpisoval BEZ
`roles` claim → `verifyAccessToken` → `assertInventarioPayload` hádzal "missing roles"
→ `/v1/auth/me` vrátil 401 → frontend redirect na login. Cookie atribúty boli OK
(`Secure; SameSite=None; Domain=.inventario.estate`) — problem nebol v cookie.
**Prečo testy prešli:** test fixtures vytvárajú usera s `roles` poľom prítomným; len
migrovaní prod useri ho mali odstránený → rozdiel test vs prod data.
**Fix:** `issueAccessToken(user, org, membershipId, roles)` — roly sa teraz berú
z Membership (autoritatívny per-tenant zdroj). Upravení všetci calleri:
email login, switch-org, OAuth callback+refresh, MFA challenge+forced-verify,
passkeys login + 3 test helpery (provisionUser, mfa provisionEmailUser, forced-mfa).
**Overenie po deployi:** login curl + `/me` musí vrátiť 200 (nie 401).
**Súbory:** `inventario-jwt.ts`, `email-auth.routes.ts`, `auth-session.routes.ts`,
`oauth.routes.ts`, `mfa/mfa.routes.ts`, `passkeys/passkeys.routes.ts`,
`tests/helpers/test-fixtures.ts`, `tests/integration/mfa.test.ts`,
`tests/integration/mfa-forced-setup.test.ts`.

---

## 🔥 Najbližšie kroky (priorita)

### 1. ✅ VYRIEŠENÉ: seed pri email registrácii

`register/email` route v `email-auth.routes.ts` UŽ volá `seedTenantDefaults(db, orgId, userId)`
v best-effort try/catch po vložení membershipu. Seed je teda napojený na všetkých 3 miestach:
JIT provisioning + admin create (organisations.service) + email registrácia.
Pôvodný nález bol zastaraný — nič na opravu.

### 2. 🐛 URGENTNÉ: MFA email login — sessionStorage token sa neukladá

Po email logine s MFA sa vráti 202 + `mfaSessionToken`, ale frontend nevykoná
`sessionStorage.setItem` pred `router.push('/login/mfa')` — `/login/mfa` nájde
`tokenMissing: true` a zobrazí "Platnosť prihlásenia vypršala".

**Hypotéza:** rate limit (10/15min) spôsobil 401 namiesto 202 po opakovaných pokusoch,
alebo Next.js `router.push` v prod mode spožobí navigation pred kompletným vykonaním
async handlera. Treba otestovať s čerstvou session (bez rate limitu) a s DevTools Network tab.

**Súbory:** `apps/web/src/components/LoginPage.tsx` → `handleEmailLogin` (riadok ~95)

### 3. Onboarding flow pre nových tenantov (kľúčové pre UX)

Nový tenant po prvom logine spadne rovno do prázdneho dashboardu — chýba uvítací/sprievodný krok.
Číselníky už sú predplnené (typy, stavy, kategórie), ale tenant nemá naviganý "prvé kroky".

**Nápady na zváženie (ešte nezadané):**

- Uvítacia obrazovka / checklist "začni tu": pridať prvý majetok, pozvať kolegu, nastaviť lokality
- Prázdne stavy stránok s jasným CTA (čiastočne už existuje)
- Volitený onboarding wizard (názov organizácie, logo, prvá lokalita)
- Progres indikátor dokončenia setupu

**Treba doriešiť design + rozsah pred implementáciou** (model: Opus 4.7 pre návrh, Sonnet 4.6 pre implementáciu).

### 4. Smoke test po deployi (Číselníky + seed + migrácie)

Po deployi overiť:

- [ ] `migrations` kolekcia vznikla s 4 záznamami (`completedAt`)
- [ ] `asset_conditions` → 6 dok., `asset_types` → 7 dok., `categories` → hierarchia
- [ ] `/ciselniky` ukazuje predplnené hodnoty vo všetkých 4 záložkách
- [ ] AssetCreate/Edit — Combobox polia fungujú, "+ Vytvoriť", inline rename
- [ ] Existujúce assety majú slug values (nie enum values)

### 5. Smoke test s kolegom

Prejsť kroky 4-8 z checklistu:

- [ ] Pridanie majetku + detail + úprava
- [ ] Žiadosť o výpožičku + schválenie + email notifikácia
- [ ] Členovia + pozvánka kolegu
- [ ] Reset hesla
- [ ] Odhlásenie + opätovné prihlásenie

### 6. Zmazať staré SFZ clustre (manuálne)

**Atlas → Slovenský futbalový zväz projekt:**

- Zmazať `sfz-asset-mgmt-dev`
- Zmazať `sfz-asset-mgmt-prod`

### 7. `email_unique` index — systémový problém

`users` kolekcia má globálny unique index na `email` — blokuje dvoch userov z rôznych org s rovnakým emailom.

**Fix:** zmazať `email_unique`, nahradiť s `{ email: 1, deletedAt: 1 }` non-unique.
**Kedy:** pred onboardingom SFZ alebo prvého externého tenanta.

### 8. SFZ onboarding

- SFZ má user `inventario@futbalsfz.sk` s `emailVerified: true` na prod
- Treba overiť login po novom prod clustri

---

## 📅 Plánované — deploy-time migrácie (tech debt)

Migrácie tiež bežia pri cold starte (request-time). Pre vyšší traffic / veľa tenantov
ich presunúť do dedikovaného deploy-time kroku, aby:

- nebežala kontrola pri každom cold starte
- nebolo riziko race medzi paralelnými cold startami (dnes mitigované unique indexom na `migrations.key`)

**Kedy:** pred onboardingom viacerých tenantov / pri zvýšení traffiku.

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
**Status:** Production LIVE ✅ — login redirect bug (JWT roles) opravený ✅ — čaká deploy + over MFA sessionStorage 🐛
