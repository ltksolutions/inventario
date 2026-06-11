// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Stavy majetku v evidencii.
 *
 * Životný cyklus:
 *   AVAILABLE → RESERVED → BORROWED → AVAILABLE (vrátené)
 *   AVAILABLE → IN_SERVICE → AVAILABLE
 *   AVAILABLE → DISPOSED (vyradené)
 *   BORROWED → LOST (stratené počas zápožičky)
 */
export const AssetStatus = {
  /** Dostupné v sklade, pripravené na zápožičku. */
  AVAILABLE: 'AVAILABLE',
  /** Niekto požiadal o zápožičku, čaká sa na schválenie. */
  RESERVED: 'RESERVED',
  /** Aktívne zapožičané používateľovi. */
  BORROWED: 'BORROWED',
  /** V servise alebo na oprave. */
  IN_SERVICE: 'IN_SERVICE',
  /** Vyradené z evidencie (zastarané, predané, odpísané). */
  DISPOSED: 'DISPOSED',
  /** Stratené počas zápožičky. */
  LOST: 'LOST',
} as const;

export type AssetStatus = (typeof AssetStatus)[keyof typeof AssetStatus];

export const ASSET_STATUS_VALUES = Object.values(AssetStatus) as readonly AssetStatus[];
