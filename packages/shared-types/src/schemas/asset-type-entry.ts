// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { z } from 'zod';

import { BaseDocumentSchema, OrganisationScopedSchema, SoftDeleteSchema } from './common.js';

/**
 * AssetTypeEntry — per-tenant záznam v kolekcii `asset_types`.
 *
 * Nahradza statický enum `AssetType` per-tenant dynamickými hodnotami.
 * Každý tenant si môže pridávať vlastné typy (IT, SPORTS_GEAR, ...) a
 * premenovávať ich bez zásahu do kódu.
 *
 * Slug sa generuje zo `name` pri vytváraní (slugify) a regeneruje sa
 * pri rename (user explicitne súhlasí — audit log uchová entityId).
 */
export const AssetTypeEntrySchema = BaseDocumentSchema.merge(SoftDeleteSchema)
  .merge(OrganisationScopedSchema)
  .extend({
    /** Zobrazovaný názov (napr. "IT majetok", "Športová výstroj"). */
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

    /** Či je typ aktívny (zobrazuje sa v comboboxe). */
    isActive: z.boolean().default(true),

    /** Poradie v zoznamoch. */
    sortOrder: z.number().int().default(0),
  });

export type AssetTypeEntry = z.infer<typeof AssetTypeEntrySchema>;

export const CreateAssetTypeEntrySchema = AssetTypeEntrySchema.omit({
  _id: true,
  organisationId: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
});

export type CreateAssetTypeEntryInput = z.infer<typeof CreateAssetTypeEntrySchema>;

export const UpdateAssetTypeEntrySchema = AssetTypeEntrySchema.omit({
  _id: true,
  organisationId: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
}).partial();

export type UpdateAssetTypeEntryInput = z.infer<typeof UpdateAssetTypeEntrySchema>;
