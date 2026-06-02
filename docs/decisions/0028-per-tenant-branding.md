<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0028. Per-tenant branding — logo, farby a font (end-to-end zapojenie)

|                   |                                                                                                                                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | ✅ Accepted — v1 implementovaný (2026-06-02), v2 implementovaný (2026-06-03)                                                                                                                                                                                                                         |
| **Dátum**         | 2026-06-02, rev. 2026-06-03                                                                                                                                                                                                                                                                          |
| **Autori**        | Ján Letko, Claude Opus 4.8 (LTK Solutions)                                                                                                                                                                                                                                                           |
| **Súvisiace ADR** | [0010 Multi-tenant white-label](0010-multi-tenant-white-label.md) (napĺňa „white-label" sľub), [0022 Loan protocol PDF](0022-loan-protocol-pdf.md) (logo v PDF), [0027 QR štítky](0027-qr-label-printing.md) (logo na štítku), [0019 Tenant billing](0019-tenant-billing-model.md) (branding ~ plán) |

## Kontext

ADR-0010 sľubuje white-label multi-tenant platformu — každý tenant (mesto, škola, klub,
zväz) má rozpoznateľnú vlastnú identitu. Verejné demo na `inventario.estate/interactive-demo`
to predvádza: prepínač **Inventario / Inter / Pezinok / Kremnica**, každý s vlastnou
farebnosťou a logom. To je nosný predajný argument produktu.

**Problém: v produkčnej aplikácii táto vrstva nie je zapojená.** Po audite kódu
(2026-06-02) je stav takýto:

- **Demo je statický mockup.** Farby tenantov v demo sú napevno v mockupe, nepochádzajú
  zo žiadneho behu aplikácie.
- **Existujú DVE nezhodné definície brand kitu** (viď nižšie) — jedna v Zod schéme
  (zdroj pravdy pre DB), druhá v JSON schéme v `design-tokens`. Rozchádzajú sa v tvare
  aj v poliach.
- **Design tokens majú celú override mechaniku pripravenú** (`--inv-brand-*` premenné +
  `:root[data-tenant='X']` pattern v `tokens.css`), ale tenant overrides sú tam len ako
  **zakomentovaný príklad**. Komentár hovorí „reálne overrides sa pumpujú do `<head>`
  dynamicky z brand-kit API" — tá injekcia nikde neexistuje.
- **Web app brand vôbec nečíta.** `layout.tsx` nemá `data-tenant`. `/v1/auth/me` vracia
  `availableOrganisations[].brandKit` ako `unknown` a zahodí sa. Žiadny komponent farby
  ani logo neaplikuje.
- **Logo sa reálne používa len v PDF** (protokoly ADR-0022, štítky ADR-0027) cez
  `loadLogo()`, ktorý číta `brandKit.logoUrl`. Keďže `logoUrl` sa nedá nikde nastaviť,
  vždy padá na default Inventario logo. **Dôsledok pre SFZ pilot: protokoly a štítky
  pôjdu s logom Inventario, nie SFZ.**
- **`/settings/organisation` branding neponúka** — edituje len displayName, kontakt,
  fakturáciu a QR found-kontakt. `brandKit` sa tam nerendruje ani neposiela.

Toto ADR rieši **zjednotenie a end-to-end zapojenie** per-tenant brandingu: jeden zdroj
pravdy pre brand kit, admin UI na jeho nastavenie (vrátane loga), runtime aplikácia farieb
a fontu vo web aplikácii, a konzistentné použitie loga v PDF výstupoch.

Treba rozhodnúť **šesť vecí**:

1. **Ktorá schéma je zdroj pravdy** a ako zjednotiť dve nezhodné definície.
2. **Kde fyzicky žije logo** — URL na cudzí hosting, alebo upload do nášho úložiska.
3. **Ako sa farby/font aplikujú za behu** bez bliknutia nesprávnej farby (FOUC).
4. **Validácia kontrastu** (WCAG) — kde a ako prísne.
5. **Ktoré plány** majú nárok na branding (väzba na ADR-0019).
6. **Rozsah pre prvú iteráciu** vs. čo odložiť.

### Obmedzenia

- **Vercel serverless, žiadne trvalé úložisko na disku.** Ak má logo žiť „u nás", musí to
  byť objektové úložisko (Vercel Blob / S3-kompatibilné), nie filesystém Vercel funkcie.
- **`loadLogo()` (ADR-0022) vie načítať logo IBA z HTTP(S) URL** a akceptuje len
  PNG/JPEG/WEBP — **nie SVG** (pdf-lib SVG neembeduje). Akékoľvek riešenie loga musí
  vyústiť do rastrovej HTTPS URL, inak PDF logo nedostane.
- **SSR + FOUC.** Next.js servuje HTML skôr, než klient zistí aktívny tenant cez
  `/v1/auth/me`. Ak sa farby aplikujú až po hydratácii, používateľ uvidí bliknutie
  default (navy) brandu pred prepnutím na tenant farby. Riešenie musí FOUC minimalizovať.
- **Override IBA brand vrstvy.** Primitive a semantic vrstvy design-tokens ostávajú
  stabilné naprieč tenantmi (predvídateľné UI). Tenant smie meniť len `--inv-brand-*`
  (+ font). Toto je tvrdé pravidlo z `tokens.css` a BRAND.md §8.
- **WCAG 2.1 AA.** Brand farby sa používajú na CTA, navigáciu, odkazy. Zlá kombinácia
  (napr. svetložltá na bielej) rozbije čitateľnosť a prístupnosť. JSON schéma už deklaruje
  „backend odmietne payload s kontrastom < 4.5:1" — ale enforcement neexistuje.
- **Forky (ADR-0010).** Self-hosted fork má vlastné default branding; mechanizmus nesmie
  závisieť od centrálneho Inventario CDN.
- **GDPR / obsah loga.** Tenant nahráva vlastný obsah; sme spracovateľ. Logo je nízke
  riziko, ale upload pipeline musí mať limit veľkosti a typu (anti-abuse).
- **Pilot nie je blokovaný.** SFZ pilot funguje aj s default brandom. Toto je hodnotová
  featura a fix nezhody, nie launch blocker — ale logo na protokoloch/štítkoch je viditeľný
  detail, ktorý pilotný tenant ocení.

### Existujúci stav (audit 2026-06-02)

| Komponent                                            | Stav                                                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zod `OrganisationBrandKitSchema`                     | Ploché polia: `logoUrl`, `faviconUrl`, `primary`, `primaryFg`, `accent`, `accentFg`, `fontFamilySans`. **Zdroj pravdy v DB.**                           |
| JSON `brand-kit.schema.json` (design-tokens)         | Vnorené: `colors.{primary,primaryFg,accent,accentFg,logoDot}`, `typography.fontFamilySans`, `tenantId`, `version`, `metadata`. **Nezhoduje sa so Zod.** |
| `tokens.css` `--inv-brand-*` + `data-tenant` pattern | Mechanika hotová, tenant overrides **zakomentované** (príklad). Injekcia neexistuje.                                                                    |
| `loadLogo()` (apps/api protocols)                    | Funguje, číta `brandKit.logoUrl`, fallback default. Akceptuje PNG/JPEG/WEBP, **nie SVG**.                                                               |
| `/v1/auth/me`                                        | Vracia `availableOrganisations[].brandKit` ako `unknown` — **klient ho zahadzuje**.                                                                     |
| `layout.tsx` / web runtime                           | **Žiadny `data-tenant`, žiadna aplikácia brandu.**                                                                                                      |
| `/settings/organisation`                             | Brandingové polia **chýbajú** v UI aj v PATCH whiteliste.                                                                                               |
| `PATCH /v1/organisations/current`                    | SAFE subset: `displayName`, `primaryContactEmail`, `billing`, `foundContactInfo`. **`brandKit` mimo.**                                                  |

## Možnosti — kľúčové rozhodnutia

### Q1: Zdroj pravdy pre brand kit (zjednotenie dvoch schém)

#### Možnosť A: Zod schéma je zdroj pravdy, JSON schéma sa zosúladí s ňou (selected)

`OrganisationBrandKitSchema` (Zod) ostáva kanonická — žije v nej DB, validuje ju backend.
JSON schéma v `design-tokens` sa buď zladí (rovnaké ploché polia), alebo sa z nej stane
len build-time referencia pre runtime CSS generátor. `logoDot` z JSON schémy sa pridá do
Zod ako voliteľné pole (default = accent).

- **Plus:** Jeden zdroj pravdy, ktorý už drží produkčné dáta. Backend Zod validácia je
  to, čo reálne beží. Žiadna migrácia tvaru dát.
- **Mínus:** JSON schéma sa musí prepísať/zúžiť; treba dať pozor, aby `design-tokens`
  runtime generátor čítal správny tvar.

#### Možnosť B: JSON schéma (vnorená) je zdroj pravdy, Zod sa prepíše

- **Plus:** Vnorená štruktúra (`colors.*`, `typography.*`) je čistejšia, má `version` pre migrácie.
- **Mínus:** Vyžaduje migráciu DB dát (ploché → vnorené) a prepis `loadLogo()` + všetkých
  čitateľov. Väčší blast radius pre kozmetický zisk.

**Rozhodnutie: Možnosť A.** Zod je zdroj pravdy. Pridáme chýbajúce `logoDot` (voliteľné,
default accent) do Zod schémy a JSON schému zredukujeme na build-time referenciu pre CSS
generátor (alebo ju zahodíme, ak ju nič nepoužíva). Tvar dát v DB sa nemení → žiadna migrácia.

### Q2: Kde žije logo — externá URL vs. vlastný upload

#### Možnosť A: Len externá HTTPS URL (MVP, selected pre v1)

Admin vloží URL na logo, ktoré si hostuje sám (web, CDN). Presne to, čo `loadLogo()` dnes
očakáva. Validácia: HTTPS, dosiahnuteľné, Content-Type PNG/JPEG/WEBP.

- **Plus:** Nula novej infraštruktúry. Okamžite kompatibilné s `loadLogo()` a CSS
  (`logoUrl` v `<img>`). Odomkne SFZ pilot dnes (SFZ má logo na svojom webe).
- **Mínus:** Tenant musí mať kde logo hostovať. Riziko mŕtvych URL (logo zmizne).
  SVG sa nedá použiť (PDF ho neembeduje) — UI musí navádzať na PNG.

#### Možnosť B: Upload do objektového úložiska (Vercel Blob / S3)

Drag-and-drop v UI → upload endpoint → uloženie do Blob → vrátime HTTPS URL, ktorá sa
zapíše do `logoUrl`.

- **Plus:** Plná kontrola, žiadne mŕtve URL, lepší UX. Môžeme robiť server-side resize/normalizáciu na PNG.
- **Mínus:** Nová infraštruktúra (Blob storage, upload endpoint, multipart, limity veľkosti,
  čistenie sirôt pri zmene loga). Náklady + bezpečnosť (anti-abuse). Pre forky treba
  konfigurovateľné úložisko.

#### Možnosť C: Oboje — URL teraz, upload neskôr

v1 = URL (Možnosť A). v2 = pridáme upload (Možnosť B) ako pohodlnejšiu alternatívu;
oba zápisy končia rovnako — HTTPS URL v `logoUrl`. Upload je čisto UX nadstavba.

- **Plus:** Hodnota hneď, bez infraštruktúrneho dlhu. Upload sa pridá keď bude dopyt,
  bez prepisu dátového modelu (cieľ je vždy `logoUrl`).
- **Mínus:** Tenant v1 musí logo niekde mať.

**Rozhodnutie: Možnosť C.** v1 = externá URL (okamžite kompatibilné s `loadLogo()` aj CSS,
odomkne pilot). Upload (Vercel Blob) je samostatná v2 featura — keďže cieľový tvar je vždy
`logoUrl: HTTPS`, upload sa pridá bez migrácie. Pre v1 UI jasne navádza: PNG/JPEG, odporúčané
256×256, HTTPS, **nie SVG** (kvôli PDF).

### Q3: Runtime aplikácia farieb/fontu — ako a kedy (FOUC)

#### Možnosť A: Klientská injekcia po `/v1/auth/me` (selected pre v1)

`AuthProvider` už ťahá `availableOrganisations[].brandKit`. Po vyriešení aktívneho tenanta
sa nastaví `data-tenant` na `<html>` a vstrekne `<style>` blok s `--inv-brand-*` override-mi
(z brandKit farieb), prípadne `--inv-font-family-sans`. Pred-login a default tenant = žiadny
override (Inventario default).

- **Plus:** Žiadna SSR zmena, využije existujúci auth flow. Jednoduché. Brand vrstva je
  navrhnutá presne na toto (override len `--inv-brand-*`).
- **Mínus:** **FOUC** — kým sa `/v1/auth/me` vyrieši, UI je default navy; potom blikne na
  tenant farby. Pre prihlásenú appku (nie marketing) je to znesiteľné, ale viditeľné.

#### Možnosť B: SSR/middleware podľa subdomény, farby v prvom HTML

Tenant sa rozpozná zo subdomény (`sfz.inventario.estate`) v Next.js middleware/SSR,
brand sa načíta server-side a `data-tenant` + `<style>` sú už v prvom HTML. Žiadny FOUC.

- **Plus:** Žiadne bliknutie, profesionálny dojem. Najlepší UX.
- **Mínus:** Vyžaduje subdoména→tenant rozlíšenie na serveri (DNS/routing model), server-side
  fetch brandu pred renderom, a riešenie pre custom domény (ADR-0010). Väčšia práca,
  závislé na tom, ako je nasadené tenant routovanie.

#### Možnosť C: Cookie cache posledného brandu + revalidácia

Pri prvom načítaní default; po prvom `/v1/auth/me` sa brand uloží do cookie, ďalšie načítania
servujú brand z cookie už v SSR (žiadny FOUC pri opakovaných návštevách), revaliduje sa klientsky.

- **Plus:** Kompromis — FOUC len pri úplne prvej návšteve, potom nie.
- **Mínus:** Cookie/SSR komplexita, stale brand kým sa nerevaliduje.

**Rozhodnutie: Možnosť A pre v1, s cestou na B/C neskôr.** Klientská injekcia odomkne
featuru rýchlo a využije existujúci `AuthProvider`. FOUC je v prihlásenej appke prijateľný
(používateľ je za login bránou, nie je to verejná landing). Ak sa FOUC ukáže ako rušivý,
v2 = cookie cache (C) alebo SSR podľa subdomény (B). Rozhodnutie nezavrhuje B — len ho
odkladá, lebo závisí od tenant-routing modelu, ktorý je samostatná téma.

### Q4: Validácia kontrastu (WCAG)

#### Možnosť A: Tvrdé odmietnutie pod 4.5:1 (ako deklaruje JSON schéma)

Backend pri PATCH-i spočíta kontrast `primary` vs `primaryFg` (a `accent` vs `accentFg`)
a odmietne payload pod 4.5:1.

- **Plus:** Garantuje prístupnosť. Tenant nemôže rozbiť čitateľnosť.
- **Mínus:** Môže frustrovať (tenant chce svoju presnú farbu, ktorá tesne nevyhovie).
  Treba dobrý error message s návrhom.

#### Možnosť B: Varovanie, ale povolenie (soft)

UI ukáže varovanie „tento kontrast je pod AA", ale uloženie povolí.

- **Plus:** Tenant má slobodu. Menej friction.
- **Mínus:** Rozbitá prístupnosť je na nás (sme platforma). Niektorí tenanti (verejná správa)
  majú zákonnú povinnosť WCAG — povoliť im rozbiť to je medvedia služba.

**Rozhodnutie: Možnosť A — tvrdé odmietnutie pod 4.5:1**, s jasným error message a
živým náhľadom + indikátorom kontrastu v UI (aby tenant videl problém pred uložením).
Verejná správa je cieľová skupina (ADR-0010) a má WCAG povinnosť — chrániť ju je správne.
Foreground polia (`primaryFg`, `accentFg`) majú rozumný default (biela/navy), takže bežný
tenant zadá len `primary`/`accent` a kontrast vyjde.

### Q5: Branding a plán (väzba na ADR-0019)

JSON schéma aj `PLAN_DESCRIPTIONS` v UI naznačujú, že vlastný branding je **Pro+** featura
(„PRO: Vlastný branding..."). Treba rozhodnúť, či logo/farby gate-ovať za plán.

- **Rozhodnutie:** **Logo** (`logoUrl`) je dostupné **všetkým plánom vrátane FREE** — je to
  základná identita a viditeľné na protokoloch/štítkoch, ktoré FREE tenant (SFZ pilot) reálne
  používa. **Farby + font** sú **Pro+** (vizuálny white-label), v súlade s `PLAN_DESCRIPTIONS`.
  Gating sa robí v backend PATCH validácii (FREE smie meniť `logoUrl`, nie `primary`/`accent`/`font`)
  a v UI (farby zamknuté s CTA „dostupné v Pro"). Toto je **predajný hák** — branding je dôvod
  na upgrade. Pozn.: SFZ pilot je FREE → dostane vlastné logo (rieši hlavnú bolesť), farby nie.
  Ak pilot potrebuje aj farby, dočasne sa povýši plán (manuálne, billing zatiaľ nie je napojený).

### Q6: Rozsah v1 vs. odložené

**v1 (toto ADR, implementačný plán nižšie):**

- Zjednotenie schémy (Q1): `logoDot` do Zod, JSON schéma zredukovaná na referenciu.
- Logo cez externú URL (Q2 Možnosť A) — vrátane validácie a navádzania na PNG.
- `/settings/organisation` rozšírené o „Branding" sekciu (logo URL, farby, font) s plán gatingom.
- `PATCH /v1/organisations/current` rozšírené o `brandKit` (s WCAG validáciou + plán gatingom).
- Runtime aplikácia farieb/fontu klientsky (Q3 Možnosť A) — `data-tenant` + injektovaný `<style>`.
- Logo v hlavičke web appky (AppShell) — `<img>` z `logoUrl`, fallback Inventario wordmark.
- Logo v PDF už funguje (`loadLogo()`) — len ho odomkne fakt, že `logoUrl` sa dá nastaviť.
- Živý náhľad + kontrast indikátor v UI.

**Odložené (v2+):**

- Upload loga do Vercel Blob (Q2 Možnosť B).
- SSR/subdoména brand bez FOUC (Q3 Možnosť B/C).
- `faviconUrl` aplikácia (dynamický favicon per tenant).
- Dark-mode tenant override (tenant si ladí brand v oboch režimoch).
- `metadata` z JSON schémy (notes, createdBy) — audit nadstavba.

## Rozhodnutie

| #   | Rozhodnutie                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Zod `OrganisationBrandKitSchema` = zdroj pravdy.** `logoDot` doplnené (voliteľné). JSON schéma → referencia. Žiadna migrácia. |
| 2   | **Logo v1 = externá HTTPS URL** (PNG/JPEG/WEBP, nie SVG). Upload do Blob je v2.                                                 |
| 3   | **Farby/font sa aplikujú klientsky** po `/v1/auth/me` cez `data-tenant` + injektovaný `<style>`. FOUC akceptovaný v v1.         |
| 4   | **WCAG: tvrdé odmietnutie pod 4.5:1** na backend-e + živý kontrast indikátor v UI.                                              |
| 5   | **Logo = všetky plány (aj FREE). Farby + font = Pro+.** Gating v backend validácii + UI.                                        |
| 6   | **v1 = URL logo + farby/font + runtime + UI + WCAG.** Upload, SSR-no-FOUC, favicon, dark-mode override = v2.                    |

## Detailný design

### Dátový model (Zod, zjednotené)

`OrganisationBrandKitSchema` ostáva ploché, pridá sa `logoDot`:

```typescript
// packages/shared-types/src/schemas/organisation.ts
export const OrganisationBrandKitSchema = z
  .object({
    logoUrl: z.string().url().nullable().default(null),
    faviconUrl: z.string().url().nullable().default(null),
    primary: HexColorSchema.nullable().default(null),
    primaryFg: HexColorSchema.nullable().default(null),
    accent: HexColorSchema.nullable().default(null),
    accentFg: HexColorSchema.nullable().default(null),
    logoDot: HexColorSchema.nullable().default(null), // NOVÉ — default = accent
    fontFamilySans: z.string().max(200).nullable().default(null),
  })
  .strict();
```

`HexColorSchema` = vyextrahovaný `z.string().regex(/^#[0-9a-fA-F]{6}$/)` (dnes inline).
Tvar v DB sa nemení (len pribudne voliteľné pole s default null) → **migrácia netreba**.

### Backend — PATCH rozšírenie + validácia

`PATCH /v1/organisations/current` SAFE subset sa rozšíri o `brandKit`. Pred uložením:

1. **Plán gating:** ak `org.plan === FREE` a payload mení `primary`/`primaryFg`/`accent`/`accentFg`/`logoDot`/`fontFamilySans` → 403 s message „Vlastné farby a font sú dostupné v pláne Pro". `logoUrl`/`faviconUrl` povolené pre všetky plány.
2. **WCAG kontrast:** ak sú zadané `primary`+`primaryFg`, spočítaj kontrast; pod 4.5:1 → 400 s konkrétnym pomerom a návrhom. To isté pre `accent`+`accentFg`.
3. **Logo URL:** ak zadané `logoUrl`, over HTTPS + (voliteľne, best-effort) HEAD request na Content-Type PNG/JPEG/WEBP; SVG odmietni s vysvetlením (PDF ho neembeduje).
4. Audit log `ORGANISATION_BRANDING_UPDATED`.

Kontrast helper: štandardný WCAG relatívny jas (relative luminance) → pomer. Malý čistý
util v `apps/api`, plne testovateľný (žiadna závislosť).

### Runtime aplikácia (web)

Nový klientský komponent `BrandProvider` (alebo rozšírenie `AuthProvider`):

```
po vyriešení aktívneho tenanta z /v1/auth/me:
  brandKit = aktívna organizácia .brandKit
  ak brandKit má farby/font:
    document.documentElement.setAttribute('data-tenant', org.slug)
    vstrekni <style id="inv-tenant-brand">:
      :root[data-tenant='<slug>'] {
        --inv-brand-primary: <primary>;
        --inv-brand-primary-fg: <primaryFg>;
        --inv-brand-accent: <accent>;
        --inv-brand-accent-fg: <accentFg>;
        --inv-brand-logo-dot: <logoDot ?? accent>;
        --inv-font-family-sans: <fontFamilySans>;   // ak zadané
      }
  inak: žiadny override (Inventario default)
```

Override sa drží **iba na `--inv-brand-*`** (+ font) — primitive/semantic sa nedotýka.
Pri `switchOrg()` sa `<style>` prepíše novým tenantom. Logo v `AppShell` headeri = `<img src={logoUrl}>` s fallbackom na Inventario wordmark, keď `logoUrl` je null.

### Admin UI — `/settings/organisation` „Branding" sekcia

Nová `Section title="Branding"`:

- **Logo URL** — text input, hint „HTTPS, PNG/JPEG, odporúčané 256×256, nie SVG". Náhľad obrázka.
- **Primárna farba** + **text na primárnej** — color picker / hex input. Pri FREE zamknuté s „🔒 Pro".
- **Akcentová farba** + **text na akcente** — detto.
- **Font** (voliteľné) — text input s hint na fallback.
- **Živý náhľad** — malá karta/tlačidlo renderované zvolenými farbami + indikátor kontrastu
  (zelená ✓ / červená ✗ s pomerom), aby tenant videl WCAG výsledok pred uložením.

Gating: pre FREE plán sú farby/font vizuálne zamknuté s CTA „Vlastné farby sú v Pro" →
existujúci `mailto` upgrade flow (ako `PlanCard`).

### PDF/štítky

Žiadna zmena kódu — `loadLogo()` už číta `brandKit.logoUrl`. Featura ho len **odomkne**
tým, že `logoUrl` sa dá konečne nastaviť. Po nastavení SFZ loga pôjdu protokoly aj štítky
s logom SFZ namiesto default Inventario. (Overiť: SFZ logo ako PNG na HTTPS, nie SVG.)

## Implementačný plán (Slice — návrh ~3–4 dni)

### Fáza 1: Schéma + backend (Sonnet, ~1.5 dňa)

| Blok | Popis                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1   | `OrganisationBrandKitSchema`: vyextrahovať `HexColorSchema`, pridať `logoDot`. JSON schéma v design-tokens zladiť/zredukovať. Regen typov.                                            |
| B2   | WCAG kontrast util (`apps/api/.../lib/contrast.ts`) — relative luminance → pomer. Unit testy (hraničné páry).                                                                         |
| B3   | `PATCH /v1/organisations/current` — `brandKit` do SAFE subsetu + plán gating (FREE = len logo) + WCAG validácia + logo URL/Content-Type check. Audit `ORGANISATION_BRANDING_UPDATED`. |
| B4   | Integračné testy: FREE smie logo / nesmie farby (403), Pro smie všetko, kontrast pod prah (400), SVG logo (400), happy path.                                                          |

### Fáza 2: Runtime aplikácia (Sonnet, ~1 deň)

| Blok | Popis                                                                                                                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B5   | `BrandProvider` (alebo rozšírenie `AuthProvider`): po `/v1/auth/me` nastaví `data-tenant` + vstrekne `<style>` s `--inv-brand-*` (+ font). Prepis pri `switchOrg`. Typovať `brandKit` (koniec `unknown`). |
| B6   | Logo v `AppShell` headeri — `<img>` z `logoUrl`, fallback Inventario wordmark.                                                                                                                            |

### Fáza 3: Admin UI (Sonnet, ~1 deň)

| Blok | Popis                                                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B7   | „Branding" sekcia v `OrganisationSettingsContent`: logo URL + náhľad, farby (hex/picker), font. Hydratácia z `org.brandKit`, uloženie cez rozšírený PATCH. |
| B8   | Živý náhľad + kontrast indikátor (zdieľa logiku s B2, frontend verzia). Plán gating (FREE = farby zamknuté + Pro CTA).                                     |

### Fáza 4: Testy + docs (Sonnet/Haiku, ~0.5 dňa)

| Blok | Popis                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| B9   | Frontend testy (brand injekcia, gating, kontrast indikátor) podľa zavedeného vzoru. openapi regen ak sa dotklo schém endpointu. |
| B10  | Milestone/session doc + user-guide „Nastavenie loga a farieb". NEXT.md/TODO.md update.                                          |

**Po dokončení (manuálne, mimo kódu):** SFZ tenantovi nastaviť `logoUrl` na PNG loga SFZ →
overiť protokoly aj štítky. Ak pilot chce aj farby, dočasne povýšiť plán.

## Dôsledky

### Pozitívne

- **Naplnený white-label sľub (ADR-0010).** Demo prestane byť mockup-only — reálni tenanti
  dostanú vlastnú identitu.
- **Vyriešená nezhoda dvoch schém** — jeden zdroj pravdy, koniec divergencie.
- **SFZ pilot dostane vlastné logo** na protokoloch a štítkoch (hlavná viditeľná bolesť).
- **Branding ako predajný hák** — farby/font v Pro plánoch dávajú konkrétny dôvod na upgrade
  (väzba na ADR-0019 billing).
- **Žiadna migrácia** — Zod tvar sa nemení, len pribudne voliteľné pole.
- **WCAG enforcement** — verejná správa (cieľová skupina) dostane prístupné UI by-default.
- **Malý blast radius** — logo v PDF už funguje; väčšina práce je „zapojiť existujúce".

### Negatívne / kompromisy

- **FOUC v v1** — bliknutie default → tenant farby pri prvom načítaní. Akceptované za login
  bránou; v2 to rieši SSR/cookie.
- **Logo len cez URL v v1** — tenant musí mať kde hostovať. Upload je až v2.
- **SVG sa nedá použiť** kvôli PDF — UI musí jasne navádzať na PNG, inak frustrácia.
- **Plán gating pridáva vetvenie** do PATCH validácie (FREE vs Pro) — treba testovať obe cesty.
- **Klientská injekcia `<style>`** je „dosť dobré", nie elegantné; v2 SSR je čistejšie.

### Riziká, ktoré treba sledovať

- **Mŕtve logo URL** — tenant zruší hosting, logo zmizne z PDF aj UI. `loadLogo()` má fallback,
  UI `<img>` potrebuje `onError` fallback. v2 upload to odstráni.
- **Kontrast util presnosť** — WCAG luminance musí byť správne (sRGB linearizácia). Pokryť testami.
- **FOUC vnímanie** — ak bude rušivý skôr než čakáme, posunúť v2 (cookie cache) dopredu.
- **Custom domény (ADR-0010)** — pri SSR brand (v2) bude treba subdoména/doména → tenant
  rozlíšenie; v1 klientský prístup to obchádza (brand z `/v1/auth/me`, nie z domény).

## Otvorené otázky / odložené veci

| #   | Otázka                                              | Decision (deferral)                                            |
| --- | --------------------------------------------------- | -------------------------------------------------------------- |
| 1   | Upload loga do Vercel Blob                          | v2. Cieľový tvar je `logoUrl` → pridá sa bez migrácie.         |
| 2   | SSR/subdoména brand bez FOUC                        | v2. Závislé na tenant-routing modeli (custom domény).          |
| 3   | Dynamický favicon per tenant (`faviconUrl`)         | v2. Pole existuje, aplikácia odložená.                         |
| 4   | Dark-mode tenant override                           | v2. `tokens.css` to podporuje, UI zatiaľ nie.                  |
| 5   | `metadata` (notes, createdBy) z JSON schémy         | Odložené — audit nadstavba, nie nutná pre funkčnosť.           |
| 6   | Per-tenant font upload (vlastný webfont)            | Out of scope. v1 = názov fontu z dostupných/systémových.       |
| 7   | Náhľad brandu „naživo" na celej appke pred uložením | Odložené — v1 má lokálny náhľad (karta), nie full-app preview. |

## Revízia v2 (2026-06-03) — preset paléty, Blob upload, font enum

**Dôvod revízie:** Po v1 implementácii (logo URL + voľné hex polía + voľný font string) sa
ukázalo že tenant má príliš veľa „spobody“ na chybu — nečitateľný kontrast, font
ktorý sa nenačíta, preklep v hex, otázka kde zoženie HTTPS URL pre logo.
Revízia nahrádza voľné vstupné polía riadeným výberom.

### Zmeny oproti v1

| #         | Rozhodnutie v1                                                           | Revízia v2                                                                                                |
| --------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Q2 Logo   | Externá HTTPS URL (tenant si hostuje)                                    | **Upload do Vercel Blob** (public store, región fra1). Backend validuje magic bytes + veľkosť.            |
| Q3 Farby  | 6 voľných hex polí (`primary`/`primaryFg`/`accent`/`accentFg`/`logoDot`) | **10 preset paliet** (WCAG AA overené testom). Tenant vyberá z kariet, žiadna voľná farba.                |
| Q3 Font   | Voľný string (možnosť zadať font čo sa nenačíta)                         | **Enum 5 fontov** (`system-ui`, Inter, Open Sans, Roboto, Lato) — reálne načítané cez `next/font/google`. |
| Q5 Gating | Logo = všetky plány; farby + font = Pro+                                 | **Logo + preset + font = všetky plány** (žiadny Pro+ gating). Branding odomknutý pre všetkých.            |

### Architektonické rozhodnutie B (preset model)

Preset je **"naplňovač"** existujúcich hex polí, nie ich náhrada. Backend pri výbere
presetu SKOPÍRUJE jeho hex hodnoty do `primary`/`primaryFg`/`accent`/`accentFg`/`logoDot`.
`presetId` sa uloží ako informačné pole (UI vie zvýrazniť vybranú kartu).

**Dôvod:** Spätná kompatibilita — `BrandProvider`, protokoly (ADR-0022), štítky (ADR-0027)
čítajú hex ako doteraz bez zmeny. Determinizmus — uložené hex sa nezmenia ani keď sa
upraví definícia presetu v kóde (kritické pre reprodukovateľnosť protokolov).

### WCAG invariant (vynútený testom)

Každý preset musí splňať `contrastRatio(primary, primaryFg) >= 4.5`
a `contrastRatio(accent, accentFg) >= 4.5`. Test `brand-presets.test.ts` to overí
pre všetkých 10 paliet. Paleta čo neprejde sa fyzicky nedostane do kódu.
WCAG poistka na backende ostáva pre priame hex vstupy cez API (mimo UI).

### Dopad na dátový model

`OrganisationBrandKitSchema` dostáva:

- `presetId: z.string().max(64).nullable().default(null)` — ID vybratej palety
- `fontFamilySans` zúžený z `z.string().max(200)` na `z.enum(FONT_OPTION_IDS)`

Žiadna migrácia existujúcich dát — žiadny SFZ pilot tenant v prode ešte nemá
vyplnený `brandKit` (overené pred implementáciou).

### Logo upload (Vercel Blob)

Nový endpoint `POST /v1/organisations/current/logo` (multipart):

- Validácia magic bytes (nie deklarovaný Content-Type — bezpečnostná poistka)
- Limit 512 KB, povolené: PNG/JPEG/WEBP, nie SVG
- Upload do Vercel Blob public store (región fra1, EU GDPR)
- Blob URL zapisaná do `brandKit.logoUrl`
- Starý blob zmazaný pri nahradení (best-effort)
- `BLOB_READ_WRITE_TOKEN` v Vercel env (All Environments)

### Font loading

`next/font/google` v `layout.tsx` načíta Inter, Open Sans, Roboto, Lato
ako self-hosted fonty (žiadny runtime request na Google CDN — GDPR-friendly).
Každý font dostane CSS premennú (`--font-inter`, ...) na `<html>` elemente.
`BrandProvider` mapuje enum ID → CSS string s `var(--font-*)` referenciou.

**Invariant:** Názvy `variable` v `layout.tsx` MUSIA súhlasiť s `var(--font-*)`
v `FONT_OPTIONS` (packages/shared-types/src/brand-presets.ts). Pri pridaní
nového fontu treba upraviť OBE miesta.

### Súbory zmenené v revízii v2

| Súbor                                                          | Zmena                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| `packages/shared-types/src/brand-presets.ts`                   | NOVÝ — 10 WCAG paliet + font enum + helpery              |
| `packages/shared-types/src/schemas/organisation.ts`            | `presetId`, font enum                                    |
| `packages/shared-types/src/index.ts`                           | export `brand-presets`                                   |
| `packages/shared-types/tests/brand-presets.test.ts`            | NOVÝ — WCAG testy                                        |
| `apps/api/src/modules/organisations/organisations.service.ts`  | Preset expanzia, zruš gating, `updateLogoUrl()`          |
| `apps/api/src/modules/organisations/organisations.routes.ts`   | `BrandKitBodySchema` v2, logo upload endpoint, multipart |
| `apps/api/tests/integration/organisations-branding.test.ts`    | Prepisatý na v2 sémantiku                                |
| `apps/api/tests/integration/organisations-logo-upload.test.ts` | NOVÝ — upload testy                                      |
| `apps/web/src/app/layout.tsx`                                  | `next/font/google` pre 4 fonty                           |
| `apps/web/src/lib/BrandProvider.tsx`                           | Font enum → CSS var mapovanie                            |
| `apps/web/src/lib/organisations-hooks.ts`                      | `presetId` v `BrandKit`, `useUploadLogo()`               |
| `apps/web/src/components/OrganisationSettingsContent.tsx`      | Branding sekcia prepisatá (preset karty + upload)        |
| `turbo.json`                                                   | `BLOB_READ_WRITE_TOKEN` do `globalEnv`                   |

## Referencie

- [ADR-0010 Multi-tenant white-label](0010-multi-tenant-white-label.md) — white-label mandát
- [ADR-0019 Tenant billing model](0019-tenant-billing-model.md) — plán → branding gating
- [ADR-0022 Loan protocol PDF](0022-loan-protocol-pdf.md) — `loadLogo()`, PNG-only, fallback
- [ADR-0027 QR štítky](0027-qr-label-printing.md) — logo v strede QR na štítku
- `packages/design-tokens/src/tokens.css` — `--inv-brand-*` + `data-tenant` override mechanika
- `packages/design-tokens/src/brand-kit.schema.json` — pôvodná (vnorená) JSON definícia
- `BRAND.md §8` — multi-tenant brand override policy
- [WCAG 2.1 SC 1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html) — 4.5:1 pravidlo
