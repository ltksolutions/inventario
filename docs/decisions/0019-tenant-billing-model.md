<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0019. Fakturačné údaje tenanta — vnorený `billing` objekt + self-service

|                   |                                            |
| ----------------- | ------------------------------------------ |
| **Status**        | ✅ Accepted                                |
| **Dátum**         | 2026-05-30                                 |
| **Autori**        | Ján Letko, Claude Opus 4.7 (LTK Solutions) |
| **Súvisiace ADR** | 0010 (multi-tenant), 0013 (registrácia)    |

## Kontext

Pred onboardingom prvého platiaceho tenanta potrebujeme uchovávať
fakturačné a právne údaje organizácie (IČO, DIČ, IČ DPH, sídlo, IBAN,
zápis v OR/ŽR), aby sme im vedeli vystaviť faktúru. Generovanie faktúr
priamo v appke je plánované neskôr; teraz ide o dátový model + zber údajov.

Otvorené otázky pri návrhu:

1. **Kam s fakturačnými údajmi** — ploché polia na `Organisation`,
   vnorený objekt, alebo samostatná kolekcia?
2. **Kedy ich zbierať** — pri registrácii, alebo až keď ich tenant
   potrebuje?
3. **Kto ich smie editovať** — platform operátor (LTK), alebo admin
   tenanta sám?

## Rozhodnutie

### 1. Vnorený `billing` objekt na `Organisation`

Fakturačné údaje sú vnorený nullable objekt `billing` na dokumente
`Organisation`, nie samostatná kolekcia ani ploché polia.

- **Prečo nie ploché polia:** ~10 fakturačných polí + 2 adresy by
  zaplavilo už aj tak rozsiahly `Organisation` dokument a zmiešalo by
  fakturačnú doménu s identitou/auth/brandingom. Vnorenie drží
  fakturačnú doménu pohromade a čitateľnú.
- **Prečo nie samostatná kolekcia:** Vzťah Organisation↔Billing je
  striktne 1:1 a billing nemá vlastný životný cyklus mimo tenanta.
  Samostatná kolekcia by pridala join/lookup bez prínosu. Ak neskôr
  pribudne história faktúr alebo platobné metódy, tie pôjdu do
  vlastných kolekcií — ale štatické fakturačné údaje patria k tenantovi.

Re-použiteľné stavebné bloky v `packages/shared-types/src/schemas/common.ts`:
`AddressSchema`, `IcoSchema` (8 číslic), `DicSchema` (10 číslic),
`IcDphSchema` (SK + 10, s normalizáciou), `IbanSchema` (formát +
normalizácia bez medzier, uppercase). Tieto sa využijú aj inde
(dodacie adresy, kontakty) v budúcich slices.

### 2. Validácia: schéma je permisívna, povinnosť rieši flow

Všetky polia v `OrganisationBillingSchema` sú nullable a celý `billing`
objekt je nullable. FREE tenant môže mať `billing: null`.

- **Prečo:** Povinnosť fakturačných údajov závisí od kontextu (prechod
  na platený plán), nie od samotnej existencie dokumentu. Keby boli
  polia povinné na úrovni schémy, nevedeli by sme uložiť čiastočne
  vyplnený formulár ani JIT-provisioned tenant bez údajov.
- **Krížová validácia DPH:** `isVatPayer` je zdroj pravdy. `icDph` je
  povinné len keď `isVatPayer === true` — túto kontrolu robí billing
  flow (frontend + budúci invoice generator), nie Zod schéma, aby
  schéma zostala kompozitná a znovupoužiteľná.

### 3. Registrácia ostáva jednoduchá, údaje sú self-service

Fakturačné údaje sa **nezbierajú pri registrácii**. Registrácia ostáva
minimálna (názov, slug, prvý admin — viď ADR-0013). Admin tenanta si
fakturačné údaje vyplní sám na stránke `/settings/organisation`, keď
ich potrebuje (pred prvou faktúrou).

- **Prečo:** Fakturačné údaje sú prekážka pri onboardingu. Mnoho
  tenantov (školy, malé kluby) ich pri registrácii nemá po ruke.
  Self-service v nastaveniach je nižšie trenie a údaje sú vyplnené
  práve vtedy, keď sú relevantné.

### 4. RBAC: tenant admin edituje VLASTNÚ org cez `/current`

Nové endpointy oddelené od platform-admin CRUD (`/v1/organisations/:id`,
ADMIN-only, LTK operátori):

- `GET /v1/organisations/current` — ktorýkoľvek člen tenanta číta
  vlastnú org (na zobrazenie nastavení)
- `PATCH /v1/organisations/current` — len **ADMIN tenanta** edituje
  vlastnú org

**Bezpečnostná hranica:** organizácia, ktorú endpoint číta/zapisuje, sa
určuje z `request.currentUser.organisationId` (odvodené z JWT auth
middlewarom), **nikdy nie z URL parametra**. Tenant admin tak nemôže
nikdy siahnuť na cudziu organizáciu — nemá ako ovplyvniť, ktoré ID sa
použije.

**SAFE subset:** `PATCH /current` prijíma len `displayName`,
`primaryContactEmail` a `billing`. Polia `plan`, `status`, `slug`,
`customDomain`, `allowedAuthProviders` sú platform-operator concerns
a cez tento endpoint **nie sú editovateľné** — patria na admin
`/:id` endpoint. Zmena plánu je obchodné rozhodnutie LTK, nie
self-service tenanta.

### 5. Plán + upgrade: zatiaľ mailto, platby neskôr

Stránka `/settings/organisation` zobrazuje aktuálny plán a tlačidlo
„Požiadať o vyšší plán", ktoré otvorí `mailto:` na obchodný kontakt LTK
s predvyplneným predmetom. Reálny billing provider a platobný flow
pribudnú neskôr.

## Dôsledky

### Pozitívne

- Fakturačná doména je izolovaná, čitateľná, znovupoužiteľná (Address/Ico/...)
- Registrácia ostáva s nízkym trením
- Tenant si spravuje vlastné údaje bez závislosti na LTK
- Bezpečné — cross-tenant izolácia cez JWT-derived org ID
- Pripravené na budúci invoice generator (dáta sú v správnom tvare)

### Negatívne / kompromisy

- Krížová validácia DPH (`icDph` povinné pri platiteľovi) je rozptýlená
  do flow vrstvy, nie centralizovaná v schéme — treba ju duplikovať
  vo frontend aj v budúcom invoice generatore
- `billing` body schéma je duplikovaná v `apps/api` routes (rovnako ako
  `brandKit`) kvôli looser POST/PATCH sémantike — pri zmene poľa treba
  upraviť na dvoch miestach (shared-types schéma + routes body schéma)
- IBAN sa validuje len formátom (regex), nie mod-97 kontrolným súčtom —
  doplníme pri invoice generatore ak bude treba

## Implementácia

| Vrstva            | Súbor                                                         |
| ----------------- | ------------------------------------------------------------- |
| Schémy (spoločné) | `packages/shared-types/src/schemas/common.ts`                 |
| Billing schéma    | `packages/shared-types/src/schemas/organisation.ts`           |
| API routes        | `apps/api/src/modules/organisations/organisations.routes.ts`  |
| API service       | `apps/api/src/modules/organisations/organisations.service.ts` |
| Frontend hooks    | `apps/web/src/lib/organisations-hooks.ts`                     |
| Frontend stránka  | `apps/web/src/components/OrganisationSettingsContent.tsx`     |
| Page route        | `apps/web/src/app/settings/organisation/page.tsx`             |

JSON Schema + Mongo `$jsonSchema` validátor sa regenerujú automaticky
z `OrganisationSchema` (`generate-json-schema.ts` inline-uje cez
`$refStrategy: 'none'`) — generátor netreba meniť.
