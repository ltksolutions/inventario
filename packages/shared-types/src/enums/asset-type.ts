// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * @deprecated Statický enum typov majetku — NAHRADENÝ per-tenant
 * kolekciou `asset_types` (AssetTypeEntry). Kategórie aj majetok
 * referencujú typ cez slug (`assetTypeSlug` / `asset.type`).
 * Enum ostáva len pre staré testy a migráciu enum → slug.
 */
export const AssetType = {
  /** IT majetok — notebooky, mobily, monitory, sieťové zariadenia. */
  IT: 'IT',
  /** Športová výstroj — dresy, kopačky, lopty, chrániče. */
  SPORTS_GEAR: 'SPORTS_GEAR',
  /** Tréningové vybavenie — méta, kužele, taktická tabuľa, brány. */
  TRAINING_EQUIPMENT: 'TRAINING_EQUIPMENT',
  /** Kancelárske vybavenie — stoličky, stoly, tlačiarne. */
  OFFICE_EQUIPMENT: 'OFFICE_EQUIPMENT',
  /** Médiá a video — kamery, mikrofóny, stojany. */
  MEDIA: 'MEDIA',
  /** Komunikácia — rádiové stanice, headsety. */
  COMMUNICATION: 'COMMUNICATION',
  /** Iné — všetko, čo nepatrí do vyššie uvedených. */
  OTHER: 'OTHER',
} as const;

export type AssetType = (typeof AssetType)[keyof typeof AssetType];

export const ASSET_TYPE_VALUES = Object.values(AssetType) as readonly AssetType[];

/**
 * Stav fyzickej kondície majetku — používa sa pri preberacích protokoloch.
 */
export const AssetCondition = {
  /** Nové, nepoužité. */
  NEW: 'NEW',
  /** Výborný stav, ako nové. */
  EXCELLENT: 'EXCELLENT',
  /** Dobrý stav, bežné stopy používania. */
  GOOD: 'GOOD',
  /** Použiteľné, ale viditeľné opotrebenie. */
  FAIR: 'FAIR',
  /** Slabý stav, vyžaduje pozornosť alebo opravu. */
  POOR: 'POOR',
  /** Nepoužiteľné, na vyradenie. */
  UNUSABLE: 'UNUSABLE',
} as const;

export type AssetCondition = (typeof AssetCondition)[keyof typeof AssetCondition];

export const ASSET_CONDITION_VALUES = Object.values(AssetCondition) as readonly AssetCondition[];
