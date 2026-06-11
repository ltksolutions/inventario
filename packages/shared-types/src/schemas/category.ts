// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { z } from 'zod';

import {
  BaseDocumentSchema,
  ObjectIdSchema,
  OrganisationScopedSchema,
  SoftDeleteSchema,
} from './common.js';

/**
 * Kategória majetku — dvojúrovňový číselník (root + hodnoty), JEDINÝ
 * číselník klasifikácie majetku (zlúčenie s "Typmi majetku", 2026-06-08;
 * sploštenie na 2 úrovne, 2026-06-09).
 *
 * Presne 2 úrovne (vynucuje CategoriesService cez CATEGORY_MAX_DEPTH = 1):
 *   - ROOT kategórie (parentId = null) plnia rolu typov majetku — slúžia
 *     len na zoskupenie. Majetok sa do nich zaradiť nedá.
 *   - HODNOTY (parentId = root) sú priame deti rootu — sem sa zaraďuje
 *     majetok (vynucuje AssetsService). Hodnota nemôže mať vlastné deti.
 *
 * Príklad hierarchie:
 *   IT majetok            ← root = "typ" (len zoskupuje)
 *   ├── Notebooky         ← hodnota (sem sa zaraďuje majetok)
 *   ├── Stolné počítače   ← hodnota
 *   └── Monitory          ← hodnota
 */
export const CategorySchema = BaseDocumentSchema.merge(SoftDeleteSchema)
  .merge(OrganisationScopedSchema)
  .extend({
    /** Názov kategórie. */
    name: z.string().min(1).max(200).trim(),

    /** Slug pre URL (auto-generated z name). */
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug musí byť lowercase s pomlčkami.')
      .max(200),

    /** ID nadradenej kategórie (null pre root kategórie = "typy majetku"). */
    parentId: ObjectIdSchema.nullable().default(null),

    /** Voliteľný popis. */
    description: z.string().max(1000).nullable().default(null),

    /** Ikonka pre UI (lucide-react icon name). */
    icon: z.string().max(50).nullable().default(null),

    /** Farba kategórie v UI (HEX, z design tokens accent palety). */
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Farba musí byť hex (napr. #1450df).')
      .nullable()
      .default(null),

    /** ID schvaľovateľov, ktorí môžu schvaľovať zápožičky tejto kategórie. */
    approverIds: z.array(ObjectIdSchema).default([]),

    /** Či zápožičky tejto kategórie vyžadujú schválenie (default per asset, ale tu globálne). */
    requiresApprovalByDefault: z.boolean().default(true),

    /** Maximálna doba zápožičky v dňoch (null = bez limitu). */
    maxLoanDays: z.number().int().positive().max(3650).nullable().default(null),

    /** Či je kategória aktívna (môže sa pridávať nový majetok). */
    isActive: z.boolean().default(true),

    /** Poradie v zoznamoch (nižšie = vyššie). */
    sortOrder: z.number().int().default(0),
  });

export type Category = z.infer<typeof CategorySchema>;

export const CreateCategorySchema = CategorySchema.omit({
  _id: true,
  organisationId: true, // Server-provided from authenticated context
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
});

export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;

/**
 * Patch schéma pre update kategórie. Všetky polia voliteľné — caller
 * posíla iba tie, ktoré chce zmeniť. Audit + identity polia (`_id`,
 * `organisationId`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`,
 * `deletedAt`, `deletedBy`) sú vylúčené — spravuje ich server.
 */
export const UpdateCategorySchema = CategorySchema.omit({
  _id: true,
  organisationId: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
}).partial();

export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;
