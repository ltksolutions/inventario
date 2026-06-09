import { z } from 'zod';

import {
  BaseDocumentSchema,
  ObjectIdSchema,
  OrganisationScopedSchema,
  SoftDeleteSchema,
} from './common.js';

/**
 * Attachment = nahraný súbor v object storage (MinIO/Azure Blob).
 *
 * Typické použitia:
 * - Fotografie majetku (state pri prevzatí, pri vrátení)
 * - Faktúry, doklady o nadobudnutí
 * - PDF protokoly o odovzdaní/vrátení (generované)
 * - Príručky a manuály k zariadeniam
 *
 * Súbor samotný NIE JE v MongoDB — len metadata. Reálny obsah je v `storageKey`.
 */
export const AttachmentSchema = BaseDocumentSchema.merge(SoftDeleteSchema)
  .merge(OrganisationScopedSchema)
  .extend({
    /** Pôvodný názov súboru pri uploade. */
    originalFilename: z.string().min(1).max(500),

    /** Kľúč v object storage (napr. "assets/2024/01/abc123-photo.jpg"). */
    storageKey: z.string().min(1).max(500),

    /** Bucket v object storage. */
    bucket: z.enum(['sfz-asset-attachments', 'sfz-asset-protocols']),

    /** MIME type (validovaný pri uploade). */
    mimeType: z
      .string()
      .regex(/^[a-z]+\/[a-z0-9.+-]+$/i, 'Neplatný MIME type.')
      .max(255),

    /** Veľkosť v bytoch. */
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024, 'Súbor je príliš veľký (max 100MB).'),

    /** SHA-256 hash obsahu (pre deduplication a integrity check). */
    sha256: z.string().regex(/^[a-f0-9]{64}$/i, 'Neplatný SHA-256 hash.'),

    /** Typ attachmentu — určuje, kam je naviazaný. */
    attachmentType: z.enum([
      'ASSET_PHOTO',
      'ASSET_DOCUMENT', // faktúra, doklad o nadobudnutí
      'LOAN_PICKUP_PHOTO',
      'LOAN_RETURN_PHOTO',
      'LOAN_HANDOVER_PROTOCOL', // PDF protokol pri prevzatí
      'LOAN_RETURN_PROTOCOL', // PDF protokol pri vrátení
      'USER_AVATAR',
      'OTHER',
    ]),

    /** ID entity, ku ktorej je súbor naviazaný (asset, loan, user). */
    linkedTo: z.object({
      entityType: z.enum(['Asset', 'Loan', 'LoanRequest', 'User']),
      entityId: ObjectIdSchema,
    }),

    /** Voliteľný popis / titulok. */
    caption: z.string().max(500).nullable().default(null),

    /** Pre obrázky — rozmery. */
    imageDimensions: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .nullable()
      .default(null),

    /** Či je súbor verejne dostupný (presigned URL nie je potrebný). */
    isPublic: z.boolean().default(false),

    /**
     * Hlavné foto entity (len pre ASSET_PHOTO). Max jedno `isPrimary=true`
     * na entitu — vynucuje service pri nastavovaní. Zobrazuje sa na detaile
     * majetku ako hero obrázok.
     */
    isPrimary: z.boolean().default(false),
  });

export type Attachment = z.infer<typeof AttachmentSchema>;

export const CreateAttachmentSchema = AttachmentSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
});

export type CreateAttachmentInput = z.infer<typeof CreateAttachmentSchema>;
