# 0036. Vrátenie majetku od osoby — čiastočné a cross-loan vrátenie

|                   |                                                                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | ✅ Accepted (implementované 2026-07-16)                                                                                                                                                                                             |
| **Dátum**         | 2026-07-16                                                                                                                                                                                                                          |
| **Autori**        | Ján Letko (produkt), Claude (návrh + implementácia)                                                                                                                                                                                 |
| **Súvisiace ADR** | [ADR-0012](0012-loans-state-machine.md), [ADR-0020](0020-stock-and-bulk-items.md), [ADR-0022](0022-loan-protocol-pdf.md), [ADR-0023](0023-loan-beneficiary-and-direct-loan.md), [ADR-0026](0026-catalog-requests-and-fulfilment.md) |

## Kontext

Po nasadení UI pre vrátenie výpožičky (K4, 2026-07-16, tlačidlo „Vrátiť" na detaile
`Loan`-u) sa pri reálnom testovaní ukázala ďalšia potreba: keď má jedna osoba
požičaný majetok z **viacerých rôznych výpožičiek** (napr. notebook z jednej
žiadosti, monitor z inej, licenciu z tretej — každá vznikla samostatným vydaním,
teda samostatným `Loan`-om), správca musí dnes vrátenie riešiť **osobitne pre
každý `Loan`** a v rámci jedného `Loan`-u navyše musí vrátiť **všetky** jeho
položky naraz — čiastočné vrátenie (vrátiť len časť kusov, zvyšok nechať u osoby)
nie je podporované.

Reálny scenár: osoba končí v projekte/tíme a vracia všetko, čo má — alebo si
naopak necháva jeden kus (napr. notebook) a vracia zvyšok. Správca by mal vedieť
otvoriť **jednu obrazovku na osobe**, vidieť **všetko**, čo má aktuálne požičané
(cez všetky jej aktívne `Loan`-y), vybrať ľubovoľnú podmnožinu kusov a vytvoriť
**jeden** protokol o vrátení — bez ohľadu na to, z ktorej pôvodnej žiadosti/
výpožičky kusy pochádzajú.

Explicitne **NEMENÍME** existujúci per-`Loan` flow (tlačidlo „Vrátiť" na detaile
výpožičky, `POST /v1/loans/:id/return`) — ten ostáva ako rýchla cesta na vrátenie
**celej** jednej konkrétnej výpožičky naraz. Nový flow je **doplnková** možnosť,
nie náhrada.

### Obmedzenie, ktoré rušíme

`ReturnLoanSchema`/`returnLoan()` (`apps/api/src/modules/loans/loans.service.ts`)
dnes vyžaduje, aby telo požiadavky obsahovalo **všetky** položky daného `Loan`-u
(`for (const loanItem of loan.items) { if (!returnItemMap.has(loanItem.assetId))
throw 400 }`). ADR-0020 (bod 5, stavový diagram) už anticipoval stav
`PARTIALLY_RETURNED` pre BULK zápožičky, ale nikdy nebol implementovaný a bod 5
explicitne vylúčil SERIALIZED položky („Pre čisto SERIALIZED zápožičky sa
`PARTIALLY_RETURNED` nepoužije — správanie ostáva ako v ADR-0012."). Tento ADR
**mení** toto rozhodnutie: čiastočné vrátenie sa **rozširuje aj na SERIALIZED**
položky, motivované práve cross-loan flow-om od osoby — ale **len** cez nový
endpoint, nie cez existujúci `POST /v1/loans/:id/return`, ktorý si zachováva
pôvodné „všetko naraz" správanie.

## Možnosti

### Možnosť A: Nové pole `Loan.returnedItems[]` (presun kusov mimo `items[]`)

Pri čiastočnom vrátení by sa vrátené kusy presunuli z `items[]` do nového poľa
`returnedItems[]`, `items[]` by odteraz znamenalo len „čo je ešte vonku".

- Plus: `items[]` vždy = aktuálny stav bez nutnosti filtrovať.
- Mínus: **zbytočné** — `LoanItem.condition.atReturn` (nullable) už dnes existuje
  presne na tento účel a nikdy nebol využitý na čiastočné vrátenie, len na
  vyplnenie stavu pri vrátení celého `Loan`-u. Duplicitné dátové štruktúry pre tú
  istú informáciu (item je vrátený ⇔ `atReturn !== null`).
- Mínus: migrácia existujúcich čítaní `loan.items` (napr. `LoanDetailContent.tsx`
  zobrazenie), ktoré by museli začať čítať z dvoch polí naraz.

### Možnosť B: Využiť existujúce `LoanItem.condition.atReturn` (nullable) ako per-kus marker

`items[]` ostáva nemenné a obsahuje **celú históriu** kusov, ktoré boli v danom
`Loan`-e vydané. Kus je „stále vonku" ⇔ `condition.atReturn === null`, „vrátený"
⇔ `condition.atReturn !== null`. Čiastočné vrátenie = vyplniť `atReturn` len pre
vybranú podmnožinu; `Loan.status` prejde na nový stav `PARTIALLY_RETURNED`, kým
aspoň jeden kus zostáva `atReturn === null`.

- Plus: **žiadna nová dátová štruktúra** — len zrušenie guardu „všetko naraz" v
  service vrstve a doplnenie `LoanStatus.PARTIALLY_RETURNED` (presne ako
  anticipoval ADR-0020).
- Plus: spätne kompatibilné — existujúce `Loan` dokumenty a čítania fungujú bez
  zmeny (kým sa nikto nepokúsi o čiastočné vrátenie, `atReturn` je buď vždy `null`
  alebo vždy vyplnené pre všetky kusy, presne ako doteraz).
- Mínus: „čo je stále vonku" sa musí odvodiť filtrom (`items.filter(i =>
i.condition.atReturn === null)`) na viacerých miestach (nový GET endpoint,
  prípadne budúce reporty) — akceptovateľné, ide o `Array.filter` nad poľom s
  rádovo jednotkami/desiatkami prvkov.

## Rozhodnutie

**Možnosť B.** Rozširujeme existujúci `LoanItem.condition.atReturn` marker na
čiastočné vrátenie a dopĺňame `LoanStatus.PARTIALLY_RETURNED` — presne v duchu
už schváleného (ale nikdy neimplementovaného) plánu z ADR-0020, len rozšíreného
aj na SERIALIZED položky.

### Zmeny dátového modelu

**`packages/shared-types/src/enums/loan-status.ts`**

```ts
export const LoanStatus = {
  ACTIVE: 'ACTIVE',
  OVERDUE: 'OVERDUE',
  PARTIALLY_RETURNED: 'PARTIALLY_RETURNED', // NOVÉ — aspoň 1 kus vrátený, aspoň 1 stále vonku
  RETURNED: 'RETURNED',
  DAMAGED: 'DAMAGED',
  LOST: 'LOST',
} as const;
```

`ACTIVE`/`OVERDUE` → `PARTIALLY_RETURNED` (prvé čiastočné vrátenie) →
`PARTIALLY_RETURNED` (ďalšie čiastočné vrátenie) → `RETURNED`/`DAMAGED`
(dovrátenie posledného zostávajúceho kusu). Pri vrátení **všetkého** naraz sa
`PARTIALLY_RETURNED` medzistavom neprejde (rovnako ako doteraz).

**`packages/shared-types/src/schemas/loan-protocol.ts`**

```ts
export const LoanProtocolSchema = BaseDocumentSchema.merge(
  OrganisationScopedSchema,
).extend({
  type: z.enum(['HANDOVER', 'RETURN', 'AMENDMENT']),
  loanId: ObjectIdSchema, // ostáva — „primárny" loan, spätná kompatibilita
  loanIds: z.array(ObjectIdSchema).min(1), // NOVÉ — všetky loans pokryté týmto protokolom, vždy explicitne dodané pri vzniku
  // ...
});
```

`loanIds` je vždy neprázdny a vždy obsahuje `loanId` ako prvý prvok. Pre
`HANDOVER` a bežný (per-`Loan`) `RETURN` protokol je `loanIds = [loanId]` —
žiadna zmena správania. Pre nový cross-loan `RETURN` protokol obsahuje `loanIds`
ID všetkých `Loan`-ov, z ktorých pochádza aspoň jeden vrátený kus v danom
protokole; každá položka v `protocolItems` navyše nesie `loanId`, z ktorého
konkrétny kus pochádza (potrebné pre PDF, aby bolo jasné, ktorý kus patril ku
ktorej pôvodnej výpožičke).

**`apps/api/src/modules/protocols/loan-protocols.repository.ts`**

`findByLoanId(tenantId, loanId)` sa zmení z `{ organisationId, loanId }` na
`{ organisationId, loanIds: loanId }` (MongoDB automaticky matchuje scalar proti
poľu) — inak by sa cross-loan protokol nezobrazil v sekcii „Protokoly" na
detaile OSTATNÝCH výpožičiek, ktoré pokrýva (len na tej s `loanId ===
protocol.loanId`, čo by bola len jedna z viacerých). Index `organisationId_loanId`
sa zmení na multikey index `{ organisationId: 1, loanIds: 1 }`.

### Nové API

**`GET /v1/users/:id/borrowed-items`** (ASSET_MANAGER/ADMIN) — vráti flatten
zoznam všetkých kusov, ktoré má daná osoba aktuálne požičané cez **všetky** jej
`Loan`-y v stavoch `ACTIVE`/`OVERDUE`/`PARTIALLY_RETURNED`, kde
`condition.atReturn === null`. Každý riadok nesie `loanId`, `assetId`,
`snapshot`, `quantity` (BULK) — presne dosť na to, aby frontend vedel zoskupiť
podľa pôvodnej výpožičky a poslať výber späť s referenciou na `loanId`.

**`POST /v1/users/:id/return-items`** (ASSET_MANAGER/ADMIN) — telo:

```ts
{
  returnedTo: ObjectId, // vždy aktuálny actor, rovnako ako pri POST /v1/loans/:id/return
  items: Array<{ loanId: ObjectId; assetId: ObjectId; condition; note?; requiresService? }>,
  notes?: string;
}
```

Service metóda `returnItemsForBorrower(borrowerId, input, actor, request)` v
jednej transakcii:

1. Zoskupí `items` podľa `loanId`. Pre každý loan overí `borrowerId` a že
   všetky vybrané `assetId` majú v danom `Loan`-e `condition.atReturn === null`
   (t. j. sú skutočne stále vonku).
2. Pre každý vybraný kus zavolá **rovnakú** per-kus logiku, akú dnes má
   `returnLoan()` (BULK → `stockService.recordLoanReturn`, SERIALIZED →
   `assetsRepo.update` na `AVAILABLE`/`IN_SERVICE`), vyplní
   `items[i].condition.atReturn` v rámci príslušného `Loan`-u.
3. Po prejdení všetkých vybraných kusov v danom `Loan`-e: ak **žiadny** kus v
   `loan.items` nemá `atReturn === null` → terminálny stav (`RETURNED`/
   `DAMAGED`, presne ako doteraz), inak → `PARTIALLY_RETURNED`.
4. Vytvorí **jeden** `RETURN` protokol s `loanIds` = zoznam všetkých
   dotknutých `Loan`-ov, `items` = všetky vrátené kusy (s `loanId` per
   položka). Nastaví `returnProtocolId` na **každom** dotknutom `Loan`-e (ak
   `Loan` už mal `returnProtocolId` z predošlého čiastočného vrátenia, prepíše
   sa na najnovší — zobrazuje sa len posledný, história je v samotných
   protokoloch podľa `loanIds`).

Existujúci `POST /v1/loans/:id/return` a `returnLoan()` **ostávajú bez zmeny**
funkčne (stále vyžadujú všetky položky naraz) — interne môžu, ale nemusia,
zdieľať per-kus helper s novou metódou (implementačný detail, nie rozhodnutie
tohto ADR).

### Frontend

Tlačidlo „Vrátiť majetok" na `/users/[id]` (viditeľné len pre ASSET_MANAGER/
ADMIN a len ak osoba má aspoň 1 aktuálne požičaný kus) otvorí komponentu
(rozšírenie/refaktor `ReturnLoanModal.tsx`) so zoznamom **všetkých** požičaných
kusov danej osoby (zoskupené podľa pôvodnej výpožičky pre prehľadnosť), s
checkboxom per kus + per-kus stav/poznámka/„vyžaduje servis" — presne ako dnešný
modál, len nad väčšou a cross-loan množinou dát. Existujúce tlačidlo „Vrátiť" na
detaile jednej výpožičky **ostáva nezmenené** (rozhodnutie Janiky, 2026-07-16).

## Dôsledky

### Pozitívne

- Žiadna nová dátová štruktúra pre históriu vrátenia — znovupoužitie
  `condition.atReturn`, ktoré už existovalo, len sa nevyužívalo na čiastočnosť.
- Implementuje `PARTIALLY_RETURNED`, ktorý ADR-0020 už anticipoval — nie je to
  prekvapenie v stavovom modeli, len doplnenie chýbajúceho kúska.
- Jeden protokol pokrývajúci viac výpožičiek zjednodušuje papierovanie pri
  odchode osoby z tímu/projektu — presne motivácia z reálneho testovania.
- Starý per-`Loan` flow ostáva nedotknutý — nulové riziko regresie pre bežný
  „vrátil jeden notebook" prípad.

### Negatívne / kompromisy

- Dva spôsoby vrátenia (per-`Loan` úplné, per-osoba čiastočné/cross-loan)
  existujú súčasne — vyššia povrchová plocha na testovanie a údržbu, vedomý
  kompromis (explicitné rozhodnutie Janiky ponechať oba).
- `LoanProtocol.loanId` (singular) sa stáva „len prvým z `loanIds`" pre
  cross-loan protokoly — každý budúci kód, ktorý by spoliehal na
  `protocol.loanId` ako _jediný_ zdroj pravdy, musí prejsť na `loanIds`.
- `findByLoanId` prechádza na multikey index — mierne drahšie na insert
  (viac index entries), zanedbateľné pri objeme dát tenanta.

### Riziká, ktoré treba sledovať

- **Konzistentnosť medzi `Loan.status` a `condition.atReturn`.** Prechod na
  `PARTIALLY_RETURNED`/`RETURNED` sa musí počítať vždy nanovo z aktuálneho
  stavu `items[]` v tej istej transakcii, nie ukladať nezávisle — inak hrozí
  drift (podobné riziko ako `quantityOnHand` cache v ADR-0020).
- **Concurrency.** Dvaja správcovia vracajú rôzne kusy tej istej osoby súčasne
  (rôzne `Loan`-y, alebo dokonca ten istý `Loan`) — treba transakčný
  `findOneAndUpdate` guard rovnako ako pri BULK výdaji (ADR-0020 riziká).
- **BULK v cross-loan flow.** Táto revízia rieši per-kus (SERIALIZED) a
  per-riadok (celý zvyšný `quantity` BULK riadku) výber — **nerieši** delenie
  jedného BULK riadku na časti v rámci jedného vrátenia (to je stále Fáza 2 z
  ADR-0020, `quantityReturned` accumulator). BULK riadok sa v novom flow-e
  vracia buď celý, alebo sa nezahrnie.

## Referencie

- [ADR-0012 Loans state machine](0012-loans-state-machine.md)
- [ADR-0020 Sklad & BULK — bod 5, stavový diagram s `PARTIALLY_RETURNED`](0020-stock-and-bulk-items.md)
- [ADR-0022 Preberacie protokoly — model, on-demand PDF a podpisy](0022-loan-protocol-pdf.md)
- [ADR-0023 Loan beneficiary a direct loan](0023-loan-beneficiary-and-direct-loan.md)
- [ADR-0026 Katalógové žiadosti a fulfilment](0026-catalog-requests-and-fulfilment.md)
- [packages/shared-types/src/schemas/loan.ts](../../packages/shared-types/src/schemas/loan.ts)
- [packages/shared-types/src/schemas/loan-protocol.ts](../../packages/shared-types/src/schemas/loan-protocol.ts)
- [packages/shared-types/src/enums/loan-status.ts](../../packages/shared-types/src/enums/loan-status.ts)
- [apps/api/src/modules/loans/loans.service.ts](../../apps/api/src/modules/loans/loans.service.ts) — `returnLoan()`, vzor pre `returnItemsForBorrower()`
- [apps/api/src/modules/protocols/loan-protocols.repository.ts](../../apps/api/src/modules/protocols/loan-protocols.repository.ts) — `findByLoanId`
- [apps/web/src/components/ReturnLoanModal.tsx](../../apps/web/src/components/ReturnLoanModal.tsx) — základ pre cross-loan komponentu
