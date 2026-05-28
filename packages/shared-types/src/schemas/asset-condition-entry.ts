// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { z } from 'zod';

import { BaseDocumentSchema, OrganisationScopedSchema, SoftDeleteSchema } from './common.js';

/**
 * AssetConditionEntry — per-tenant záznam v kolekcii `asset_conditions`.
 *
 * Nahradza statický enum `AssetCondition` per-tenant dynamickými hodnotami.
 * Default seed: NEW, EXCELLENT, GOOD, FAIR, POOR, UNUSABLE.
 */
export const AssetConditionEntrySchema = BaseDocumentSchema.merge(SoftDeleteSchema)
  .merge(OrganisationScopedSchema)
  .extend({
    /** Zobrazovaný názov (napr. "Nové", "Dobré", "Opotrebované"). */
    name: z.string().min(1).max(200).trim(),

    /** URL-safe identifikátor. Unique per tenant. Auto-generated z name. */
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug musí byť lowercase s pomlčkami.')
      .max(200),

    /** Lucide icon name pre UI (voliteľné). */
    icon: z.string().max(50).nullable().default(null),

    /** Farba pre UI badge (HEX, voliteľné). */
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Farba musí byť hex.')
      .nullable()
      .default(null),

    /** Či je kondícia aktívna (zobrazuje sa v comboboxe). */
    isActive: z.boolean().default(true),

    /** Poradie v zoznamoch (nižšie = lepší stav). */
    sortOrder: z.number().int().default(0),
  });

export type AssetConditionEntry = z.infer<typeof AssetConditionEntrySchema>;

export const CreateAssetConditionEntrySchema = AssetConditionEntrySchema.omit({
  _id: true,
  organisationId: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
});

export type CreateAssetConditionEntryInput = z.infer<typeof CreateAssetConditionEntrySchema>;

export const UpdateAssetConditionEntrySchema = AssetConditionEntrySchema.omit({
  _id: true,
  organisationId: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
}).partial();

export type UpdateAssetConditionEntryInput = z.infer<typeof UpdateAssetConditionEntrySchema>;
