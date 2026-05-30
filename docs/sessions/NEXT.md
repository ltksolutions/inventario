<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                         |
| ------------------------- | ----------------------------------------------- |
| **Posledná aktualizácia** | 2026-05-30 (koniec session 2026-05-30, 2. časť) |
| **Aktuálna fáza**         | Production LIVE ✅ — UX polish + billing model  |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`   |
| **GitHub**                | https://github.com/ltksolutions/inventario      |

---

## Čo sme spravili 2026-05-30 (2. časť — poobede)

### Bug fix: IČO pri registrácii sa zahodilo ✅

**Príčina:** `registration.routes.ts` aj `oauth.routes.ts` IČO z registračného formulára parsovali,
ale pri `insertOne` org dokumentu ho nikam nezapísali — `billing` objekt vtedy ešte neexistoval.

**Oprava:**

- `apps/api/src/modules/auth/registration.routes.ts` — email registrácia: ak `ico` zadané,
  vytvorí sa `billing: { legalName: orgName, ico, dic: null, isVatPayer: false, … }`, inak `billing: null`
- `apps/api/src/modules/auth/oauth.routes.ts` — SSO self-serve registrácia (`provisionOrFindUser`):
  rovnaké — `ico` destrukturované z `pendingOrg`, `billing` objekt pridaný do org insert

Existujúce orgy spätne neopravené (pôvodná hodnota nikdy neuložená) — Janika doplní IČO ručne
v `/settings/organisation`.

### TenantEditDialog — kompletné read-only billing údaje ✅

Platform admin vidí v dialógu „Upraviť tenant" **všetky fakturačné a identifikačné údaje** tenanta.
Editovateľné ostávajú len Plán a Stav (+ Názov a Kontaktný email).

**Zmeny v `apps/web/src/components/TenantsContent.tsx`:**

- Dialóg rozšírený: `max-w-md` → `max-w-lg`, pridané `max-h-[90vh] overflow-y-auto`
- Podnadpis: „Editovateľné sú Plán a Stav. Ostatné údaje sú len na čítanie…"
- Nové komponenty: `TenantReadOnlyDetails`, `ReadOnlySection`, `ReadOnlyRow`
- Read-only sekcie: **Identifikácia** (slug, dátum vytvorenia),
  **Fakturačné a právne údaje** (obchodné meno, IČO, DIČ, platiteľ DPH, IČ DPH, zápis, IBAN, email),
  **Adresy** (sídlo + korešpondenčná — poskladané do čitateľného riadku)
- Import `ReactNode` pridaný
- `billing` prechádza celým stackom (repository `list` bez projekcie → `toApiShape` spread → frontend)

---

## Čo sme spravili 2026-05-30 (1. časť — dopoludnia)

### SelectField aplikovaný naprieč appkou ✅

- `AssetCreateContent.tsx` + `AssetDetailEditForm.tsx` — pole „Stav" cez `Controller` + SelectField
- `AssetsListContent.tsx` — filter Stav + Veľkosť strany (`<label>` → `<div>`)
- `UsersContent.tsx` — filter Rola + Stav + Veľkosť strany (`<label>` → `<div>`)
- `LoansContent.tsx` ostal — pill buttons (správne per ADR-0018)
- CI lint fixy: a11y (button options, label→span), import order, `React.ReactNode` → `ReactNode`

### Tenant billing — dátový model + self-service UI ✅ (ADR-0019)

- `common.ts` — `AddressSchema`, `Ico/Dic/IcDph/Iban` schémy + normalizácia
- `OrganisationBillingSchema` — vnorené nullable `billing` pole na Organisation
- API: `GET/PATCH /v1/organisations/current` — self-service, org ID z JWT, SAFE subset
- web: `/settings/organisation` stránka + nav item „Organizácia" (ADMIN-only)
- hooks `useCurrentOrganisation` + `useUpdateCurrentOrganisation`

---

## Čo sme spravili 2026-05-29 (večerná session)

### Číselníky — kategórie zoskupené podľa typov ✅

- `CiselnikyContent.tsx` — tab Kategórie prepísaný: skupiny podľa `assetType`, farebné badge-y,
  `pluralCount` helper, stĺpec „Typ majetku" odstránený ako redundantný

### SelectField custom dropdown + ADR-0018 ✅

- `apps/web/src/components/SelectField.tsx` (nový) — WAI-ARIA combobox, klávesnica, animovaná šípka
- `apps/web/src/components/TenantsContent.tsx` — všetky `<select>` nahradené SelectField
- `docs/decisions/0018-select-field-component.md` — ADR pravidlá kedy použiť čo

---

## Stav na koniec dňa 2026-05-30

### 📊 Globálny stav

| Oblasť            | Status                                               |
| ----------------- | ---------------------------------------------------- |
| **Backend testy** | ✅ ~607 (37 test files)                              |
| **Frontend**      | ✅ všetky stránky + billing settings + tenant detail |
| **Production**    | ✅ LIVE — app.inventario.estate                      |
| **CI**            | ✅ Green                                             |
| **ADR-čka**       | ✅ 0001–0019                                         |

---

## 🔥 Najbližšie kroky (priorita)

### 1. Typecheck + lint pred commitom

```bash
cd /Users/janletko/Documents/GitHub/inventario
pnpm --filter @inventario/web typecheck && pnpm --filter @inventario/web lint
```

### 2. Commit na push (všetko naraz, header-only)

```
feat: persist registration IČO into billing + read-only tenant detail
```

> Spája bug fix (IČO z registrácie → `billing.ico` v email + SSO ceste) a
> read-only billing sekciu v TenantEditDialog. Detaily v session logu
> `2026-05-30-billing-and-tenant-detail.md`. Header-only kvôli commitlint quirku.

### 3. Smoke test po deployi

- [ ] `/settings/organisation` — formulár sa zobrazí (ADMIN), uloženie billing funguje
- [ ] IČO zadané pri novej email registrácii sa objaví v billing po prihlásení
- [ ] TenantEditDialog — read-only sekcia zobrazí slug, vytvorenie, billing údaje
- [ ] Plán card + „Požiadať o vyšší plán" — mailto link funguje
- [ ] IČ DPH pole sa zobrazí len pri zaškrtnutom „platiteľ DPH"
- [ ] `/ciselniky` — kategórie zoskupené podľa typu, abecedne
- [ ] SelectField v `/assets`, `/assets/new`, `/users`, `/admin/tenants` — funguje

### 4. Testy pre `/current` endpointy (ďalšia session)

- [ ] `updateCurrent` RBAC — len ADMIN tenanta (EMPLOYEE/ASSET_MANAGER → 403)
- [ ] billing validácia — IČO 8 číslic, IČ DPH SK+10, IBAN formát
- [ ] cross-tenant izolácia — org ID z JWT, nie z URL
- [ ] `getCurrent` — ktorýkoľvek člen číta vlastnú org

### 5. Onboarding flow pre nových tenantov

Design + rozsah pred implementáciou (**Opus 4.7** pre návrh, **Sonnet 4.6** pre impl).

### 6. Pilot tenant onboarding (pred Slice #5)

- SFZ (`inventario@futbalsfz.sk`) — overiť login na prod a prejsť onboardingom
- Reálne použitie informuje návrh Slice #5 (pôžičky)

### 7. email_unique index — overiť na prod

- [ ] Atlas: skontrolovať že `email_unique` / `email_1` index na `users` kolekcii bol dropnutý

---

## 📅 Plánované (neskôr)

### Slice #5 — loans backend (po pilotnom tenantovi)

### Slice #10 — MCP server (Q1 2027, ~10 dní)

| Fáza | Bloky   | Popis                                                     |
| ---- | ------- | --------------------------------------------------------- |
| #10a | K1–K4   | Backend foundation: mcp-access-token, repository, routes  |
| #10b | K5–K10  | MCP server scaffold: SDK, token resolver, JWT, rate limit |
| #10c | K11–K16 | Tools: 10 read + 7 write + audit log                      |
| #10d | K17–K18 | Frontend `/settings/integrations`                         |
| #10e | K19–K23 | Tests + docs + Vercel + DNS                               |

### Compliance Fáza 2 (po 1. tenantovi)

DPIA, Security Whitepaper, Data Retention Schedule, IS Policy.

### Post-launch (LOW priority)

`Cmd+K` tenant picker, SOC 2 Type II, dashboard štatistiky, QR štítky PDF.

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

| Typ                                 | Lokácia                                                 |
| ----------------------------------- | ------------------------------------------------------- |
| **Aktuálny stav**                   | `docs/sessions/NEXT.md` (TY SI TU)                      |
| **Session 2026-05-30 (obidve)**     | `docs/sessions/2026-05-30-billing-and-tenant-detail.md` |
| **Session 2026-05-29 (večer)**      | `docs/sessions/2026-05-29-ux-polish-selectfield.md`     |
| **Session 2026-05-29 (deň)**        | `docs/sessions/2026-05-29-tenants-admin-and-fixes.md`   |
| **Production smoke test checklist** | `docs/sessions/smoke-test-checklist.md`                 |
| **ADR-čka**                         | `docs/decisions/0001..0019-*.md`                        |
| **Slice milestones**                | `docs/milestones/slice-*.md`                            |

---

**Last updated:** 2026-05-30 (koniec dňa)
**Tests:** ~607 ✅
**Repo:** github.com/ltksolutions/inventario
**Status:** Production LIVE ✅
