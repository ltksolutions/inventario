// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Typy lokalít — fyzické miesta, kde sa majetok môže nachádzať.
 */
export const LocationType = {
  /** Hlavné sídlo organizácie (centrála). */
  HEADQUARTERS: 'HEADQUARTERS',
  /** Pobočka — vedľajšia prevádzka alebo regionálne pracovisko. */
  BRANCH: 'BRANCH',
  /** Hlavný sklad. */
  WAREHOUSE: 'WAREHOUSE',
  /** Kancelária. */
  OFFICE: 'OFFICE',
  /** Štadión alebo športový areál. */
  STADIUM: 'STADIUM',
  /** Tréningové centrum. */
  TRAINING_CENTER: 'TRAINING_CENTER',
  /** Externé miesto (klubová budova, zahraničie počas výjazdu). */
  EXTERNAL: 'EXTERNAL',
  /** Položka momentálne v preprave medzi lokalitami. */
  IN_TRANSIT: 'IN_TRANSIT',
} as const;

export type LocationType = (typeof LocationType)[keyof typeof LocationType];

export const LOCATION_TYPE_VALUES = Object.values(LocationType) as readonly LocationType[];
