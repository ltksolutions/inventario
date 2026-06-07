import { z } from 'zod';

import { AssetStatus } from '../enums/asset-status.js';
import { TrackingMode } from '../enums/tracking-mode.js';

import {
  BaseDocumentSchema,
  ObjectIdSchema,
  OrganisationScopedSchema,
  SoftDeleteSchema,
  TimestampSchema,
} from './common.js';

/**
 * Asset = jednotlivá fyzická položka majetku v evidencii.
 */
export const AssetSchema = BaseDocumentSchema.merge(SoftDeleteSchema)
  .merge(OrganisationScopedSchema)
  .extend({
    inventoryNumber: z
      .string()
      .regex(
        /^[A-Z]{1,5}-(\d{4}-)?\d{3,8}$/,
        'Inventárne číslo musí mať formát PREFIX-ROK-PORADIE (napr. "LT-2026-0042") alebo PREFIX-PORADIE (napr. "LT-0042").',
      )
      .describe('Inventárne číslo (unique)'),

    publicToken: z
      .string()
      .min(16)
      .max(64)
      .describe('Verejný neuhádnuteľný handle pre QR / lost & found (server-generated)'),

    serialNumber: z.string().max(200).nullable().default(null),
    name: z.string().min(1, 'Názov je povinný.').max(300).trim(),
    description: z.string().max(2000).nullable().default(null),

    /**
     * Kategória — jediná klasifikácia majetku (hierarchický strom
     * `categories`). Typ majetku = root predok kategórie; samostatné
     * pole `type` bolo odstránené pri zlúčení číselníkov (2026-06-08).
     * Majetok musí byť zaradený do PODkategórie (nie root uzla) —
     * vynucuje AssetsService.
     */
    categoryId: ObjectIdSchema,

    status: z.enum(Object.values(AssetStatus) as [string, ...string[]]) as z.ZodType<AssetStatus>,

    condition: z.string().min(1).max(200),
    locationId: ObjectIdSchema,
    currentLoanId: ObjectIdSchema.nullable().default(null),

    manufacturer: z.string().max(200).nullable().default(null),
    model: z.string().max(200).nullable().default(null),

    acquiredAt: TimestampSchema,
    acquisitionCost: z
      .number()
      .nonnegative()
      .max(1000000, 'Suma presahuje rozumný limit.')
      .nullable()
      .default(null),
    warrantyUntil: TimestampSchema.nullable().default(null),

    specs: z.record(z.string(), z.unknown()).default({}),
    tags: z.array(z.string().min(1).max(50)).default([]),
    imageIds: z.array(ObjectIdSchema).default([]),
    internalNotes: z.string().max(5000).nullable().default(null),

    isLoanable: z.boolean().default(true),
    requiresApproval: z.boolean().default(true),

    /**
     * Spôsob sledovania položky (ADR-0020).
     * SERIALIZED = jednotlivý kus s inventárnym číslom.
     * BULK = hromadná zameniteľná zásoba; množstvo drží `quantityOnHand`.
     */
    trackingMode: z
      .enum(Object.values(TrackingMode) as [string, ...string[]])
      .default(TrackingMode.SERIALIZED) as z.ZodType<TrackingMode>,

    /**
     * Skladové množstvo — len pre BULK položky.
     * Cache odvodená zo StockMovement ledgera. Pre SERIALIZED je null.
     */
    quantityOnHand: z.number().int().nonnegative().nullable().default(null),
  });

export type Asset = z.infer<typeof AssetSchema>;

/**
 * Vytvorenie nového assetu cez API.
 */
export const CreateAssetSchema = AssetSchema.omit({
  _id: true,
  organisationId: true, // Server-provided from authenticated context
  publicToken: true, // Server-generated (CSPRNG) at POST — ADR-0021
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
  currentLoanId: true,
  quantityOnHand: true, // Server-controlled cache — inicializuje sa cez RECEIPT pohyb (ADR-0020)
}).extend({
  /** Pri vytvorení neprideľujeme stav — vždy začína ako AVAILABLE. */
  status: z.literal(AssetStatus.AVAILABLE).default(AssetStatus.AVAILABLE),
  /**
   * Počiatočné množstvo pre BULK položky (ADR-0020).
   * Server vytvorí RECEIPT pohyb s týmto množstvom v rovnakej transakcii.
   * Pre SERIALIZED položky ignorované (množstvo je implicitne 1).
   */
  initialQuantity: z.number().int().nonnegative().optional(),
});

export type CreateAssetInput = z.infer<typeof CreateAssetSchema>;

/**
 * Update assetu — všetko voliteľné okrem identity.
 */
export const UpdateAssetSchema = AssetSchema.omit({
  _id: true,
  organisationId: true,
  inventoryNumber: true,
  publicToken: true,
  trackingMode: true, // Nemenný po vytvorení (ADR-0020)
  quantityOnHand: true, // Mení sa len cez StockMovement pohyby
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
}).partial();

export type UpdateAssetInput = z.infer<typeof UpdateAssetSchema>;

// ──────────────────────────────────────────────────────────
// PublicAssetView — verejný „lost & found" pohľad (ADR-0021)
// ──────────────────────────────────────────────────────────

export const PublicAssetViewSchema = z
  .object({
    organisationName: z.string(),
    organisationLogoUrl: z.string().url().nullable(),
    inventoryNumber: z.string(),
    name: z.string(),
    foundContact: z
      .object({
        email: z.string().nullable(),
        phone: z.string().nullable(),
        message: z.string().nullable(),
      })
      .nullable(),
  })
  .strict();

export type PublicAssetView = z.infer<typeof PublicAssetViewSchema>;

// ─────────────────────────────────────────────────────────────────────
// Špecializované `specs` schémy
// ─────────────────────────────────────────────────────────────────────

export const ITSpecsSchema = z.object({
  macAddress: z
    .string()
    .regex(/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/, 'Neplatná MAC adresa.')
    .optional(),
  imei: z
    .string()
    .regex(/^\d{15}$/, 'IMEI musí byť 15 číslic.')
    .optional(),
  hostname: z.string().max(100).optional(),
  os: z.string().max(100).optional(),
  cpu: z.string().max(200).optional(),
  ramGb: z.number().int().positive().max(1024).optional(),
  storageGb: z.number().int().positive().max(100000).optional(),
});

export type ITSpecs = z.infer<typeof ITSpecsSchema>;

export const SportsGearSpecsSchema = z.object({
  size: z.enum(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']).optional(),
  color: z.string().max(50).optional(),
  jerseyNumber: z.number().int().min(0).max(99).optional(),
  gender: z.enum(['MEN', 'WOMEN', 'UNISEX', 'YOUTH']).optional(),
  sportType: z.string().max(100).optional(),
});

export type SportsGearSpecs = z.infer<typeof SportsGearSpecsSchema>;

export const MediaSpecsSchema = z.object({
  resolution: z.string().max(50).optional(),
  sensorType: z.string().max(100).optional(),
  lensMount: z.string().max(100).optional(),
  accessories: z.array(z.string().max(200)).optional(),
});

export type MediaSpecs = z.infer<typeof MediaSpecsSchema>;
