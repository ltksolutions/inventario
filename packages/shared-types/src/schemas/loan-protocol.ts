import { z } from 'zod';

import {
  BaseDocumentSchema,
  ObjectIdSchema,
  OrganisationScopedSchema,
  TimestampSchema,
} from './common.js';

/**
 * Loan Protocol = právne relevantný protokol o odovzdaní alebo vrátení majetku.
 *
 * Tento dokument je **nemenný** od momentu podpisu (handover/return). Akékoľvek
 * zmeny po podpise sa robia formou **dodatku** (nový protokol s referenciou na pôvodný).
 *
 * PDF sa **neukladá** — renderuje sa deterministicky on-demand zo snapshotov v tomto
 * zázname (ADR-0022, rev. 2026-06-01). Tu sú len metadata, štruktúrovaný obsah a
 * (voliteľne) `pdfSha256` ako dôkaz integrity konkrétnej vyrenderovanej verzie.
 */
export const LoanProtocolSchema = BaseDocumentSchema.merge(OrganisationScopedSchema).extend({
  /** Typ protokolu. */
  type: z.enum(['HANDOVER', 'RETURN', 'AMENDMENT']),

  /** Referencia na zápožičku. */
  loanId: ObjectIdSchema,

  /** Pre AMENDMENT — referencia na pôvodný protokol. */
  originalProtocolId: ObjectIdSchema.nullable().default(null),

  /** Číslo protokolu (formát: "PROT-2024-001234"). */
  protocolNumber: z
    .string()
    .regex(/^PROT-\d{4}-\d{6}$/, 'Číslo protokolu musí mať formát PROT-YYYY-NNNNNN.'),

  /** Dátum vystavenia. */
  issuedAt: TimestampSchema,

  /**
   * Veľkosť papiera pre on-demand render — **snapshot** v momente vzniku protokolu
   * (ADR-0022, rev. 2026-06-01). Zámerne sa ukladá na zázname, NIE číta zo živého
   * nastavenia tenanta: protokol je nemenný, takže neskoršia zmena tenant defaultu
   * (A4 → LETTER) nesmie zmeniť už vystavený protokol — inak by sa rozbil determinizmus
   * renderu a `pdfSha256`. Default A4. Hodnota sa kopíruje z `Organisation.protocolSettings.paperSize`
   * pri vzniku protokolu.
   */
  paperSize: z.enum(['A4', 'LETTER']).default('A4'),

  /** Strany protokolu. */
  parties: z.object({
    /** Odovzdávajúci (pri HANDOVER = správca, pri RETURN = vypožičiavajúci). */
    handover: z.object({
      userId: ObjectIdSchema,
      snapshot: z.object({
        displayName: z.string(),
        email: z.string(),
        organizationalUnit: z.string().nullable(),
      }),
    }),
    /** Preberajúci (pri HANDOVER = vypožičiavajúci, pri RETURN = správca). */
    receive: z.object({
      userId: ObjectIdSchema,
      snapshot: z.object({
        displayName: z.string(),
        email: z.string(),
        organizationalUnit: z.string().nullable(),
      }),
    }),
  }),

  /** Položky v protokole. */
  items: z.array(
    z.object({
      assetId: ObjectIdSchema,
      snapshot: z.object({
        inventoryNumber: z.string(),
        name: z.string(),
        serialNumber: z.string().nullable(),
        category: z.string(),
      }),
      condition: z.enum(['NEW', 'EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'UNUSABLE']),
      conditionNote: z.string().max(1000).nullable().default(null),
      photoIds: z.array(ObjectIdSchema).default([]),
    }),
  ),

  /** Voľný text — dodatočné podmienky, poznámky. */
  notes: z.string().max(5000).nullable().default(null),

  /** Digitálne podpisy. */
  signatures: z.object({
    handover: z
      .object({
        signedAt: TimestampSchema,
        method: z.enum(['BIOMETRIC', 'CLICK_TO_SIGN', 'EXTERNAL']),
        ipAddress: z.string().max(45).nullable().default(null),
        signatureImageId: ObjectIdSchema.nullable().default(null),
      })
      .nullable()
      .default(null),
    receive: z
      .object({
        signedAt: TimestampSchema,
        method: z.enum(['BIOMETRIC', 'CLICK_TO_SIGN', 'EXTERNAL']),
        ipAddress: z.string().max(45).nullable().default(null),
        signatureImageId: ObjectIdSchema.nullable().default(null),
      })
      .nullable()
      .default(null),
  }),

  /** SHA-256 hash PDF — pre dôkaz integrity protokolu. */
  pdfSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .nullable()
    .default(null),

  /** Stav. */
  status: z
    .enum([
      'DRAFT', // Pripravený, ale nepodpísaný
      'SIGNED', // Podpísaný oboma stranami
      'AMENDED', // Bol nahradený dodatkom (referenciu nájdeš cez `originalProtocolId` v novšom protokole)
      'VOIDED', // Anulovaný (nie sa nemení obsah, ale označí sa)
    ])
    .default('DRAFT'),
});

export type LoanProtocol = z.infer<typeof LoanProtocolSchema>;
