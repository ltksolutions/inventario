/**
 * Typy skladových pohybov pre hromadné (BULK) položky (ADR-0020).
 *
 * StockMovement je append-only ledger — zdroj pravdy pre `quantityOnHand`.
 * Každý pohyb nesie znamienkové množstvo (`quantity`): kladné pripočítava
 * na sklad, záporné odpočítava. Súčet všetkých pohybov položky = aktuálny
 * stav na sklade.
 *
 * Fáza 1 (MVP) — 4 typy nižšie.
 * Fáza 2 (neskôr, per ADR-0020): TRANSFER (presun medzi lokalitami),
 *   STOCKTAKE (inventúrne zúčtovanie), WRITE_OFF (odpis/strata).
 */
export const StockMovementType = {
  /** Príjem na sklad (+). Napr. nákup, dar, počiatočný stav. */
  RECEIPT: 'RECEIPT',
  /** Výdaj na zápožičku (−). */
  LOAN_OUT: 'LOAN_OUT',
  /** Vrátenie zo zápožičky (+). */
  LOAN_RETURN: 'LOAN_RETURN',
  /** Ručná korekcia inventúry (±). Dôvod je povinný. */
  ADJUSTMENT: 'ADJUSTMENT',
} as const;

export type StockMovementType = (typeof StockMovementType)[keyof typeof StockMovementType];

export const STOCK_MOVEMENT_TYPE_VALUES = Object.values(
  StockMovementType,
) as readonly StockMovementType[];

/**
 * Znamienko množstva podľa typu pohybu — pomocná mapa pre service vrstvu.
 * `+1` = pohyb pripočítava na sklad, `−1` = odpočítava.
 * `ADJUSTMENT` je `0` (znamienko určuje hodnota `quantity` samotná).
 */
export const STOCK_MOVEMENT_SIGN: Record<StockMovementType, 1 | -1 | 0> = {
  RECEIPT: 1,
  LOAN_OUT: -1,
  LOAN_RETURN: 1,
  ADJUSTMENT: 0,
};
