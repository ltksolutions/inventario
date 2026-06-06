# NEXT

## Aktuálny stav (2026-06-06)

Prebehlo testovanie formulárov na `app.inventario.estate` (SFZ tenant). Väčšina kritických bugov opravená. Pridávanie majetku funguje keď je nastavený `inventoryNumberFormat`.

## Čo treba spraviť ako ďalšie

### 1. RECEIPT pohyb pri vytvorení BULK majetku (P0, ~1h)

**Problém:** Pri vytvorení BULK položky s `initialQuantity` sa `quantityOnHand` nenastaví a nevytvorí sa StockMovement RECEIPT záznam.

**Čo treba:**

- `assets.routes.ts` — injektnúť `StockMovementsRepository` do `AssetsService` konštruktora
- `assets.service.ts` — po inserte BULK assetu v transakcii:
  1. `stockMovementsRepo.insert({ type: 'RECEIPT', quantity: initialQty, ... }, session)`
  2. `repo.update(tenantId, assetId, { quantityOnHand: initialQty, ... }, session)`
- Testy: BULK create → `quantityOnHand` = `initialQuantity`, RECEIPT záznam v `stock_movements`

Viď TODO.md #P0.

### 2. Otestovať pridanie majetku end-to-end (P0)

- Najprv nastaviť `inventoryNumberFormat` v Organizácia → napr. prefix `SFZ`, padding 4, rok zapnutý
- Pridať SERIALIZED majetok (notebook) → overiť inventárne číslo
- Pridať BULK majetok (lopty) s počtom → overiť `quantityOnHand` v MongoDB

### 3. Sklad stránka pre BULK majetok (P1)

- `WarehouseContent` / Sklad tab — zobraziť množstvo, pohyby
- Vizuálne odlíšenie BULK vs SERIALIZED v zozname

## Referencie

- Session doc: `docs/sessions/2026-06-06-testing-forms-ciselníky-org-settings.md`
- TODO.md: pozri P0 sekciu
