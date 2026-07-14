<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0034. Predpríprava (pre-provisioning) budúceho používateľa v DOMAIN_RESTRICTED organizácii

|                   |                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | ✅ Accepted (rozhodnuté 2026-07-14)                                                                                                                                                                                                                                                                                                                                                                                              |
| **Dátum**         | 2026-07-14                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Autori**        | Ján Letko, Claude Sonnet 5 (LTK Solutions)                                                                                                                                                                                                                                                                                                                                                                                       |
| **Súvisiace ADR** | [0013 Multi-provider auth + self-serve onboarding](0013-multi-provider-auth-self-serve.md), [0015 Cross-tenant memberships](0015-cross-tenant-memberships.md), [0023 Loan beneficiary + direct loan](0023-loan-beneficiary-and-direct-loan.md), [0029 Single hierarchical role](0029-single-hierarchical-role.md), [0032 Žiadosť pre nezaregistrovaného beneficiary (zamietnuté)](0032-loan-request-unregistered-beneficiary.md) |

## Kontext

Onboarding scenár, ktorý dnešný model nepokrýva: správca majetku vie, že o týždeň/mesiac
nastúpi nový zamestnanec so **známou firemnou e-mailovou adresou** (organizácia má
`memberJoinPolicy: DOMAIN_RESTRICTED` a firemnú doménu v `autoJoinDomains`). Správca chce
vopred zaevidovať a schváliť žiadosť o výbavu (laptop, telefón, dresy), aby mal nový
zamestnanec majetok pripravený v deň nástupu — bez toho, aby musel stáť pri pulte a čakať,
kým sa žiadosť vybaví.

### Prečo to nie je to isté, čo ADR-0032 zamietlo

[ADR-0032](0032-loan-request-unregistered-beneficiary.md) (2026-07-01) riešilo podobne
znejúci problém — žiadosť pre osobu bez `User` záznamu — a bolo **zamietnuté v celom
rozsahu**. Dôvod zamietnutia sa ale viaže na iný scenár a inú príčinu:

- V 0032 mala možnosť vytvorenia záznamu spúšťať **žiadosť samotná** (`LoanRequest`),
  podávaná ktorýmkoľvek EMPLOYEE. Keby to malo za následok vytvorenie `Invitation`/`User`,
  EMPLOYEE by nepriamo obišiel RBAC pravidlo, že pozvánky smú vytvárať len
  ASSET_MANAGER/ADMIN ([ADR-0015](0015-cross-tenant-memberships.md)). Bez ohľadu na
  e-mailovú adresu — čokoľvek, aj cudziu.
- Tu záznam vytvára **výslovne správca majetku (ASSET_MANAGER/ADMIN)** — presne tá rola,
  ktorá už dnes smie vytvárať pozvánky (`POST /v1/invitations`). Žiadna nová RBAC výnimka.
- Tu je rozsah navyše obmedzený na **DOMAIN_RESTRICTED organizácie** a **len domény z
  `autoJoinDomains`** — nedá sa tak zaevidovať ľubovoľná/cudzia e-mailová adresa, len
  overená firemná doména, ktorú si organizácia sama nastavila.
- `LoanRequest.beneficiaryId` a `Loan.borrowerId` **sa nemenia** — ostávajú presne tak, ako
  ich zaviedlo [ADR-0023](0023-loan-beneficiary-and-direct-loan.md) (povinný, odkaz na
  existujúceho `User` s aktívnym `Membership`). Namiesto rozširovania schémy žiadosti (ako
  navrhovala zamietnutá možnosť A v 0032 — `pendingBeneficiary` voľný text) sa problém rieši
  **skôr v procese** — reálny `User` + `Membership` vznikne pri predpríprave, nie pri
  žiadosti.

0032 zostáva zamietnuté presne v pôvodnom rozsahu (EMPLOYEE nesmie žiadosťou vyvolať vznik
záznamu pre ľubovoľnú osobu). Toto ADR rieši úzko iný, doplnkový scenár.

### Technický základ — mechanizmus už existuje

Auto-join podľa firemnej domény (`attemptDomainAutoJoin` v
[oauth.routes.ts](../../apps/api/src/modules/auth/oauth.routes.ts)) pri prvom SSO
prihlásení už dnes:

1. nájde existujúceho globálneho `User` podľa e-mailu (`usersCol.findOne({ email })`),
2. ak nemá aktívne membership v cieľovej org, dolinkuje OAuth provider na **existujúci**
   `User` záznam a vytvorí mu `Membership` — **bez duplicity**,
3. ak má už aktívne membership, len aktualizuje `lastLoginAt`.

Čiže "zmena predpripraveného záznamu na živý účet pri prvom prihlásení" je mechanizmus,
ktorý už funguje — treba len umožniť, aby `User` + `Membership` vznikli **skôr**, než sa
osoba prvýkrát prihlási.

### Gatekeeper na strane žiadosti (loans.service.ts)

`assertBeneficiaryIsActiveMember()` vyžaduje, aby `beneficiaryId`/`borrowerId` odkazovali na
**aktívne `Membership`** v tenante — nestačí len `User` bez membership. Predpríprava musí
teda vytvoriť **obe** (User aj Membership), nie len jedno z nich.

## Rozhodnutie

Rozhodnuté priamo v konverzácii (2026-07-14), potvrdené štruktúrovanými otázkami:

1. **Rola pri vytvorení:** vždy `EMPLOYEE` (bezpečný default; správca ju môže neskôr
   zmeniť cez existujúci `PATCH /v1/memberships/:id`).
2. **Zrušenie (nábor nevyšiel):** manuálna deaktivácia správcom — **žiadne mazanie**.
   Použije sa existujúci mechanizmus `Membership.status = 'SUSPENDED'` (rovnaký, akým sa
   dnes suspenduje ktorýkoľvek iný člen cez `PATCH /v1/memberships/:id`). `User` záznam sa
   nikdy nemaže — soft-delete nie je potrebný, stačí odpojiť membership.
3. **UI:** vstupný bod je v existujúcom zozname členov/používateľov (vedľa bežného
   pozvania), nie samostatná sekcia v Nastaveniach.
4. **Rozsah:** natrvalo len pre organizácie s `memberJoinPolicy: DOMAIN_RESTRICTED`. Bez
   plánu rozšíriť na `INVITE_ONLY`.
5. **Vzťah k ADR-0032:** samostatné ADR, s odkazom a vysvetlením rozdielu (vyššie). 0032
   ostáva zamietnuté v pôvodnom znení a rozsahu.

### Návrh API/schémy (na doladenie v implementačnej fáze, K1)

- **Nový endpoint `POST /v1/memberships/pre-provisioned`** — RBAC `ASSET_MANAGER`/`ADMIN`
  (rovnaká úroveň ako `POST /v1/invitations`).
  - Telo: `{ firstName, lastName, localPart, domain }`.
  - Validácia: `organisation.memberJoinPolicy === 'DOMAIN_RESTRICTED'` (inak `400`);
    `domain` ∈ `organisation.autoJoinDomains` (case-insensitive, inak `400`); zložený
    e-mail (`localPart@domain`, lowercase) musí byť globálne unikátny medzi `users`
    (inak `409`, rovnaký pattern ako duplicate-check v `registration.routes.ts`).
  - Vytvorí `User` (`accountType: ENTRA_ID` — rovnaký typ, aký `attemptDomainAutoJoin`
    použije pri reálnom prvom SSO prihlásení; `authProviders: []`, `passwordHash: null`,
    `emailVerified: false`, `lastLoginAt: null`) a `Membership`
    (`role: EMPLOYEE`, `status: 'ACTIVE'`, `invitedBy: <actorId>`, `invitedAt: now`,
    `acceptedAt: null`).
  - Audit event (nový, napr. `MEMBER_PRE_PROVISIONED`), rovnaké GDPR metadata
    (`dataCategories: ['workforce_management']`) ako existujúci invite flow.
- **`GET /v1/members` (picker) a `GET /v1/memberships`** — doplniť do projekcie/odpovede
  odvodený príznak (`hasLoggedIn: user.lastLoginAt !== null`), aby UI vedelo zobraziť
  odznak „Očakáva sa nástup" bez novej schémy — `lastLoginAt: null` už dnes prirodzene
  znamená „nikdy sa neprihlásil".
- **Žiadna zmena** `LoanRequestSchema`, `LoanSchema`, `assertBeneficiaryIsActiveMember` —
  predpripravená osoba je z pohľadu žiadostí úplne rovnocenná s bežným členom.

### Otvorený implementačný detail

`PATCH /v1/memberships/:id` je dnes `ADMIN`-only (nie `ASSET_MANAGER`) — teda ten, kto smie
osobu predpripraviť (ASSET_MANAGER), by ju nemusel smieť sám zablokovať, ak sa nábor
zruší. Toto je existujúca asymetria v RBAC (platí už dnes pre bežných členov), nie niečo,
čo zavádza toto ADR — necháva sa bez zmeny, pokiaľ Ján nepovie inak.

## Dôsledky

### Pozitívne

- Správca majetku vie vopred zaevidovať a schváliť žiadosť o výbavu pre nastupujúceho
  zamestnanca — presne nahlásený scenár.
- Nemení sa schéma `LoanRequest`/`Loan` ani gatekeeper princíp z ADR-0023 — predpripravený
  člen je nerozlíšiteľný od bežného člena na úrovni žiadostí.
- Znovupoužitie existujúceho merge-by-email mechanizmu (`attemptDomainAutoJoin`) — žiadna
  nová logika na strane prvého prihlásenia, žiadne riziko duplicitného `User`.
- Zrušenie/deaktivácia využíva existujúci, už testovaný `Membership.status = SUSPENDED`
  mechanizmus — žiadne nové mazanie dát.

### Negatívne / kompromisy

- Nový endpoint a nová audit akcia navyše (malý rozsah, ale je to nový write path).
- `User` záznam môže existovať mesiace bez prihlásenia — treba UI odznak, aby nebolo možné
  zameniť si predpripravenú osobu za reálne aktívneho člena (napr. v exportoch/reportoch).

### Riziká, ktoré treba sledovať

- **Preklep v e-maile pri vytváraní.** Ak správca zadá `localPart` s chybou, osoba sa pri
  prvom prihlásení nenapojí na predpripravený záznam (vznikne DUPLICATE `User` s iným
  e-mailom) a žiadosti ostanú viazané na "osirelý" predpripravený záznam. Mitigácia:
  potvrdzovacie zobrazenie zloženého e-mailu pred uložením + jasný odznak v zozname členov.
- **Nezrušené predpripravené záznamy.** Ak nábor nevyjde a správca zabudne
  zablokovať/zneaktívniť, záznam ostáva "ACTIVE" bez prihlásenia neobmedzene dlho.
  Mitigácia (mimo rozsahu K1, možné neskôr): report „predpripravení členovia bez
  prihlásenia > 90 dní" pre ADMIN.

## Fázovanie

- **K1** — schema/lib: `CreatePreProvisionedMemberSchema` (shared-types), validácie
  (DOMAIN_RESTRICTED, domain ∈ autoJoinDomains, email uniqueness); regen JSON Schema +
  OpenAPI.
- **K2** — `POST /v1/memberships/pre-provisioned` route + service (User + Membership
  transakčne), audit event `MEMBER_PRE_PROVISIONED`.
- **K3** — `GET /v1/members` + `GET /v1/memberships`: doplniť `hasLoggedIn` do odpovede.
- **K4** — UI: tlačidlo „Pridať budúceho používateľa" v zozname členov, formulár
  (meno/priezvisko + local-part + domain select z `autoJoinDomains`), odznak „Očakáva
  nástup" v zozname (na základe `hasLoggedIn`).
- **K5** — testy: RBAC (len ASSET_MANAGER/ADMIN), validácie (non-DOMAIN_RESTRICTED org
  zamietnutá, domain mimo allowlist zamietnutá, duplicate email 409), end-to-end merge
  test (predpripravený `User` + prvé SSO prihlásenie cez `attemptDomainAutoJoin` → žiadny
  duplicitný User, membership sa reuse-ne), beneficiary/borrower happy-path s
  predpripraveným členom.
- **K6** — OpenAPI + `api-types.ts` regen; user-guide návod (ako pridať budúceho
  zamestnanca); milestone/session doc.

## Referencie

- [ADR-0013 Multi-provider auth + self-serve onboarding](0013-multi-provider-auth-self-serve.md) — `memberJoinPolicy`, `DOMAIN_RESTRICTED`
- [ADR-0015 Cross-tenant memberships](0015-cross-tenant-memberships.md) — globálny `User`, `Membership`, dôvod zrušenia ghost-user patternu (kontrast s týmto ADR — iný účel, nie pending invite)
- [ADR-0023 Loan beneficiary + direct loan](0023-loan-beneficiary-and-direct-loan.md) — `beneficiaryId`/`borrowerId` model, bez zmeny
- [ADR-0029 Single hierarchical role](0029-single-hierarchical-role.md) — `EMPLOYEE` default rola
- [ADR-0032 Žiadosť pre nezaregistrovaného beneficiary (zamietnuté)](0032-loan-request-unregistered-beneficiary.md) — prečo je tento návrh iný a nekonfliktuje s dôvodom zamietnutia
- [apps/api/src/lib/auto-join.ts](../../apps/api/src/lib/auto-join.ts) — `selectAutoJoinOrg`, čistá funkcia výberu org
- [apps/api/src/modules/auth/oauth.routes.ts](../../apps/api/src/modules/auth/oauth.routes.ts) — `attemptDomainAutoJoin`, merge-by-email logika (opätovne použitá, nezmenená)
- [apps/api/src/modules/loans/loans.service.ts](../../apps/api/src/modules/loans/loans.service.ts) — `assertBeneficiaryIsActiveMember`
- [apps/api/src/modules/memberships/memberships.routes.ts](../../apps/api/src/modules/memberships/memberships.routes.ts) — `PATCH /v1/memberships/:id` (status SUSPENDED, ADMIN only)
- [packages/shared-types/src/schemas/organisation.ts](../../packages/shared-types/src/schemas/organisation.ts) — `memberJoinPolicy`, `autoJoinDomains`
- [packages/shared-types/src/schemas/membership.ts](../../packages/shared-types/src/schemas/membership.ts) — `Membership.status`, `acceptedAt` nullable (vzor pre „existuje, ale nie je aktívny")
