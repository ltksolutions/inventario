<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-05-30 — SelectField app-wide + tenant billing

| Atribút    | Hodnota                                                             |
| ---------- | ------------------------------------------------------------------- |
| **Dátum**  | 2026-05-30                                                          |
| **Fáza**   | Production LIVE — UX polish + billing model                         |
| **Modely** | Sonnet 4.6 (frontend), Opus 4.7 (billing model), Haiku 4.5 (devlog) |

---

## Čo sme spravili

### 1. SelectField aplikovaný naprieč appkou ✅

Dokončenie rozšírenia `SelectField` (z predošlej session) na všetky
zostávajúce natívne `<select>` prvky:

- `AssetCreateContent.tsx` — pole „Stav" cez `Controller` (react-hook-form) + SelectField
- `AssetDetailEditForm.tsx` — pole „Stav" cez `Controller` + SelectField
- `AssetsListContent.tsx` — filter Stav + Veľkosť strany; `<label>` → `<div>` (a11y)
- `UsersContent.tsx` — filter Rola + Stav + Veľkosť strany; `<label>` → `<div>`

`LoansContent.tsx` ostal nezmenený — používa pill buttons (správne podľa ADR-0018).

Combobox pre Typ/Kategória/Kondícia/Lokalita ostal — má inline create + typeahead
(per ADR-0018 to nie je use-case pre SelectField).

### 2. CI lint fixy (séria) ✅

Opravené `eslint --max-warnings 0` chyby ktoré padali kvôli husky revertu
(zmeny ostali na disku ale necommitnuté, CI bežalo na starom commite):

- `jsx-a11y/click-events-have-key-events` — SelectField options ako `<button>` (nie `<li onClick>`)
- `jsx-a11y/label-has-associated-control` — `<label>` bez `htmlFor` pri SelectField → `<span>` / `<div>`
- `import/order` — SelectField import pred UserEditDialog v UsersContent
- `no-undef` na `React` — `React.ReactNode` → `ReactNode` (type import) v OrganisationSettingsContent

### 3. Tenant billing dátový model ✅ (ADR-0019)

Fakturačné a právne údaje organizácie — vnorený `billing` objekt na Organisation.

**Shared-types (`common.ts`):** re-použiteľné schémy `AddressSchema`,
`IcoSchema` (8 číslic), `DicSchema` (10 číslic), `IcDphSchema` (SK+10,
normalizácia), `IbanSchema` (formát + normalizácia).

**Shared-types (`organisation.ts`):** `OrganisationBillingSchema`
(legalName, ico, dic, isVatPayer, icDph, businessRegistration, iban,
billingEmail, registeredAddress, mailingAddress) — všetko nullable,
povinnosť rieši billing flow. Pole `billing` na OrganisationSchema.
Automaticky v `UpdateOrganisationSchema` (`.partial()`).

**API (`organisations.routes.ts`):** `BillingBodySchema` + `AddressBodySchema`
pridané do POST aj PATCH. Nový `UpdateOwnOrganisationBodySchema` (SAFE subset).

**API (`organisations.service.ts`):** `getCurrent` + `updateCurrent`
(transakčné, audit ORGANISATION_UPDATED). `billing: null` v JIT provisioningu.

### 4. Tenant self-service billing UI ✅

**Endpointy:**

- `GET /v1/organisations/current` — ktorýkoľvek člen číta vlastnú org
- `PATCH /v1/organisations/current` — len ADMIN tenanta, SAFE subset

Bezpečnosť: org ID z `request.currentUser.organisationId` (JWT), nie z URL.

**Frontend:**

- `apps/web/src/app/settings/organisation/page.tsx` (nový) — AuthGate
- `apps/web/src/components/OrganisationSettingsContent.tsx` (nový) —
  ADMIN-gated, plán card + upgrade mailto CTA, formulár (Základné údaje,
  Fakturačné/právne, Sídlo, voliteľná Korešpondenčná adresa), SelectField
  pre krajinu, IČ DPH podmienené na isVatPayer
- `AppShell.tsx` — nav item „Organizácia" (Building2, adminOnly)
- `organisations-hooks.ts` — typy `BillingInfo`/`AddressInfo`, hooks
  `useCurrentOrganisation` + `useUpdateCurrentOrganisation`

---

## Rozhodnutia

- **Billing = vnorený objekt, nie kolekcia** — vzťah 1:1, žiadny vlastný
  životný cyklus (ADR-0019)
- **Registrácia ostáva jednoduchá** — fakturačné údaje self-service
  v `/settings/organisation`, nie pri onboardingu
- **Editácia len ADMIN tenanta** — cez `/current` endpoint, org z JWT
- **Plán upgrade = mailto zatiaľ** — platby pripojené neskôr
- **Schéma permisívna** — povinnosť (icDph pri platiteľovi DPH) rieši flow

---

## Čaká na ďalšiu session

- [ ] Testy pre `/current` endpointy (updateCurrent RBAC = len ADMIN,
      billing validácia, cross-tenant izolácia)
- [ ] Smoke test po deployi — `/settings/organisation` formulár,
      uloženie billing údajov, plán card
- [ ] Z minulých session: smoke test grouped categories, SelectField
      v tenants, MFA redirect, email_unique index na prod, SFZ login

---

**Commity:**

```
feat(web): group categories by asset type in Číselníky tab
feat(web): SelectField custom dropdown component + ADR-0018 + apply to TenantsContent
feat(web): replace all native <select> with SelectField across forms and lists
fix(web): a11y — SelectField options as button, label→span, import order, React no-undef
feat(shared-types): add billing schema to Organisation (ICO, DIC, IC DPH, address, IBAN)
feat(web): tenant organisation settings page + /current endpoints for self-service billing
```
