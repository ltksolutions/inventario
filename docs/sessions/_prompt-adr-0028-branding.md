# Prompt do nového chatu — ADR-0028 implementácia (per-tenant branding)

> Skopíruj text nižšie (medzi čiarami) do nového chatu. Odporúčaný model: **Sonnet 4.6**
> (je to implementácia — CRUD/validácia/frontend/testy, nie architektúra).

---

Ahoj, pokračujeme na projekte **Inventario** (open-source white-label asset management,
`/Users/janletko/Documents/GitHub/inventario`, monorepo Fastify + MongoDB Atlas + TypeScript

- pnpm, Next.js 15 frontend, Vercel, production LIVE na `app.inventario.estate`).

**Dnešná úloha: implementovať ADR-0028 — per-tenant branding (logo + farby + font), end-to-end.**

Najprv si prosím prečítaj tieto súbory, kým začneš čokoľvek písať (cez Filesystem MCP, nie bash):

1. `docs/decisions/0028-per-tenant-branding.md` — celý ADR vrátane implementačného plánu (B1–B10). Toto je zadanie.
2. `docs/TODO.md` položka **#17** — zhrnutie rozsahu a fáz.
3. `docs/sessions/NEXT.md` — aktuálny stav projektu.
4. `packages/shared-types/src/schemas/organisation.ts` — `OrganisationBrandKitSchema` (Zod, zdroj pravdy).
5. `apps/api/src/modules/organisations/organisations.routes.ts` — **pozor, dôležité zistenie nižšie.**
6. `apps/web/src/components/OrganisationSettingsContent.tsx` — kde pribudne „Branding" sekcia.
7. `apps/web/src/lib/auth-context.tsx` — `AuthProvider`, kam pôjde runtime injekcia (B5).
8. `apps/web/src/app/layout.tsx` + `packages/design-tokens/src/tokens.css` — `--inv-brand-*` + `data-tenant` mechanika.

## Kľúčové zistenie z auditu (musíš s ním počítať)

V `organisations.routes.ts` existujú **dva** PATCH endpointy:

- `PATCH /v1/organisations/:id` (admin, platform-operator) — jeho `UpdateOrganisationBodySchema` **už `brandKit` prijíma** (cez lokálnu `BrandKitBodySchema`).
- `PATCH /v1/organisations/current` (tenant self-service, ADMIN tenantu) — jeho `UpdateOwnOrganisationBodySchema` má **iba** `displayName`, `primaryContactEmail`, `billing`. **Tu `brandKit` chýba** — a práve tento endpoint používa `/settings/organisation`.

Takže B3 = pridať `brandKit` do `UpdateOwnOrganisationBodySchema` (NIE do `/:id`, ten ho už má) + plán gating + WCAG validáciu. Pozor aj na to, že `BrandKitBodySchema` v route súbore je duplikovaná a **ešte nemá `logoDot`** — po B1 ju treba zladiť.

## Pracovné pravidlá (dôležité — dodržuj)

- **Filesystem MCP** je jediný spoľahlivý prístup k reálnemu disku. Bash sandbox je izolovaný — `ls`/`cat`/`find` z bashu NEVERIA reálnemu stavu. Na čítanie/zápis používaj `filesystem:*` nástroje. Tvoj `str_replace` ide na tvoj disk, nie môj — vždy `filesystem:edit_file`.
- `filesystem:edit_file` vyžaduje **bajtovo presný `oldText`** vrátane diakritiky a typografických znakov (— „ "). Pri väčších zmenách radšej `write_file` (celý prepis) a over `read_file`-om. Viacero editov toho istého súboru rob **sekvenčne**, nie naraz.
- **`exactOptionalPropertyTypes: true`** — voliteľné polia typuj `?: T | undefined`, conditional spread `...(x !== undefined ? { x } : {})`.
- **Testy s každou zmenou** (workflow pravidlo). Po každom kroku mi daj ready-to-copy príkazy: `pnpm typecheck` a `pnpm test` (alebo scoped variant).
- **Po zmene Zod schém / API route** treba pregenerovať openapi: `pnpm --filter @inventario/api openapi:export:offline` (VŽDY `:offline`, ide cez MongoMemoryServer; bez offline padne na reálny Atlas). Plný `pnpm test` (nie scoped) odhalí zaostalé unit fixtures. Regen je beh kódu → spúšťam ja, nie ty cez MCP.
- **Git:** lokálny git MCP len na READ (status/log/diff). Commit + push robím ja sám cez GitHub Desktop (GPG signing). Ty pripravíš zmeny + commit message. **Commit message header-only** (GitHub Desktop pridáva blank lines medzi bullets → commitlint `footer-leading-blank` fail). Ak treba telo, jeden krátky single-line paragraf bez bullets.
- Komunikuj **po slovensky**.

## Rozsah dnešného vývoja (z ADR-0028, v1)

Postupuj po fázach, commituj po logických celkoch (ja commitujem, ty pripravíš správu):

**Fáza 1 — schéma + backend (~1.5 dňa):**

- B1 — vyextrahovať `HexColorSchema` (dnes inline regex `/^#[0-9a-fA-F]{6}$/`), pridať `logoDot` (nullable, default null) do `OrganisationBrandKitSchema`. Zladiť/zredukovať JSON schému v `packages/design-tokens/src/brand-kit.schema.json`. Žiadna migrácia (len pribudne voliteľné pole).
- B2 — WCAG kontrast util v `apps/api` (relative luminance → pomer, sRGB linearizácia). Unit testy na hraničné páry (4.5:1 prah).
- B3 — `brandKit` do `UpdateOwnOrganisationBodySchema` (`/current`) + plán gating (FREE smie len `logoUrl`/`faviconUrl`, nie farby/font → 403) + WCAG validácia (`primary`+`primaryFg`, `accent`+`accentFg` pod 4.5:1 → 400) + logo URL check (HTTPS, best-effort Content-Type PNG/JPEG/WEBP, SVG → 400). Audit `ORGANISATION_BRANDING_UPDATED`.
- B4 — integračné testy: FREE smie logo / nesmie farby (403), Pro smie všetko, kontrast pod prah (400), SVG logo (400), happy path.

**Fáza 2 — runtime (~1 deň):**

- B5 — `BrandProvider` (alebo rozšírenie `AuthProvider`): po `/v1/auth/me` nastav `data-tenant` na `<html>` + vstrekni `<style id="inv-tenant-brand">` s `--inv-brand-*` (+ `--inv-font-family-sans` ak zadané). Prepis pri `switchOrg()`. Typovať `brandKit` (koniec `unknown` v `AvailableOrganisation`).
- B6 — logo v `AppShell` headeri: `<img src={logoUrl}>` s `onError` fallbackom na Inventario wordmark.

**Fáza 3 — admin UI (~1 deň):**

- B7 — „Branding" sekcia v `OrganisationSettingsContent`: logo URL + náhľad, farby (hex input/picker), font. Hydratácia z `org.brandKit`, uloženie cez rozšírený PATCH `/current`.
- B8 — živý náhľad + kontrast indikátor (zelená ✓ / červená ✗ s pomerom). Plán gating: FREE = farby/font vizuálne zamknuté s „🔒 Pro" CTA (existujúci `mailto` upgrade flow ako `PlanCard`).

**Fáza 4 — testy + docs (~0.5 dňa):**

- B9 — frontend testy (brand injekcia, gating, kontrast indikátor) podľa zavedeného vzoru. openapi regen (spustím ja).
- B10 — milestone/session doc + user-guide „Nastavenie loga a farieb". Aktualizuj NEXT.md a TODO.md (zatvor #17, presuň do milestone) — to je „poupratuj prosím" na konci.

## Rozhodnutia z ADR (nemenné, neotváraj ich znova)

Zod = zdroj pravdy (+`logoDot`, žiadna migrácia) · logo v1 = externá HTTPS URL (upload do Blob je v2, mimo dnešok) · farby/font klientsky cez `data-tenant` + `<style>` (FOUC akceptovaný v v1) · WCAG tvrdé odmietnutie <4.5:1 · **logo = všetky plány vrátane FREE, farby/font = Pro+** · SVG sa nedá použiť kvôli PDF (`loadLogo()` embeduje len PNG/JPEG/WEBP) — UI musí navádzať na PNG.

**Mimo dnešného rozsahu (v2, nerob):** upload loga do Vercel Blob, SSR/subdoména bez FOUC, dynamický favicon, dark-mode tenant override, `metadata` z JSON schémy.

## Na začiatku session

Over si aktuálny stav (`git:git_status` — má byť clean na `main`), prečítaj ADR-0028 a vyššie vymenované súbory, a potom mi navrhni, či ideme presne po B1→B10, alebo či si pri čítaní kódu našiel niečo, čo treba upraviť. Až potom začni B1.
