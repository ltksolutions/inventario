<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0030. Registračné identity + Entra ako per-tenant doménová reštrikcia

|                   |                                                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Status**        | ✅ Accepted — rozšírené [ADR-0031](0031-per-tenant-oauth-credentials.md)                                                                                                                                                                               |
| **Dátum**         | 2026-06-03                                                                                                                                                                                                                                             |
| **Autori**        | Ján Letko, Claude Opus 4.8 (LTK Solutions)                                                                                                                                                                                                             |
| **Súvisiace ADR** | [0004 Auth Entra ID](0004-auth-entra-id.md) (superseded), [0013 Multi-provider auth](0013-multi-provider-auth-self-serve.md), [0010 Multi-tenant](0010-multi-tenant-white-label.md), [0015 Cross-tenant memberships](0015-cross-tenant-memberships.md) |

## Kontext

ADR-0013 zaviedol multi-provider auth (Google / Apple / Microsoft / e-mail) a self-serve
registráciu. Implementácia ostala v polovici a v produkcii zostal reziduálny model
zo začiatku projektu, keď bola appka Entra-only (ADR-0004):

1. **Registračná obrazovka** ponúka len Google / Microsoft / e-mail. Apple chýba
   (backend vracia 503). „Microsoft" pôsobí — a v hlavách používateľov je — ako
   „prihlásenie cez firemnú Entru", hoci backend už používa multi-tenant
   `organizations` endpoint, ktorý pustí **akékoľvek** Microsoft konto.

2. **Entra je dnes de-facto povinnosť pre SFZ tenant.** SFZ má nastavený
   `entraTenantId` a prihlasovanie ide cez konkrétny Entra adresár. To je presný
   opak želaného modelu: Entra má byť **voliteľná schopnosť organizácie**
   (povoliť firemnú doménu/domény pre firemné kontá), nie podmienka používania
   platformy.

3. **Doménový model je v dátach pripravený, ale nezapojený.** `OrganisationSchema`
   už má `entraTenantId`, `customDomain`, `allowedAuthProviders`, `memberJoinPolicy`
   (INVITE_ONLY / DOMAIN_RESTRICTED / OPEN) a `autoJoinDomains`. Auth flow z toho
   ale využíva len `allowedAuthProviders`. `entraTenantId` sa pri logine nepoužíva
   na žiadnu reštrikciu — je to len mŕtve pole zdedené z ADR-0004.

### Čo chceme dosiahnuť

- **Registrácia novej organizácie**: zakladateľ sa prihlási ľubovoľnou osobnou
  identitou — Google, Apple, Microsoft (osobné aj firemné konto, bez väzby na
  konkrétny Entra adresár) alebo e-mail+heslo. Žiadny krok nevyžaduje, aby
  organizácia mala Microsoft 365 / Entra.

- **Entra ako per-tenant nastavenie**: administrátor organizácie môže povoliť
  jednu alebo viac firemných domén, aby sa členovia mohli prihlasovať firemným
  kontom. Pridanie člena ostáva **výhradne cez pozvánku admina** (INVITE_ONLY je
  default); doménové obmedzenie len zužuje, kto smie pozvánku prijať a akým kontom.

- **Migrácia SFZ** z dnešného Entra-viazaného modelu na nový doménový model bez
  výpadku pre existujúcich členov.

### Obmedzenia

- **EUPL-1.2 / no vendor lock-in** — žiadny platený IdP, žiadny self-hosted
  Keycloak (ADR-0013 dôvody platia).
- **Bezšvová migrácia** — existujúci SFZ členovia sa nesmú odhlásiť ani stratiť
  prístup. `authProviders[]` na ich User dokumentoch už existuje.
- **Cross-tenant model (ADR-0015)** — User je globálny, Membership viaže usera na
  org. Doménová reštrikcia sa vyhodnocuje pri prijatí pozvánky / logine, nie na
  User dokumente.
- **Pilot časový tlak** — SFZ pilot beží; zmena nesmie rozbiť prihlásenie.

## Možnosti

### Spôsob prihlásenia pri registrácii

#### Možnosť A: Len e-mail + heslo

- Plus: najmenší povrch, žiadne OAuth závislosti pri registrácii, najrýchlejšie.
- Mínus: horší UX (ďalšie heslo navyše), zahodí už hotový OAuth kód, neskôr
  aj tak treba pridať sociálne prihlásenie.

#### Možnosť B: E-mail + Google + Apple + Microsoft (osobné/firemné kontá)

- Plus: najlepší UX (prihlás sa čím chceš), backend to už takmer celé vie
  (chýba len Apple), Microsoft `organizations` endpoint funguje pre firemné aj
  osobné kontá automaticky.
- Mínus: Apple Sign-In dorobiť (Apple Developer účet $99/rok, `form_post`
  callback), širší povrch.

#### Možnosť C: B + plné enterprise SSO (SAML/OIDC federation)

- Plus: pripravené na veľké enterprise tenanty s vlastným IdP (Okta, Auth0…).
- Mínus: samostatný veľký projekt (per-tenant IdP metadata, certifikáty,
  konfigurácia), výrazne nad rámec potreby SFZ a podobných organizácií. Predčasné.

### Ako Microsoft / firemné kontá vlastne fungujú (dôležité rozlíšenie)

Tri rôzne veci, ktoré sa zvyknú zlievať do „prihlás sa Microsoftom":

1. **Microsoft OAuth cez `organizations`/`common`** — to, čo už máme. Pustí
   akékoľvek Microsoft konto (firemné Entra, školské, osobné podľa endpointu).
   Nie je viazané na konkrétny tenant. Toto je registračné „Microsoft".
2. **Entra ID s reštrikciou na konkrétny `tid`/doménu** — appka obmedzí prihlásenie
   na jeden firemný adresár. Toto je dnešný SFZ stav a presne to, čo presúvame do
   **per-tenant nastavenia** (povolené domény + voliteľný Entra tenant ID).
3. **SAML/OIDC enterprise SSO** — „veľké" federované SSO s vlastným IdP. **Mimo
   rozsahu** tohto ADR; samostatný neskorší projekt, ak ho reálny tenant vyžiada.

Firemné Microsoft konto sa teda pri registrácii prihlási automaticky cez (1) —
nepotrebuje žiadnu Entra konfiguráciu na strane Inventaria. Entra konfigurácia
(2) je až vec, ktorou si organizácia _zúži_ prihlasovanie svojich členov.

## Rozhodnutie

### 1. Registrácia: Možnosť B — e-mail + Google + Apple + Microsoft

Registračná obrazovka ponúkne štyri rovnocenné spôsoby. Microsoft ide cez
multi-tenant `organizations` endpoint (akékoľvek Microsoft konto, žiadna väzba na
firemný adresár). Apple sa dorobí (backend dnes vracia 503). SSO/SAML (Možnosť C)
**nerobíme** — zaznamenané ako „mimo rozsah".

UI prestane navodzovať dojem, že „Microsoft = firemná Entra". Texty a usporiadanie
sú neutrálne: štyri možnosti prihlásenia rovnako, bez zmienky o Entre na
registračnej obrazovke.

### 2. Entra → per-tenant doménová reštrikcia

`entraTenantId` prestáva byť „auth gate na celú appku" a stáva sa súčasťou
per-tenant **doménovej politiky** organizácie. Model stojí na poliach, ktoré už
v schéme sú:

- `allowedAuthProviders` — ktoré spôsoby prihlásenia tenant povolí svojim členom.
- `memberJoinPolicy` — `INVITE_ONLY` (default) / `DOMAIN_RESTRICTED` / `OPEN`.
- `autoJoinDomains` — zoznam firemných domén (napr. `["sfz.sk"]`).
- `entraTenantId` — voliteľné: ak je vyplnené, Microsoft prihlásenie člena sa
  navyše overí proti tomuto adresáru (firemné konto z daného Entra tenanta).

Pravidlá vyhodnotenia (auth callback + accept-invite):

- **Pozvánka má vždy prednosť.** Pridanie člena do existujúcej org je možné len
  cez platnú pozvánku admina (INVITE*ONLY default). Doména/Entra len \_zužujú*,
  akým kontom smie pozvaný prijať pozvánku — nikdy nie sú samostatnou cestou
  dovnútra, pokiaľ admin explicitne nezapne `DOMAIN_RESTRICTED` auto-join.
- **`DOMAIN_RESTRICTED`** (opt-in): člen s e-mailom v `autoJoinDomains` sa môže
  pripojiť aj bez individuálnej pozvánky — ale len ak to admin zapne. Default
  ostáva INVITE_ONLY.
- **`entraTenantId` reštrikcia** (opt-in): keď je vyplnené, Microsoft login
  člena musí pochádzať z daného adresára (overenie `tid` claim). Bez neho je
  Microsoft login akékoľvek Microsoft konto.

Toto je čisto **aditívna** zmena dátového modelu — žiadne nové polia, len zapojenie
existujúcich do auth flow a admin UI na ich nastavenie.

### 3. Migrácia SFZ

SFZ tenant prejde z „Entra-only prihlásenie" na nový model:

- `entraTenantId` ostáva vyplnené (firemný adresár SFZ) → Microsoft login členov
  sa naďalej overuje proti nemu (zachová sa súčasné správanie pre tých, čo sa
  hlásia firemným kontom).
- `allowedAuthProviders` sa nastaví podľa toho, čo SFZ chce povoliť (minimálne
  MICROSOFT; prípadne aj EMAIL pre členov bez firemného konta).
- `autoJoinDomains` sa naplní firemnou doménou SFZ, ak SFZ chce doménový
  auto-join; inak ostáva INVITE_ONLY a členovia chodia cez pozvánky.
- Existujúce User dokumenty SFZ členov už majú `authProviders[]` s Microsoft
  záznamom (z ADR-0013 migrácie) — nemenia sa.

Migrácia je dátová (úprava jedného Organisation dokumentu) + overenie auth flow;
žiadna zmena na User dokumentoch, takže žiadne odhlásenie.

### Mimo rozsahu (zaznamenané, nerobíme teraz)

- SAML / OIDC federation s ľubovoľným per-tenant IdP (Okta, Auth0, generic).
- Per-tenant branding OAuth consent screenu.
- Domain ownership verification (DNS TXT) pred zapnutím `DOMAIN_RESTRICTED` —
  zvážiť, ak doménový auto-join začne reálne používať viac tenantov.

## Implementačný plán (návrh K-blokov)

> Presné poradie a rozsah po odsúhlasení. Model: Sonnet pre väčšinu (auth flow,
> CRUD, frontend, testy), Opus len ak by sa otvorila čisto návrhová otázka.

| Blok   | Popis                                                                                                                                 | Model  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **D1** | Backend Apple Sign-In: dokončiť `apple` provider (Arctic, `form_post` callback), odstrániť 503 z registrácie aj loginu.               | Sonnet |
| **D2** | Auth flow: zapojiť `entraTenantId` reštrikciu (overenie `tid` pri Microsoft callbacku) + `autoJoinDomains` do accept-invite/login.    | Sonnet |
| **D3** | Admin UI „Prihlasovanie a domény" v nastaveniach org: `allowedAuthProviders`, `memberJoinPolicy`, `autoJoinDomains`, `entraTenantId`. | Sonnet |
| **D4** | Frontend registračná obrazovka: 4 neutrálne možnosti (Google/Apple/Microsoft/E-mail), odstrániť Entra framing.                        | Sonnet |
| **D5** | SFZ migrácia: dátová úprava Organisation dokumentu + overenie že firemné Microsoft prihlásenie členov funguje cez nový model.         | Sonnet |
| **D6** | Testy: Apple flow, entraTenantId reštrikcia (pustí len daný adresár), domain auto-join (opt-in), invite stále prednosť, SFZ scenár.   | Sonnet |
| **D7** | Docs: superseded note do ADR-0004 (definitívne), user-guide „Povolenie firemnej domény", milestone + session.                         | Haiku  |

## Dôsledky

### Pozitívne

- **Entra prestáva byť bariéra** — školy, kluby, obce bez M365 sa registrujú
  rovnako ľahko ako firmy s M365.
- **Jasný mentálny model** — „prihlás sa čím chceš" pri registrácii; „povoľ
  firemnú doménu" je vec organizácie, nie podmienka platformy.
- **Aditívna zmena dát** — žiadne nové polia, len zapojenie existujúcich; nízke
  riziko migrácie.
- **SFZ správanie zachované** — firemné prihlasovanie členov funguje ďalej cez
  `entraTenantId` reštrikciu.
- **Pozvánka ostáva bránou** — bezpečnostný invariant (INVITE_ONLY default) sa
  nemení; doména len zužuje, nie otvára.

### Negatívne / kompromisy

- **Apple Sign-In dorobiť** — Apple Developer účet ($99/rok), `form_post`
  callback, sandbox testovanie je otravné (známe z ADR-0013).
- **Viac auth vetiev** — entraTenantId reštrikcia + domain auto-join pridajú
  vetvy do callbacku; treba dôkladné testy, nech sa invite-prednosť nezlomí.
- **Doménový auto-join bez DNS verifikácie** — `DOMAIN_RESTRICTED` zatiaľ verí
  e-mailovej doméne bez overenia vlastníctva; zámerne opt-in a default vypnuté.

### Riziká, ktoré treba sledovať

- **Regresia SFZ prihlásenia** — migrácia sa musí overiť na reálnom SFZ tenante
  (alebo verne nasimulovať) skôr, než sa nasadí; firemní členovia sa nesmú
  odrezať.
- **Entra `tid` overenie** — Arctic/MS Graph cesta dnes `tid` nečíta; treba ho
  vytiahnuť z id_token claimu, nie z Graph `/me` (Graph `/me` `tid` priamo
  nevracia). Implementačný detail na pozor v D2.
- **`accountType: ENTRA_ID` pre OAuth users** — dnešný kód pri Google/Microsoft
  self-serve registrácii nastavuje `accountType: ENTRA_ID` aj pre Google
  (mätúce). Pri tejto zmene zvážiť presnejší `accountType` (alebo ho odvodiť
  z `authProviders[]`) — drobný tech-debt, netreba blokovať.

## Referencie

- [ADR-0004 Auth Entra ID](0004-auth-entra-id.md) — pôvodný Entra-only model (superseded)
- [ADR-0013 Multi-provider auth + self-serve](0013-multi-provider-auth-self-serve.md) — základ multi-provider
- [ADR-0010 Multi-tenant white-label](0010-multi-tenant-white-label.md) — Organisation = tenant
- [ADR-0015 Cross-tenant memberships](0015-cross-tenant-memberships.md) — User globálny, Membership viaže
- [Microsoft identity platform — tenancy (`tid`, `organizations`, `common`)](https://learn.microsoft.com/en-us/entra/identity-platform/single-and-multi-tenant-apps)
- [Sign in with Apple — REST API](https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_rest_api)
