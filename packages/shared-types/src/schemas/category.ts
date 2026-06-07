import { z } from 'zod';

import {
  BaseDocumentSchema,
  ObjectIdSchema,
  OrganisationScopedSchema,
  SoftDeleteSchema,
} from './common.js';

/**
 * Kategória majetku — hierarchická taxonómia (strom).
 *
 * Každá kategória patrí pod práve jeden typ majetku (`assetTypeSlug` →
 * per-tenant kolekcia `asset_types`). Vo formulároch sa kategórie
 * ponúkajú filtrované podľa zvoleného typu. Deti DEDIA typ z root
 * rodiča — typ sa nastavuje len na root úrovni.
 *
 * Príklad hierarchie (typ: it-majetok):
 *   IT
 *   ├── Notebooky
 *   │   ├── Pracovné notebooky
 *   │   └── Vývojárske notebooky
 *   ├── Mobily
 *   └── Periférie
 *       ├── Klávesnice
 *       └── Myši
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

    /** ID nadradenej kategórie (null pre root kategórie). */
    parentId: ObjectIdSchema.nullable().default(null),

    /**
     * Slug typu majetku z per-tenant číselníka `asset_types`.
     * Root kategória ho má nastavený explicitne, deti ho dedia z rodiča
     * (server ho pri create/update odvodzuje a kaskáduje).
     */
    assetTypeSlug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'assetTypeSlug musí byť lowercase slug s pomlčkami.')
      .max(200),

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
