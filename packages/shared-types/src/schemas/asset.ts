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
 *
 * Každý kus má vlastný záznam (aj keď je to "rovnaký" model — napr. 15× rovnaký dres
 * = 15 záznamov, lebo každý má svoje inventárne číslo, vlastnú históriu zápožičiek
 * a vlastný stav).
 *
 * Spoločné polia má každý asset bez ohľadu na kategóriu. Špecifické polia
 * (napr. IT-špecifické MAC adresa, alebo šport-špecifické veľkosť dresu)
 * sú v `specs` ako voľne štruktúrované JSON pole.
 */
export const AssetSchema = BaseDocumentSchema.merge(SoftDeleteSchema)
  .merge(OrganisationScopedSchema)
  .extend({
    /** Inventárne číslo — unique, používateľsky čitateľné (napr. "LT-2024-008"). */
    inventoryNumber: z
      .string()
      .regex(
        /^[A-Z]{1,5}-\d{4}-\d{3,6}$/,
        'Inventárne číslo musí mať formát PREFIX-ROK-PORADIE (napr. "LT-2024-008").',
      )
      .describe('Inventárne číslo (unique)'),

    /** Sériové číslo od výrobcu (ak existuje). */
    serialNumber: z.string().max(200).nullable().default(null),

    /** Krátky názov položky (napr. "Lenovo ThinkPad X1 Carbon Gen 11"). */
    name: z.string().min(1, 'Názov je povinný.').max(300).trim(),

    /** Voliteľný dlhší popis. */
    description: z.string().max(2000).nullable().default(null),

    /** Top-level typ — slug z kolekcie `asset_types` (per-tenant). */
    type: z.string().min(1).max(200),

    /** ID kategórie zo collection `categories` (hierarchická taxonómia). */
    categoryId: ObjectIdSchema,

    /** Aktuálny stav v životnom cykle. */
    status: z.enum(Object.values(AssetStatus) as [string, ...string[]]) as z.ZodType<AssetStatus>,

    /** Aktuálna fyzická kondícia — slug z kolekcie `asset_conditions` (per-tenant). */
    condition: z.string().min(1).max(200),

    /** ID lokality, kde sa aktuálne nachádza (sklad, kancelária, sklad výstroje). */
    locationId: ObjectIdSchema,

    /** Ak je aktuálne BORROWED, ID aktívnej zápožičky. Inak null. */
    currentLoanId: ObjectIdSchema.nullable().default(null),

    /** Výrobca. */
    manufacturer: z.string().max(200).nullable().default(null),

    /** Model / typ. */
    model: z.string().max(200).nullable().default(null),

    /** Dátum nadobudnutia (kedy sa pridal do evidencie). */
    acquiredAt: TimestampSchema,

    /** Nadobúdacia cena v EUR (voliteľné, pre vyúčtovanie). */
    acquisitionCost: z
      .number()
      .nonnegative()
      .max(1000000, 'Suma presahuje rozumný limit.')
      .nullable()
      .default(null),

    /** Záruka platí do (voliteľné). */
    warrantyUntil: TimestampSchema.nullable().default(null),

    /** Špecifické vlastnosti podľa kategórie — voľne štruktúrované. */
    specs: z.record(z.string(), z.unknown()).default({}),

    /** Tagy pre fulltext vyhľadávanie a filtre. */
    tags: z.array(z.string().min(1).max(50)).default([]),

    /** ID nahraných obrázkov (fotografie položky). Referencie do `attachments`. */
    imageIds: z.array(ObjectIdSchema).default([]),

    /** Poznámky správcov (interné, nevidno bežným používateľom). */
    internalNotes: z.string().max(5000).nullable().default(null),

    /** Či je položka možná zapožičať (false = napríklad pevný office majetok). */
    isLoanable: z.boolean().default(true),

    /** Či vyžaduje schválenie pred zápožičkou. False = self-service zápožička. */
    requiresApproval: z.boolean().default(true),

    // ───────────────────────────────────────────────────────────────
    // Skladový režim (ADR-0020)
    // ───────────────────────────────────────────────────────────────

    /**
     * Spôsob sledovania položky.
     *
     * SERIALIZED (default) = dnešný jednotlivý kus s inventárnym číslom,
     *   stavom (`status`), kondíciou a históriou. Množstvo implicitne 1.
     * BULK = hromadná zameniteľná zásoba; množstvo drží `quantityOnHand`,
     *   stavový automat (`status`) sa nepoužíva na rozhodovanie — dostupnosť
     *   sa odvodzuje z množstiev (viď ADR-0020 §3).
     *
     * Default SERIALIZED ⇒ existujúce assety sú validné bez migrácie.
     */
    trackingMode: z
      .enum(Object.values(TrackingMode) as [string, ...string[]])
      .default(TrackingMode.SERIALIZED) as z.ZodType<TrackingMode>,

    /**
     * Skladové množstvo na sklade — len pre BULK položky.
     *
     * Je to **cache** odvodená zo StockMovement ledgera (zdroj pravdy je
     * `sum(stock_movements.quantity)`), aktualizovaná v rovnakej transakcii
     * ako každý pohyb. Pre SERIALIZED položky je `null` (množstvo je
     * implicitne 1). Konzistenciu BULK ↔ ledger overuje/rekonštruuje
     * service vrstva; povinnosť poľa pre BULK rieši flow, nie schéma
     * (rovnaký prístup ako billing v ADR-0019).
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
});

export type CreateAssetInput = z.infer<typeof CreateAssetSchema>;

/**
 * Update assetu — všetko voliteľné okrem identity.
 */
export const UpdateAssetSchema = AssetSchema.omit({
  _id: true,
  organisationId: true, // Tenant scope is immutable
  inventoryNumber: true, // Inventárne číslo sa nemení (alebo cez special flow)
  trackingMode: true, // Režim je nemenný po vytvorení — prepnutie SERIALIZED↔BULK by zneplatilo množstvo/históriu (ADR-0020)
  quantityOnHand: true, // Mení sa len cez StockMovement pohyby, nie priamym PATCH-om
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
}).partial();

export type UpdateAssetInput = z.infer<typeof UpdateAssetSchema>;

// ─────────────────────────────────────────────────────────────────────
// Špecializované `specs` schémy pre rôzne kategórie majetku
// ─────────────────────────────────────────────────────────────────────

/**
 * Špecifické polia pre IT majetok (notebook, mobil, monitor...).
 */
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

/**
 * Špecifické polia pre športovú výstroj (dres, kopačky...).
 */
export const SportsGearSpecsSchema = z.object({
  size: z.enum(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']).optional(),
  color: z.string().max(50).optional(),
  jerseyNumber: z.number().int().min(0).max(99).optional(),
  gender: z.enum(['MEN', 'WOMEN', 'UNISEX', 'YOUTH']).optional(),
  sportType: z.string().max(100).optional(),
});

export type SportsGearSpecs = z.infer<typeof SportsGearSpecsSchema>;

/**
 * Špecifické polia pre médiá (kamera, mikrofón).
 */
export const MediaSpecsSchema = z.object({
  resolution: z.string().max(50).optional(), // "4K", "1080p", ...
  sensorType: z.string().max(100).optional(),
  lensMount: z.string().max(100).optional(),
  accessories: z.array(z.string().max(200)).optional(),
});

export type MediaSpecs = z.infer<typeof MediaSpecsSchema>;
