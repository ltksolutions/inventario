<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-05-30 — Billing bug fix + Tenant detail

## Kontext

Nadviazanie na rannú session (SelectField + billing model).
Objavený a opravený bug v registrácii, dokončený read-only tenant dialóg.

---

## Čo sa spravilo

### 1. Bug: IČO pri registrácii sa zahodilo

**Symptóm:** Janika zadala IČO pri registrácii, v `/settings/organisation` boli len placeholdery.

**Príčina:** `registration.routes.ts` aj `oauth.routes.ts` hodnotu `ico` z requestu vyparsovali
a zahodili — pri `insertOne` org dokumentu sa nikam nezapísala. `billing` objekt vtedy
ešte neexistoval (vznikol neskôr v rámci dnešnej session).

**Oprava — dva súbory:**

`apps/api/src/modules/auth/registration.routes.ts` (email cesta):

```typescript
billing: ico
  ? { legalName: orgName, ico, dic: null, isVatPayer: false, icDph: null,
      businessRegistration: null, iban: null, billingEmail: null,
      registeredAddress: null, mailingAddress: null }
  : null,
```

`apps/api/src/modules/auth/oauth.routes.ts` (SSO self-serve):

- `ico` pridaný do destrukturácie z `pendingOrg`
- rovnaký `billing` objekt pridaný do org insert

`oauth-state.ts` typ `pendingOrg` mal `ico?: string` už pred dneškom — žiadna zmena.

**Spätná kompatibilita:** existujúce org sa spätne neopravujú (hodnota nikdy neuložená).
Janika doplní IČO ručne v `/settings/organisation`.

---

### 2. TenantEditDialog — read-only billing sekcia

**Požiadavka:** platform admin má vidieť kompletné údaje tenanta; editovateľné sú len
Plán a Stav (+ Názov a Kontaktný email).

**Zmeny v `apps/web/src/components/TenantsContent.tsx`:**

- Dialóg: `max-w-md` → `max-w-lg`, `max-h-[90vh] overflow-y-auto`
- Podnadpis vysvetľuje read-only charakter ostatných údajov
- Nové komponenty vložené za `TenantEditDialog` (pred `TenantCreateDialog`):
  - `TenantReadOnlyDetails` — orchestrátor sekcií
  - `ReadOnlySection` — sekcia s nadpisom (uses `ReactNode`)
  - `ReadOnlyRow` — label + hodnota, voliteľný mono font, `—` fallback v tlmenej farbe
- Sekcie:
  - **Identifikácia** — slug (mono), dátum vytvorenia
  - **Fakturačné a právne údaje** — obchodné meno, IČO+DIČ (grid), platiteľ DPH+IČ DPH (grid),
    zápis v registri, IBAN (mono), fakturačný email
  - **Adresy** — sídlo + korešpondenčná (helper `formatAddress` → `ulica, PSČ mesto, krajina`)
- Import `ReactNode` pridaný (bol len `JSX`)

**Dátový tok overený:**

- `OrganisationsRepository.list()` — bez projekcie, vracia celý dokument vrátane `billing`
- `toApiShape()` v service — `{ ...doc, _id: String(doc._id) }`, billing prechádza
- `OrganisationSummary` typ na fronte — `billing: BillingInfo | null` (pridané v rannej session)

---

## Kľúčové rozhodnutia

- **Registrácia ukladá len `ico`** (nie celé billing) — kompromis: jednoduchá registrácia,
  zvyšok self-service. Konzistentné s ADR-0019.
- **TenantEditDialog read-only** — tenant admin nemôže meniť billing cez platform admin dialóg;
  platí cesta `/settings/organisation`. Platforma mení len plan/status.

---

## Čo zostalo (pre ďalšiu session)

- Testy pre `/current` endpointy (updateCurrent RBAC, billing validácia, cross-tenant izolácia)
- Smoke test po deployi (IČO pri registrácii, TenantEditDialog read-only sekcia)
- Pilot tenant onboarding (SFZ) pred Slice #5

---

## Commit message

```
feat: persist registration IČO into billing + read-only tenant detail
```

Header-only (commitlint quirk). Spája obe zmeny dňa do jedného commitu —
bug fix v registrácii (IČO → `billing.ico`, email + SSO) a read-only billing
sekciu v TenantEditDialog.
