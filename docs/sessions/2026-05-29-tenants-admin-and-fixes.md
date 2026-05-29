<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-05-29 — Fixy, Tenants admin, Mobile nav

**Model:** Sonnet 4.6
**Trvanie:** ~6 hodín
**Výsledok:** 5 samostatných commitov, všetko green

---

## Čo sme riešili

### 1. MFA sessionStorage bug

**Symptom:** po email logine s MFA sa appka vrátila na /login s "Platnosť prihlásenia vypršala".

**Root cause:** `router.push('/login/mfa')` v Next.js App Router môže spustiť prefetch/render pred tým ako prehliadač zaručí viditeľnosť `sessionStorage.setItem`.

**Fix:** `window.location.href = '/login/mfa'` — full navigation garantuje poradie.

**Súbory:** `apps/web/src/components/LoginPage.tsx`

---

### 2. email_unique index fix

**Problém:** legacy globálny `email_unique` index blokoval dvoch userov z rôznych org s rovnakým emailom.

**Fix:**

- Migrácia `2026-05-29c-fix-email-unique-index.ts` — dropuje `email_unique` / `email_1` idempotentne
- `email-auth.routes.ts` — 3 cross-tenant `findOne` opravené:
  - Registrácia: hľadá len `accountType: 'LOCAL'`
  - `change-email`: scoped na `organisationId`
  - `confirm-email-change`: scoped na `organisationId`

**Súbory:** `apps/api/src/migrations/2026-05-29c-fix-email-unique-index.ts`, `runner.ts`, `email-auth.routes.ts`

---

### 3. Platform admin Tenants page

**Nová stránka** `/admin/tenants` — viditeľná len pre ADMIN (platform operátori).

**Funkcie:**

- Paginated list všetkých tenantov naprieč tenant boundary
- Filter by status (ACTIVE / SUSPENDED / ARCHIVED) + plan (FREE / PRO / ENTERPRISE)
- Client-side search by name / slug / email
- Edit dialog — displayName, plán, status, kontaktný email
- Create dialog — s auto-generovaním slugu z názvu
- Soft-delete (archive) s confirm

**Súbory:**

- `apps/web/src/components/TenantsContent.tsx` (nový)
- `apps/web/src/lib/organisations-hooks.ts` (nový) — TanStack Query hooks
- `apps/web/src/app/admin/tenants/page.tsx` (nový)
- `apps/web/src/components/AppShell.tsx` — nav item Tenanti + ShieldCheck ikona
- `apps/api/tests/integration/organisations.test.ts` (nový) — 30 testov

**CI fixy:**

- backdrop `<div onClick>` → `<button>` (jsx-a11y/click-events-have-key-events)
- `exactOptionalPropertyTypes`: spread pattern `...(x ? { key: x } : {})` namiesto `key: x || undefined`

---

### 4. Marketing site mobile nav fix

**Problém:** na 440px mobile sa do `.nav-right` nevlezú: Dokumentácia + GitHub + lang-switch + hamburger — lang switch vypadával z viewportu.

**Fix:**

- `shared.css` — `@media (max-width: 700px)`: `.nav-right .lang-switch { display: none }`
- `shared.js` — do `.nav-mobile-menu` pridaný riadok s SK/EN switcherom + "Otvoriť aplikáciu" CTA vedľa seba

**Výsledok:** navbar na mobile zobrazuje len logo + hamburger. Po kliknutí rozbalí menu so všetkými linkami + SK/EN + CTA.

---

## Commity

```
fix(web): use window.location.href for MFA redirect to guarantee sessionStorage commit
fix(api): drop legacy email_unique index + scope email conflict checks to tenant
feat: platform admin Tenants page and organisations integration tests
fix(web): a11y backdrop button in tenant dialogs + typecheck optional spread fix
fix(marketing): hide lang-switch in navbar on mobile, show in hamburger menu
docs: poupratuj — NEXT.md + session log
```

---

## Kľúčové rozhodnutia

- **backdrop ako `<button>`** — správny pattern pre modal overlay (ESLint a11y + keyboard support zadarmo)
- **`window.location.href` pre auth redirecty** — bezpečnejší ako SPA push pre security boundary
- **email conflict check scoped na tenant** — multi-tenant: rovnaký email v inej org je OK, blokujeme len duplicitu v rámci tej istej org. Výnimka: self-serve registrácia blokuje globálne pre LOCAL účty (UX guard, nie security)
- **`TenantsContent` backdropom ako `<button>`** — konzistentný vzor pre všetky dialogy v projekte
