<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session: ADR-0028 v2 — preset palety, Blob upload, font enum

| Atribút       | Hodnota                                                                           |
| ------------- | --------------------------------------------------------------------------------- |
| **Dátum**     | 2026-06-03                                                                        |
| **Modely**    | Opus 4.8 (architektúra), Sonnet 4.6 (implementácia)                               |
| **Rozsah**    | ADR-0028 v2: Vercel Blob upload, 10 WCAG preset paliet, font enum, gating zrušený |
| **Testy**     | 884/884 zelených (z toho +7 nových)                                               |
| **Web build** | 28/28 stránok OK                                                                  |

---

## Kontext

Po v1 implementácii (logo URL + voľné hex polia + voľný font string) sa ukázalo že
tenant má príliš veľa „slobody" na chybu — nečitateľný kontrast, font ktorý sa
nenačíta, preklep v hex, otázka kde zoženie HTTPS URL pre logo. v2 nahrádza voľné
vstupné polia riadeným výberom.

**Manuálne pred kódom (Janika):**

- Vercel Blob store `inventario-api-blob` vytvorený (Frankfurt fra1, **Public** access)
- `BLOB_READ_WRITE_TOKEN` pridaný do Vercel env (All Environments) + `.env.local`
- `@vercel/blob@2.4.0` a `@fastify/multipart` nainštalované cez pnpm

---

## Rozhodnutia v2

| #         | Rozhodnutie v1     | Revízia v2                                                        |
| --------- | ------------------ | ----------------------------------------------------------------- |
| Q2 Logo   | Externá HTTPS URL  | **Upload do Vercel Blob** (magic bytes validácia, 512 KB limit)   |
| Q3 Farby  | 6 voľných hex polí | **10 preset paliet** (WCAG AA overené testom, žiadna voľná farba) |
| Q3 Font   | Voľný string       | **Enum 5 fontov** (reálne načítané cez next/font/google)          |
| Q5 Gating | Farby/font = Pro+  | **Preset + logo + font = všetky plány** (žiadny gating)           |

**Rozhodnutie B (preset model):** Preset je „naplňovač" — backend skopíruje hex hodnoty
do `primary`/`primaryFg`/`accent`/`accentFg`/`logoDot`. `presetId` uložené ako informačné
pole. Dôvod: spätná kompatibilita (BrandProvider, protokoly, štítky čítajú hex) + determinizmus
(uložené hex sa nezmenia pri zmene presetu v kóde).

---

## Implementované bloky

### v2-B0 — Vercel Blob store (manuálne, Janika) ✅

- Blob store `inventario-api-blob`, Frankfurt fra1, Public access
- `BLOB_READ_WRITE_TOKEN` v Vercel env + `.env.local`

### v2-B1 — Presety + schéma ✅

- `packages/shared-types/src/brand-presets.ts` (NOVÝ)
  - `BRAND_PRESETS`: 10 paliet, všetky WCAG AA overené (min. forest-green primary 5.02:1)
  - `FONT_OPTIONS`: 5 fontov, `css` hodnoty = `var(--font-*)` referencie
  - Helpery: `getBrandPreset()`, `getFontCss()`, `BRAND_PRESET_IDS`, `FONT_OPTION_IDS`
- `OrganisationBrandKitSchema`: pridaný `presetId`, `fontFamilySans` zúžený na `z.enum(FONT_OPTION_IDS)`
- `packages/shared-types/tests/brand-presets.test.ts` (NOVÝ): 29 testov
  - WCAG invariant pre každý preset (20 assertov), hex validácia, font enum, helpery

### v2-B2 — Blob upload endpoint ✅

- `organisations.service.ts`:
  - Zrušený Pro+ gating (bol v `updateCurrent`)
  - Preset → hex expanzia: keď príde `presetId`, backend naplní hex polia z `getBrandPreset()`
  - Nová metóda `updateLogoUrl()` — zapíše Blob URL, vráti predošlú URL na zmazanie
- `organisations.routes.ts`:
  - `BrandKitBodySchema` aktualizovaný: `presetId`, font enum
  - `@fastify/multipart` registrovaný lokálne (limit: 512 KB, 1 súbor)
  - `POST /v1/organisations/current/logo`: magic bytes detekcia (PNG/JPEG/WEBP), HttpError throw pattern
  - Magic bytes detekcia: PNG (89 50 4E 47...), JPEG (FF D8 FF), WEBP (RIFF...WEBP)
  - Starý blob zmazaný best-effort (len pre `*.public.blob.vercel-storage.com` URL)
- `turbo.json`: `BLOB_READ_WRITE_TOKEN` do `globalEnv`

### v2-B3 — Font loading ✅

- `apps/web/src/app/layout.tsx`: `next/font/google` pre Inter, Open Sans, Roboto, Lato
  - CSS premenné `--font-inter`, `--font-open-sans`, `--font-roboto`, `--font-lato` na `<html>`
  - `display: 'swap'`, subsets `latin` + `latin-ext`, self-hosted (GDPR-friendly)
- `apps/web/src/lib/BrandProvider.tsx`: `getFontCss()` mapuje enum ID → `var(--font-*)` CSS string
  - `system-ui` a `null` = žiadny override (tokens.css default)

### v2-B4 — UI prepis ✅

- `organisations-hooks.ts`:
  - `BrandKit` interface: pridaný `presetId`
  - `useUploadLogo()`: multipart POST na `/v1/organisations/current/logo`
- `OrganisationSettingsContent.tsx` — Branding sekcia kompletne prepísaná:
  - **Logo**: file picker (hidden `<input type="file">`), náhľad `64×64` box, client-side validácia (typ + veľkosť), progress cez `useUploadLogo`
  - **Farby**: 10 preset kariet v 2-stĺpcovom gridu (swatch primary+accent, názov, `role=radio` + `aria-checked`)
  - **Náhľad**: CTA tlačidlá v primary/accent farbách vybraného presetu
  - **Font**: `<SelectField>` s 5 možnosťami
  - Vyhodené: hex pickery, voľný font input, `ContrastBadge`, `hexContrast`, FREE gating blok

### v2-B5 — Testy, ADR revízia, docs ✅

- `organisations-branding.test.ts`: kompletne prepísaný na v2 sémantiku
  - Logo URL happy/null, preset expanzia (presetId → hex), neznámy presetId → 400
  - Font enum: platná hodnota OK, neplatná → 400, FREE plán smie font
  - WCAG poistka: priame hex pod 4.5:1 → 400, SVG → 400, audit log
- `organisations-logo-upload.test.ts` (NOVÝ): 8 testov
  - RBAC: neautentizovaný → 401, EMPLOYEE → 403
  - Prázdny multipart → 400, HTML magic bytes → 400, >512 KB → 413
  - Happy path testy skipnuté bez `BLOB_READ_WRITE_TOKEN` (`it.skipIf`)
- ADR-0028: sekcia „Revízia v2" + aktualizovaný status
- OpenAPI regen: 57 paths, 84 endpoints
- Web build: 28/28 stránok

---

## Súbory zmenené

| Súbor                                                          | Zmena                                           |
| -------------------------------------------------------------- | ----------------------------------------------- |
| `packages/shared-types/src/brand-presets.ts`                   | NOVÝ                                            |
| `packages/shared-types/src/schemas/organisation.ts`            | `presetId`, font enum                           |
| `packages/shared-types/src/index.ts`                           | export brand-presets                            |
| `packages/shared-types/tests/brand-presets.test.ts`            | NOVÝ (29 testov)                                |
| `apps/api/src/modules/organisations/organisations.service.ts`  | preset expanzia, zruš gating, `updateLogoUrl()` |
| `apps/api/src/modules/organisations/organisations.routes.ts`   | `BrandKitBodySchema` v2, upload endpoint        |
| `apps/api/tests/integration/organisations-branding.test.ts`    | prepísaný na v2                                 |
| `apps/api/tests/integration/organisations-logo-upload.test.ts` | NOVÝ (8 testov)                                 |
| `apps/web/src/app/layout.tsx`                                  | next/font/google                                |
| `apps/web/src/lib/BrandProvider.tsx`                           | getFontCss mapovanie                            |
| `apps/web/src/lib/organisations-hooks.ts`                      | `presetId`, `useUploadLogo()`                   |
| `apps/web/src/components/OrganisationSettingsContent.tsx`      | Branding sekcia prepísaná                       |
| `apps/api/openapi.json`                                        | regen (57 paths, 84 endpoints)                  |
| `turbo.json`                                                   | `BLOB_READ_WRITE_TOKEN` do globalEnv            |
| `docs/decisions/0028-per-tenant-branding.md`                   | sekcia „Revízia v2"                             |

---

## Testovacie čísla

| Balík        | Pred | Po        |
| ------------ | ---- | --------- |
| shared-types | 99   | 128 (+29) |
| api          | 777  | 756\*     |
| Celkom       | 877  | 884       |

\*Branding test prepísaný: 21 v1 testov → nové v2 testy (menej, ale relevantnejšie)

---

## Dodatok — brand hlavička (počas živého testovania, 2026-06-03 večer)

Počas prvého reálneho testu (LTK tenant, nahraté logo + zvolená paleta) vyšli najavo
tri vizuálne nedostatky. Všetky vyriešené v 3 follow-up commitoch (čisto frontend,
žiadna zmena logiky/testov; build 28/28 zelený).

**Problém 1 — hlavička sa nefarbila podľa palety.** AppShell header bol napevno
`bg-surface-card` (biely). Podľa interactive-dema má byť v brand farbe.

- Rozhodnutie (po vizualizácii 3 možností): **varianta A** — celá lišta v `bg-brand-primary`,
  text/meno/role/switcher v `text-brand-primary-fg`, logo na **bielej zaoblenej dlaždici**
  (čitateľné na tmavom pozadí). Default tenant (bez brandu) = navy lišta = Inventario
  identita → žiadna regresia.
- `LogoutButton` ostal biely (`bg-surface-card`) — white-on-dark je čitateľný, sekundárna akcia.
- Switcher dropdown panel + mobile drawer ostali biele (sú to plávajúce panely mimo lišty).

**Problém 2 — zmena palety sa prejavila až po reloade.** `BrandProvider` číta brand
z `auth-context` (`availableOrganisations`), nie z TanStack query. PATCH/upload invalidoval
len query cache, nie auth kontext.

- Fix: `useUpdateCurrentOrganisation` + `useUploadLogo` v `onSuccess` volajú `refresh()`
  z `useAuth()` → `/v1/auth/me` sa načíta znova → `availableOrganisations` sa aktualizujú
  → `BrandProvider` useEffect prefarbí hlavičku/logo **okamžite, bez reloadu**.

**Problém 3 — vysoké/štvorcové logo natiahlo hlavičku.** `next/image` s `width={0}`

- `height={28}` nerespektoval výšku pri štvorcovom pomere strán.

* Fix: `TenantLogo` prepnutý z `next/image` na natívny `<img>` s napevno `height: 28px`,
  `width: auto`, `objectFit: contain`. Logo sa zoškáluje na výšku lišty bez ohľadu na
  pomer strán. (next/image aj tak bežal `unoptimized` → o nič sme neprišli; bonus: menší
  bundle, dashboard 143 → 137 kB.)
  - POZOR: projekt nemá `@next/next` ESLint plugin → `eslint-disable @next/next/no-img-element`
    by spadol na „rule not found“. Natívny `<img>` bez disable komentára je tu OK.
* Drobnosť: role v hlavičke zmenená z `/70` na `/80` opacity — čitateľnejšie na sýtych palách.

**Follow-up commity:**

- `9c0e3d0` — organisations-hooks (auto-refresh `refresh()` v onSuccess)
- `44d05d0` — AppShell (brand lišta, fix výšky loga, opacity role)

**Dotknuté súbory:** `apps/web/src/components/AppShell.tsx`, `apps/web/src/lib/organisations-hooks.ts`.

**Známe hraničné prípady (akceptované):**

- Biela dlaždica pod logom predpokladá logo s tmavým motívom (LTK/SFZ OK). Logo s bielym
  motívom + priehľadným pozadím by na bielej dlaždici „zmizlo“ — nie je to blocker, len
  odporúčanie nahrať logo s tmavým motívom.
- `themeColor` v `layout.tsx` ostal napevno navy `#1A2D47` (mobile URL bar tint) — je to
  `<meta>` riešený server-side pred resolveom tenanta, rovnaký FOUC kompromis ako pri farbách.

---

## Poznámky pre ďalšiu session

- **Happy path upload test** vyžaduje `BLOB_READ_WRITE_TOKEN` — lokálne funguje, CI skipne
- `loadLogo()` (ADR-0022) načítava logo z `brandKit.logoUrl` — po uploade do Blob bude URL
  z `*.public.blob.vercel-storage.com`, čo `loadLogo()` zvládne bez zmeny (verejná HTTPS URL)
- **SFZ onboarding**: nahrať PNG logo cez Settings → Branding → Nahrať logo; vybrať paletu
- Žiadna migrácia DB — `presetId` nullable default null, `fontFamilySans` enum nullable
