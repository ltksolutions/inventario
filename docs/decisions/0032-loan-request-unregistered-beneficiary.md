<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0032. Žiadosť o výpožičku pre osobu bez User záznamu (nezaregistrovaný beneficiary)

|                   |                                                                                                                                                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | ❌ Rejected (2026-07-01) — beneficiary musí byť existujúci `User`, bez výnimky                                                                                                                                                                                                          |
| **Dátum**         | 2026-07-01                                                                                                                                                                                                                                                                              |
| **Autori**        | Ján Letko, Claude Sonnet 5 (LTK Solutions)                                                                                                                                                                                                                                              |
| **Súvisiace ADR** | [0023 Loan beneficiary + direct loan](0023-loan-beneficiary-and-direct-loan.md), [0015 Cross-tenant memberships](0015-cross-tenant-memberships.md), [0026 Catalog requests](0026-catalog-requests-and-fulfilment.md), [0029 Single hierarchical role](0029-single-hierarchical-role.md) |

## Kontext

[ADR-0023](0023-loan-beneficiary-and-direct-loan.md) zaviedlo `beneficiaryId` na
`LoanRequest` — žiadosť môže byť podaná v mene inej osoby (tréner žiada za hráča,
asistent za kolegu). Validácia je ale striktná: `beneficiaryId` **musí byť aktívny
používateľ v tom istom tenante**.

Reálny scenár, ktorý dnešný model nepokrýva: manažér chce vopred zaevidovať žiadosť
o výbavu (laptop, telefón, dresy) **pre nového zamestnanca, ktorý ešte nemá v systéme
žiadny záznam** — nastupuje o týždeň/mesiac, personálny proces ešte nebeží, e-mail
môže byť aj neznámy. Beneficiary v tomto momente neexistuje ako `User` a ani ako
`Invitation` (pozvánka).

### Prečo to nie je len „pošli pozvánku najprv"

Preverili sme existujúci invite flow ([apps/api/src/modules/invitations](../../apps/api/src/modules/invitations/invitations.routes.ts)):

- `POST /v1/invitations` vytvorí `Invitation`, nie `User` — reálny `User` +
  `Membership` vznikne až pri `accept-invitation`. Do vtedy beneficiary stále
  neexistuje ako `User`.
- Vytvoriť pozvánku smú **len `ASSET_MANAGER`/`ADMIN`** (`requireRole` v
  invitations.routes.ts).

Zadanie od Jána (viď rozhovor pred týmto ADR) je, že žiadosť za tretiu osobu má
zostať **rovnako otvorená ako dnes — EMPLOYEE+ smie žiadať za kohokoľvek**, bez
ohľadu na to, či daná osoba už existuje. Ak by riešenie vyžadovalo, aby žiadateľ
najprv vytvoril `Invitation`, fakticky by tým EMPLOYEE obišiel RBAC výsadu
vyhradenú pre ASSET_MANAGER/ADMIN. To je priamy konflikt, ktorý treba riešiť
návrhom schémy, nie len procesom.

### Obmedzenia (rovnaké princípy ako ADR-0023)

- **Žiadosť nič nevydáva.** Rovnako ako pri existujúcom beneficiary modeli — žiadosť
  je len úmysel/rezervácia. Skutočné vydanie majetku (`Loan`) je vždy akcia
  ASSET_MANAGER/ADMIN a **vyžaduje reálnu osobu** (majetok sa nedá fyzicky vydať
  neexistujúcemu človeku).
- **Schémy sú zdroj pravdy** (Zod → JSON Schema → Mongo `$jsonSchema` → OpenAPI) —
  rovnaký proces regenerácie ako pri ADR-0023.
- **GDPR/Article 30.** Meno (a prípadne e-mail) budúceho zamestnanca je osobný údaj.
  Kategória `dataCategories: ['workforce_management']` zostáva rovnaká ako pri
  existujúcom beneficiary toku — nejde o nový typ údajov, len o iný zdroj (voľný text
  namiesto referencie na `User`).

## Rozhodnutie Jána (2026-07-01)

**Zamietnuté v celom rozsahu.** `beneficiaryId` ostáva povinný a musí odkazovať na
existujúceho `User` — žiadny `pendingBeneficiary`, žiadny voľný text, žiadna
výnimka. Ak žiadosť potrebuje smerovať na osobu, ktorá ešte nie je v systéme, treba
ju najprv zaregistrovať (invite flow, ADR-0015) — mimo `LoanRequest`. Tento ADR sa
neimplementuje; ostáva ako záznam zváženej a zamietnutej možnosti pre budúcu
referenciu.

## Možnosti (zvažované, zamietnuté)

### A. „Pending beneficiary" — voľný text (meno + voliteľný e-mail), bez väzby na User

`LoanRequest` dostane nové pole `pendingBeneficiary: { firstName, lastName, email? }`.
`beneficiaryId` sa stane nullable — buď je vyplnené (existujúci User, dnešné
správanie), alebo je `null` a je vyplnené `pendingBeneficiary` (presne jedno z
dvoch, nikdy oboje/žiadne).

Pri **schvaľovaní** (`approveLoanRequest`) — ak je `beneficiaryId` stále `null`,
schválenie sa **zablokuje** s jasnou chybou („beneficiary treba najprv vyriešiť na
reálneho používateľa"). ASSET_MANAGER/ADMIN musí pred/počas schválenia dodať
skutočné `beneficiaryId` (osoba už môže v tom čase existovať — buď priamo vytvorená,
alebo dopĺňa políčko manuálne, keď nastúpi).

- **Plus:** EMPLOYEE+ môže žiadosť podať bez akejkoľvek invite-privilégie —
  presne v súlade so zadaním. Gatekeeper ostáva na schválení, rovnako ako pri
  direct loan v ADR-0023. Žiadna zmena RBAC pre `POST /v1/loan-requests`.
- **Plus:** Konzistentné s filozofiou ADR-0023 („žiadosť = úmysel, výpožička = akt
  správcu") — len rozširuje, čím môže byť neznámy beneficiary.
- **Mínus:** Vyžaduje manuálny krok správcu pri schválení (dohľadať/vytvoriť
  reálneho `User`, doplniť `beneficiaryId`). Bez automatizácie to môže byť
  otravné pri väčšom objeme.
- **Mínus:** Read-RBAC pre EMPLOYEE („vidím žiadosti kde beneficiaryId === self")
  logicky nefunguje, kým beneficiary nie je reálny — očakávané, no treba to UI
  jasne komunikovať („žiadosť čaká na osobu, ktorá ešte nie je v systéme").

### B. Žiadateľ musí najprv vytvoriť „shell" User cez invite endpoint

Formulár žiadosti by pri zadaní neznámej osoby spustil `POST /v1/invitations` na
pozadí a použil vzniknutý (neaktivovaný) záznam ako `beneficiaryId`.

- **Plus:** Žiadny nový stav na `LoanRequest` — `beneficiaryId` ostáva vždy
  vyplnené a vždy odkazuje na niečo, čo sa dá neskôr aktivovať.
- **Mínus:** Vytvorenie `Invitation` je dnes vyhradené ASSET_MANAGER/ADMIN. Aby to
  EMPLOYEE mohol spustiť z formulára žiadosti, treba buď obísť RBAC (riziko), alebo
  vytvoriť špeciálnu výnimku „create-invitation-as-side-effect-of-request" — nové
  a netransparentné rozšírenie oprávnení, ktoré ADR-0029 (jednoduchá lineárna
  hierarchia rolí) zámerne odmieta komplikovať.
  **Zamietnuté** pre konflikt so zadaním (EMPLOYEE+ musí môcť žiadať bez extra
  privilégií).

### C. Žiadosť za neregistrovanú osobu sa nedá podať vopred — počkať, až osoba existuje

- **Plus:** Žiadna zmena schémy ani kódu.
- **Mínus:** Nerieši reálny problém, ktorý Ján popísal (manažér chce vybaviť
  žiadosť vopred, nie stáť pri pulte v deň nástupu). **Zamietnuté** — presne ten
  istý dôvod, prečo ADR-0023 zamietlo možnosť A3 („žiadať len pre seba").

## Rozhodnutie _(navrhované — na potvrdenie)_

**Odporúčaná možnosť: A** — `pendingBeneficiary` ako voľný text, `beneficiaryId`
nullable, blokovanie schválenia kým beneficiary nie je reálny. Je to jediná
možnosť, ktorá zachováva "EMPLOYEE+ môže žiadať za kohokoľvek" bez toho, aby sa
menili invite-RBAC pravidlá z ADR-0015/0029.

Detailný návrh (na schválenie):

1. **Schéma `LoanRequest`:**
   - `beneficiaryId: ObjectIdSchema.nullable().default(null)` (bolo povinné).
   - Nové `pendingBeneficiary: z.object({ firstName, lastName, email: EmailSchema.optional() }).nullable().default(null)`.
   - Zod `.refine()`: presne jedno z `beneficiaryId` / `pendingBeneficiary` je
     vyplnené (nikdy oboje, nikdy žiadne) — okrem defaultu „žiadosť pre seba", kde
     sa `beneficiaryId` naďalej automaticky nastaví na `requesterId`, ak žiadateľ
     nezadá ani jedno z dvoch.
2. **`createLoanRequest`:** telo prijíma buď `beneficiaryId`, alebo
   `pendingBeneficiary` (XOR validácia v service, nie len v schéme — rovnaký
   pattern ako existujúca beneficiary-tenant validácia z ADR-0023).
3. **`approveLoanRequest`:** ak `beneficiaryId === null`, vráti `400` s kódom napr.
   `BENEFICIARY_NOT_RESOLVED` a správou nabádajúcou správcu doplniť reálne
   `beneficiaryId` (napr. cez nový parameter v approve-body, alebo osobitný
   `PATCH /v1/loan-requests/:id/resolve-beneficiary` — **otvorená otázka nižšie**).
4. **Read-RBAC:** bez zmeny formulácie (`requesterId === self OR beneficiaryId === self`)
   — `pendingBeneficiary` nič nepridáva k viditeľnosti, lebo neexistuje `User`, s
   ktorým by sa dalo porovnávať.
5. **UI:** v zozname žiadostí sa `pendingBeneficiary` zobrazí ako meno + odznak
   „osoba ešte nie je v systéme"; schvaľovacie tlačidlo je disabled/varuje, kým sa
   nedoplní reálne `beneficiaryId`.

### Otvorené otázky — potrebujem tvoje rozhodnutie

1. **Ako presne správca „doplní" beneficiaryId pri schválení?**
   - (a) Samostatný endpoint `PATCH /v1/loan-requests/:id/resolve-beneficiary`
     (ASSET_MANAGER/ADMIN), volaný predtým, než sa dá schváliť.
   - (b) `approveLoanRequest` prijme voliteľný `beneficiaryId` v tele — ak je
     poslaný, prepíše `pendingBeneficiary` a schváli v jednom kroku.
2. **Je e-mail v `pendingBeneficiary` povinný alebo voliteľný?** Voliteľný e-mail
   umožňuje neskôr (mimo rozsahu tohto ADR) automatické prepojenie s `Invitation`
   podľa zhody e-mailu — podobne ako existujúca cross-tenant email-match logika v
   `invitations.routes.ts` (K10). Navrhujem **voliteľný teraz**, auto-link ako
   samostatné budúce ADR, ak sa ukáže potreba (rovnaký vzor odkladania ako
   tímové žiadosti v ADR-0023).
3. **Má sa `pendingBeneficiary` dať editovať** (napr. zmena mena, keď HR doplní
   presné údaje), alebo je needitovateľný a treba žiadosť zrušiť a podať znova?

## Dôsledky

### Pozitívne

- Manažér/HR môže zaevidovať potrebu majetku pre nastupujúceho zamestnanca vopred,
  bez čakania na jeho onboarding — presne scenár, ktorý bol nahlásený ako problém.
- Nemení sa RBAC pre podávanie žiadostí ani pre invitations — žiadne nové
  privilégiá, žiadne obchádzanie ADR-0015/0029.
- Gatekeeper princíp z ADR-0023 (schválenie = akt správcu, žiadosť nič nevydáva)
  ostáva nedotknutý — len sa doplní o explicitný blok, keď beneficiary nie je
  reálny.

### Negatívne / kompromisy

- Ďalšie „nullable" pole a XOR validácia navyše (podobne k `requestId` nullable z
  ADR-0023) — kód, ktorý dnes čísta `beneficiaryId` ako isté, musí ošetriť `null`.
- Manuálny krok pri schválení (doplnenie reálneho beneficiary), kým nevznikne
  auto-link mechanizmus (odložené, pozri otvorenú otázku #2).

### Riziká, ktoré treba sledovať

- **Zabudnutý pending beneficiary.** Žiadosť môže zostať v `PENDING` stave s
  neresolvnutým beneficiary neobmedzene dlho. Mitigácia: report/filter
  „žiadosti čakajúce na osobu" pre ASSET_MANAGER/ADMIN (mimo rozsahu K1, možné
  neskôr).
- **Duplicitné/nekonzistentné meno.** Rôzni žiadatelia môžu zadať meno budúceho
  zamestnanca rôzne (preklepy) — pri resolvovaní na reálneho `User` treba manuálnu
  kontrolu, nie automatické párovanie podľa mena.

## Fázovanie _(navrhované, po schválení otvorených otázok)_

- **K1** — schema fixes: `beneficiaryId` nullable, `pendingBeneficiary` pole, XOR
  refine; regen JSON Schema + OpenAPI; migrácia (existujúce dokumenty majú
  `beneficiaryId` vyplnené, `pendingBeneficiary: null` — no-op backfill).
- **K2** — service: `createLoanRequest` prijíma `pendingBeneficiary` XOR
  `beneficiaryId`; validácia.
- **K3** — `approveLoanRequest`: blok schválenia + zvolený mechanizmus doplnenia
  (otvorená otázka #1).
- **K4** — UI: badge „osoba ešte nie je v systéme", disabled approve, doplnenie
  formulára o výber „pre existujúceho / pre nového človeka".
- **K5** — testy: XOR validácia, blok schválenia bez beneficiary, resolve flow,
  read-RBAC bez zmeny, migrácia.
- **K6** — OpenAPI + `api-types.ts` regen; milestone/session doc.

## Referencie

- [ADR-0023 Loan beneficiary + direct loan](0023-loan-beneficiary-and-direct-loan.md) — pôvodný beneficiary model, gatekeeper princíp
- [ADR-0015 Cross-tenant memberships](0015-cross-tenant-memberships.md) — invite/accept flow, `Invitation` vs `User`/`Membership`
- [ADR-0029 Single hierarchical role](0029-single-hierarchical-role.md) — dôvod, prečo sa RBAC výsady nemajú komplikovať výnimkami
- [apps/api/src/modules/invitations/invitations.routes.ts](../../apps/api/src/modules/invitations/invitations.routes.ts) — dnešný invite flow, RBAC (`ASSET_MANAGER`/`ADMIN`), cross-tenant email-match logika (K10)
- [packages/shared-types/src/schemas/loan.ts](../../packages/shared-types/src/schemas/loan.ts) — `LoanRequestSchema.beneficiaryId`
- [packages/shared-types/src/schemas/membership.ts](../../packages/shared-types/src/schemas/membership.ts) — `Membership.acceptedAt` nullable (vzor pre „existuje, ale nie je aktívny")
