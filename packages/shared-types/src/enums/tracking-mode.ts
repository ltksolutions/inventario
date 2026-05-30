/**
 * Spôsob sledovania položky majetku (ADR-0020).
 *
 * SERIALIZED — každý kus je vlastný záznam s vlastným inventárnym číslom,
 *   históriou a kondíciou. Prechádza stavovým automatom `AssetStatus`
 *   (AVAILABLE → RESERVED → BORROWED → …). Množstvo je implicitne 1.
 *   Vhodné pre drahý, jednotlivo sledovaný majetok (notebook, dron, bránka).
 *
 * BULK — jedna položka reprezentuje N zameniteľných kusov. Nemá per-kus
 *   identitu ani stavový automat; namiesto toho má `quantityOnHand` (cache
 *   odvodená zo StockMovement ledgera) a množstevné účtovníctvo. Vhodné pre
 *   hromadný, fungibilný materiál (kužele, rozlišovacie dresy, lopty).
 *
 * Default je SERIALIZED — všetky existujúce assety sú serializované, takže
 * pridanie tohto poľa nevyžaduje migráciu dát.
 */
export const TrackingMode = {
  /** Jednotlivo sledovaný kus (dnešný asset, množstvo 1). */
  SERIALIZED: 'SERIALIZED',
  /** Hromadná zameniteľná položka so skladovým množstvom. */
  BULK: 'BULK',
} as const;

export type TrackingMode = (typeof TrackingMode)[keyof typeof TrackingMode];

export const TRACKING_MODE_VALUES = Object.values(TrackingMode) as readonly TrackingMode[];
