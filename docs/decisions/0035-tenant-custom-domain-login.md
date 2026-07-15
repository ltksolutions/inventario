<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0035. Vlastná doména organizácie pre prihlásenie (org-aware login)

|                   |                                                                                                                                                                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | Accepted — Fáza 1 (F1–F3) implementovaná 2026-07-15, Fáza 2 F4 implementovaná 2026-07-15 (nezávislá bezpečnostná revízia OK), F5–F8 ostavajú                                                                                                                                                       |
| **Dátum**         | 2026-07-15                                                                                                                                                                                                                                                                                         |
| **Autori**        | Ján Letko, Claude (LTK Solutions)                                                                                                                                                                                                                                                                  |
| **Súvisiace ADR** | [0010 Multi-tenant white-label](0010-multi-tenant-white-label.md), [0028 Per-tenant branding](0028-per-tenant-branding.md), [0030 Registračné identity + Entra doména](0030-registration-providers-and-entra-domain.md), [0031 Per-tenant OAuth credentials](0031-per-tenant-oauth-credentials.md) |

## Kontext

`docs/TODO.md` položka #26 (nahlásené Janikou 2026-07-15): `/login` je
globálna, tenant-agnostická stránka — zobrazuje email/heslo, passkey, Google
aj Microsoft tlačidlo vždy, bez ohľadu na to, že konkrétna organizácia (napr.
SFZ) má cez `/settings/auth` nastavené `allowedAuthProviders: ['MICROSOFT']`.
Backend obmedzenie reálne funguje (zamietne login inou metódou pri pokuse), ide
teda o zavádzajúce UI, nie o bezpečnostnú dieru — ale mätie prihlasujúcich sa
členov a pôsobí to neprofesionálne.

Janika navrhla riešenie: mikro-aplikácia/stránka zavesená na vlastnú doménu
organizácie (napr. `majetok.futbalsfz.sk`), ktorá by podľa nastavenia danej
organizácie zobrazila len povolené spôsoby prihlásenia a po odoslaní
presmerovala do platformy.

Toto nie je úplne nový problém — bol čiastočne predvídaný:

- **ADR-0010** už od začiatku definuje `Organisation.branding.customDomain`
  (`packages/shared-types/src/schemas/organisation.ts:406`) a repository má
  unikátny partial index `customDomain_unique_partial`
  (`organisations.repository.ts:122-126`) + metódu `findByCustomDomain()`
  (`organisations.repository.ts:185`) — dnes sa ale používa **len** na kontrolu
  kolízie pri `PATCH`, nikde na skutočný tenant routing.
- **`docs/milestones/phase-c-multi-tenant-migration.md:227-230`** má toto
  explicitne označené ako `[DEFER]`: _"Custom domain routing — field je
  pripravený, ale routing middleware ho ešte nepoužíva. Plánované pre Q3
  2026."_ — ale tam sa myslí **celá appka** pod vlastnou doménou (plný
  white-label), čo je oveľa väčší projekt.
- **ADR-0031** už rieši príbuzný problém pri OAuth: tenant sa pri logine
  identifikuje cez `?org=<slug>` query hint (`oauth.routes.ts:81, 111-139`), a
  explicitne poznamenáva riziko: _"Bez hintu spadne na platformovú app... Treba
  jasné UX"_ a označuje "tenant subdoména"/"email-first routing" ako budúce
  vylepšenie.

**Kľúčové zistenie, ktoré robí Janikin nápad realizovateľným lacnejšie, než
celý Q3 2026 white-label projekt:** OAuth redirect URI je viazaný len na
`api.inventario.estate` (nie na login/frontend doménu) — vlastná doména teda
**nemusí** niesť celú appku, stačí jej niesť len prihlasovaciu obrazovku a
presmerovať/odkázať priamo na `api.inventario.estate`. Cookie sa nastavuje na
`.inventario.estate` (`COOKIE_DOMAIN`, `cookie-helpers.ts:21-24`) — vlastná
doména do session cookie vôbec nezasahuje.

### Rozhodnuté v konverzácii (2026-07-15)

1. **Rozsah:** všeobecná funkcia — ktorákoľvek organizácia si bude môcť
   nastaviť vlastnú doménu, nielen SFZ.
2. **Metódy:** má podporovať všetky povolené metódy danej organizácie
   (Microsoft/Google/email+heslo), nielen OAuth.
3. **DNS:** Janika má prístup k DNS záznamom `futbalsfz.sk`, vie pridať CNAME
   pre `majetok.futbalsfz.sk` sama, keď bude stránka pripravená.

## Možnosti

### Možnosť A: Host-aware routing v existujúcej `apps/web` appke (odporúčaná)

Vlastná doména sa pridá ako ďalšia Vercel doména na **ten istý**
`inventario-web` projekt. Next.js Edge Middleware (`apps/web/middleware.ts`)
skontroluje `Host` hlavičku; ak nezodpovedá kanonickej appke
(`app.inventario.estate`, `localhost`, Vercel preview domény), zavolá nový
verejný endpoint na backend, aby zistil, či hlavička zodpovedá registrovanej
`customDomain` niektorej organizácie. Ak áno, rewrite (nie redirect — URL v
prehliadači ostáva `majetok.futbalsfz.sk`) na dedikovanú stránku
`/tenant-login`, ktorá vyrenderuje branding + len povolené metódy danej
organizácie. Všetky ostatné cesty pod cudzou doménou sa buď 404, alebo
redirectnú na `app.inventario.estate`.

- **Plus:** jeden deploy obsluhuje ľubovoľný počet tenant domén — pridanie
  ďalšieho tenanta = len Vercel dashboard "Add Domain" + DNS CNAME, žiadny nový
  kód ani nasadenie. Znovupoužije existujúci `BrandProvider` (ADR-0028) na
  logo/farby. Stránka má plný JS (Next.js), takže email/heslo môže ísť cez
  bežný `fetch` s `credentials: 'include'`, nie cez krehký `<form>` POST.
- **Mínus:** treba dynamický CORS (pozri nižšie) a Host-header bezpečnostnú
  kontrolu (nikdy nedôverovať `Host` bez overenia proti DB — presný precedens
  už rieši ADR-0021 pre `appBaseUrl` v QR kódoch, `0021-asset-qr-codes.md:205-220`).

### Možnosť B: Samostatný mikro-projekt/deploy per tenant

Nový, minimálny Next.js/statický balík (napr. `apps/tenant-login`), nasadený
ako **vlastný** Vercel projekt pre každého tenanta, ktorý chce vlastnú doménu.

- **Plus:** izolovaný blast radius, jednoduchšie code review pre bezpečnostne
  citlivú prihlasovaciu obrazovku.
- **Mínus:** **nescáluje** — pridanie ďalšieho tenanta s vlastnou doménou by
  vyžadovalo nový Vercel projekt a manuálny deploy zakaždým. Janika chce
  všeobecnú funkciu pre ktoréhokoľvek tenanta — to je presný opak toho, čo
  Možnosť B dokáže ponúknuť bez opakovanej manuálnej práce.

### Možnosť C: Len dokončiť `?org=<slug>` na `app.inventario.estate/login` (bez vlastnej domény)

Frontend `LoginPage.tsx` by čítal `?org=<slug>` z URL, zavolal nový verejný
endpoint a filtroval tlačidlá — bez akejkoľvek vlastnej domény. Toto je presne
**Fáza 1** nižšie.

- **Plus:** najmenší možný krok, rieši TODO #26 aj pre tenantov bez vlastnej
  domény (pozvánkové odkazy, priame linky), žiadne DNS/Vercel domain kroky.
- **Mínus:** nespĺňa Janikino zadanie (vlastná doména) samo o sebe — ale je to
  nevyhnutný a znovupoužiteľný základ pre Možnosť A.

## Rozhodnutie

### Možnosť A, postavená na Fáze z Možnosti C — dvojfázový postup

**Fáza 1 — org-aware `/login` (bez custom domény, funguje pre všetkých hneď):**

- Nový verejný, neautentifikovaný endpoint `GET /v1/public/organisations/login-context`
  s query `?slug=` alebo `?domain=` — vráti **len neškodné dáta**: `{ displayName,
logoUrl, brandColors, allowedAuthProviders, hasEntraRestriction: boolean }`.
  Nikdy `entraTenantId` samotný, žiadne ID/emaily/interné polia. Rate-limited
  (rovnaký vzor ako `GET /v1/public/scan/:token`, ADR-0021).
- `LoginPage.tsx` prečíta `?org=<slug>` z URL (ak je), zavolá endpoint,
  filtruje zobrazené tlačidlá/formulár podľa `allowedAuthProviders`, zobrazí
  branding (logo, meno organizácie) namiesto generického Inventario brandingu.
  Bez `?org=` parametra sa správa presne ako dnes (žiadna regresia).
- Pozvánkové e-maily a `?org=` hint (ADR-0031) sa prepoja s týmto novým
  filtrovaním — dnes hint ovplyvňuje len to, ktorá Microsoft app sa použije,
  odteraz ovplyvní aj to, čo sa vôbec zobrazí.
- `ERROR_MESSAGES` v `LoginPage.tsx` doplniť o `provider_not_allowed` a
  `entra_tenant_mismatch` (dnes padajú na generické "Nastala chyba").

**Fáza 2 — vlastná doména nad hotovou Fázou 1:**

- UI v `/settings/auth`: nová sekcia "Vlastná doména pre prihlásenie" —
  textové pole na `customDomain` (validácia: žiadny protokol, žiadna cesta,
  lowercase, DNS-tvar), návod na CNAME (`majetok.futbalsfz.sk → cname.vercel-dns.com`
  alebo presná hodnota z Vercel), stav "Doména overená" / "Čaká na DNS".
- `apps/web/middleware.ts`: pri neznámom `Host` zavolá rovnaký
  `login-context` endpoint (teraz s `?domain=`), a ak nájde zhodu, rewrite na
  `/tenant-login`. Bez zhody → 404 (nikdy nezobraziť cudziu appku pod
  neznámou doménou).
- OAuth (Microsoft/Google) z `/tenant-login`: obyčajný `<a href>` priamo na
  `${API_BASE}/v1/auth/login/:provider?org=:slug` — **žiadna zmena backendu**,
  toto už funguje (ADR-0031 E4).
- Email/heslo z `/tenant-login`: `fetch` s `credentials: 'include'` na
  `${API_BASE}/v1/auth/login/email`. Vyžaduje **dynamický CORS** — Fastify
  `cors.origin` ako funkcia (nie statický zoznam), ktorá pri neznámom Origin
  overí voči DB (`findByCustomDomain`), s krátkym in-memory/edge cache (napr.
  60s), aby sa nezaťažoval Mongo pri každom preflighte.
- Po úspešnom prihlásení (Microsoft/Google/email) treba **klientský redirect**
  na `https://app.inventario.estate` (nie SPA navigáciu) — cookie je scoped na
  `.inventario.estate`, JS na `majetok.futbalsfz.sk` ju ani nemôže čítať, čo je
  v poriadku, appka beží ďalej na svojej vlastnej doméne ako doteraz.

### Mimo rozsahu (zaznamenané, nerobíme teraz)

- Plné white-label routovanie celej appky pod vlastnou doménou (zostáva
  `[DEFER]` podľa `phase-c-multi-tenant-migration.md`, Q3 2026).
- Automatická DNS/SSL diagnostika v UI (napr. "over, či CNAME už funguje") —
  pekné-to-mať, nie blocker.
- Vlastná doména pre Apple Sign-In (mimo rozsahu podobne ako v ADR-0031).

## Dôsledky

### Pozitívne

- Fáza 1 sama o sebe rieši TODO #26 pre **všetkých** tenantov (aj bez vlastnej
  domény) — pozvánkové linky aj priame `?org=` linky okamžite zobrazia správne
  metódy.
- Fáza 2 škáluje bez opakovanej manuálnej práce na náš strane (na rozdiel od
  Možnosti B) — pridanie tenanta = ich DNS krok + Vercel "Add Domain".
- Znovupoužíva existujúcu infraštruktúru: `BrandProvider` (ADR-0028), `?org=`
  hint (ADR-0031), `customDomain` pole a unikátny index (ADR-0010) — takmer nič
  z toho nie je nový koncept, len sa prvýkrát skutočne zapája.

### Negatívne / kompromisy

- Dynamický CORS (DB lookup na Origin) je nová trieda kódu, ktorá si vyžaduje
  bezpečnostnú pozornosť — zlá implementácia by mohla omylom povoliť widerange
  originy. Treba striktne: len presná zhoda na `customDomain` v DB, žiadne
  wildcard/subdomain matching.
- Middleware pridáva latenciu (1 extra API call) na **každý** request z cudzej
  domény, kým nebude cache — treba edge cache s rozumným TTL.
- Fáza 2 je citeľne väčší kus práce než Fáza 1 (nové UI, middleware, dynamic
  CORS, dva rôzne "úspešné prihlásenie" flow-y podľa domény).

### Riziká, ktoré treba sledovať

- **Host-header spoofing** — middleware aj CORS funkcia musia vždy overovať
  Host/Origin **proti DB**, nikdy netreba slepo dôverovať hlavičke (presný
  precedens: ADR-0021 už rieši rovnaké riziko pre `appBaseUrl`).
- **DNS/SSL onboarding UX** — Vercel automaticky vydá SSL cert až po tom, čo
  DNS skutočne smeruje správne; medzitým môže byť doména v "pending" stave.
  Treba jasný stavový indikátor v `/settings/auth`, aby si Janika nemyslela, že
  niečo nefunguje.
- **Cache invalidácia** — ak organizácia zmení `allowedAuthProviders` alebo
  `customDomain`, cache v middleware/CORS musí byť dosť krátka, aby zmena
  prejavila v rozumnom čase (návrh: 60s TTL, žiadny manuálny purge endpoint
  zatiaľ).

## Implementačný plán (návrh K-blokov)

> Model: Sonnet pre väčšinu; Opus odporúčaný pre F4 (middleware + dynamický
> CORS) kvôli bezpečnostnej citlivosti (host-header/CORS logika).

| Blok   | Popis                                                                                                              | Fáza | Model  |
| ------ | ------------------------------------------------------------------------------------------------------------------ | ---- | ------ |
| **F1** | `GET /v1/public/organisations/login-context` (slug/domain lookup, whitelist polí, rate-limit).                     | 1    | Sonnet |
| **F2** | `LoginPage.tsx`: `?org=` čítanie, filtrovanie tlačidiel/formulára, branding, chýbajúce `ERROR_MESSAGES`.           | 1    | Sonnet |
| **F3** | Testy F1+F2 (verejný endpoint whitelist polí, filtrovanie podľa providerov, fallback bez `?org=`).                 | 1    | Sonnet |
| **F4** | `apps/web/middleware.ts` host-aware rewrite + dynamický Fastify CORS (`origin` ako funkcia + cache).               | 2    | Opus   |
| **F5** | UI `/settings/auth`: sekcia "Vlastná doména", validácia, stavový indikátor.                                        | 2    | Sonnet |
| **F6** | `/tenant-login` stránka (OAuth linky + email/heslo fetch flow + post-login redirect na app.inventario.estate).     | 2    | Sonnet |
| **F7** | Testy F4–F6 (host spoofing pokusy, CORS zamietnutie neznámeho originu, end-to-end login cez custom doménu — mock). | 2    | Sonnet |
| **F8** | Docs: user-guide "Vlastná doména pre prihlásenie" (DNS návod), session doc, TODO.md #26 zatvoriť.                  | 1+2  | Haiku  |

Fáza 1 (F1–F3) je samostatne nasaditeľná a hodnotná aj bez Fázy 2 — odporúčam
ju spraviť ako prvú, samostatnú dodávku.

## Referencie

- [ADR-0010 Multi-tenant white-label](0010-multi-tenant-white-label.md) — pôvod `customDomain` poľa
- [ADR-0021 Asset QR codes](0021-asset-qr-codes.md) — precedens pre "nikdy nedôveruj Host hlavičke bez DB overenia"
- [ADR-0028 Per-tenant branding](0028-per-tenant-branding.md) — `BrandProvider`, logo/farby na znovupoužitie
- [ADR-0030 Registračné identity + Entra doména](0030-registration-providers-and-entra-domain.md)
- [ADR-0031 Per-tenant OAuth credentials](0031-per-tenant-oauth-credentials.md) — `?org=` hint mechanizmus, pôvodná identifikácia rizika
- `docs/milestones/phase-c-multi-tenant-migration.md:227-230` — `[DEFER]` poznámka o plnom custom domain routingu (Q3 2026)
- `docs/TODO.md` položka #26 — pôvodné nahlásenie problému
