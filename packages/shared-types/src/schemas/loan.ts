// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { z } from 'zod';

import { AssetCondition } from '../enums/asset-type.js';
import { LoanRequestStatus, LoanStatus } from '../enums/loan-status.js';

import {
  BaseDocumentSchema,
  ObjectIdSchema,
  OrganisationScopedSchema,
  SoftDeleteSchema,
  TimestampSchema,
} from './common.js';

// ─────────────────────────────────────────────────────────────────────
// Loan Request — katalógová žiadosť o zápožičku (ADR-0026)
// ─────────────────────────────────────────────────────────────────────

/**
 * Položka v katalógovej žiadosti — kategória + požadované množstvo (ADR-0026).
 *
 * Žiadateľ uvažuje v kategóriách, nie v inventárnych číslach.
 * Konkrétny majetok priraďuje správca pri vydaní (POST /v1/loan-requests/:id/fulfil).
 */
export const LoanRequestItemSchema = z.object({
  /** ID kategórie — čo žiadateľ chce. */
  categoryId: ObjectIdSchema,

  /**
   * Snímka kategórie v čase žiadosti — stabilné zobrazenie aj po prípadnej zmene názvu.
   */
  categorySnapshot: z.object({
    name: z.string(),
    slug: z.string(),
  }),

  /** Požadované množstvo (pevné číslo ≥ 1). */
  quantityRequested: z.number().int().min(1),

  /**
   * Vydané množstvo — súčet naprieč všetkými Loan-mi z tejto žiadosti.
   * Ak quantityFulfilled >= quantityRequested → položka je plne pokrytá.
   * Inkrementuje service pri každom vydaní (fulfil), nikdy neklesá.
   */
  quantityFulfilled: z.number().int().nonnegative().default(0),

  /** Voliteľná per-item poznámka žiadateľa (napr. „len ak je skladom"). */
  note: z.string().max(1000).nullable().default(null),
});

export type LoanRequestItem = z.infer<typeof LoanRequestItemSchema>;

/**
 * Žiadosť o zápožičku — katalógový dopyt (ADR-0026).
 *
 * Žiadosť nedrží zásobu. Správca je jediný gatekeeper:
 * pri vydaní mapuje kategória+množstvo → konkrétne kusy / BULK a vydá.
 * 1 žiadosť → N Loanov postupne (resultingLoanIds[]).
 */
export const LoanRequestSchema = BaseDocumentSchema.merge(SoftDeleteSchema)
  .merge(OrganisationScopedSchema)
  .extend({
    /** ID žiadateľa — kto žiadosť podal. Vždy prihlásený používateľ (server-set). */
    requesterId: ObjectIdSchema,

    /**
     * ID beneficiára — pre koho je výpožička určená.
     * Default = requesterId (žiadosť pre seba).
     * Pri žiadosti za inú osobu sa nastaví na cieľového používateľa (ADR-0023).
     * Musí byť aktívny používateľ v tom istom tenante.
     */
    beneficiaryId: ObjectIdSchema,

    /** Účel — krátky text, prečo si zápožičku berie. */
    purpose: z.string().min(3, 'Účel je povinný.').max(500),

    /**
     * Plánovaný termín od (želaný — záväzný dueAt sa nastaví až na Loan pri vydaní).
     */
    plannedFrom: TimestampSchema,

    /**
     * Plánovaný termín do. Null = výpožička bez termínu ("do odvolania", ADR-0025).
     * Záväzný termín vrátenia (dueAt) sa nastaví na Loan pri vydaní, nie tu.
     */
    plannedTo: TimestampSchema.nullable().default(null),

    /** Katalógové položky žiadosti (kategória + množstvo). */
    items: z.array(LoanRequestItemSchema).min(1, 'Žiadosť musí mať aspoň jednu položku.'),

    /** Celkový stav žiadosti. */
    status: z.enum(
      Object.values(LoanRequestStatus) as [string, ...string[]],
    ) as z.ZodType<LoanRequestStatus>,

    /** Zoznam schvaľovateľov (forward-compat pre ADR-0012 Slice #5b multi-approver routing). */
    approvers: z.array(
      z.object({
        userId: ObjectIdSchema,
        categoryScope: z.array(ObjectIdSchema),
        decidedAt: TimestampSchema.nullable().default(null),
        decision: z.enum(['APPROVED', 'REJECTED']).nullable().default(null),
        note: z.string().max(1000).nullable().default(null),
      }),
    ),

    /**
     * ID Loan-ov vytvorených vydaním z tejto žiadosti (ADR-0026).
     * 1 žiadosť → N Loanov postupne — každé vydanie pripíše nové Loan._id.
     */
    resultingLoanIds: z.array(ObjectIdSchema).default([]),

    /** Ak je REJECTED alebo CANCELLED, dôvod. */
    rejectionReason: z.string().max(1000).nullable().default(null),

    /** Hromadná žiadosť pre tím — voliteľná referencia (forward-compat, vždy null v MVP). */
    teamId: ObjectIdSchema.nullable().default(null),

    /** Hash na idempotenciu — ten istý hash = duplicitná žiadosť, vrátime existujúcu. */
    idempotencyKey: z.string().max(100).nullable().default(null),
  });

export type LoanRequest = z.infer<typeof LoanRequestSchema>;

export const CreateLoanRequestSchema = LoanRequestSchema.omit({
  _id: true,
  organisationId: true, // Server-provided from authenticated context
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
  status: true,
  approvers: true,
  resultingLoanIds: true,
  rejectionReason: true,
  beneficiaryId: true, // Server-set: defaults to requesterId if omitted
}).extend({
  /** Status sa vždy nastavuje na PENDING pri vytvorení. */
  status: z.literal(LoanRequestStatus.PENDING).default(LoanRequestStatus.PENDING),
  /**
   * Voliteľný beneficiár — pre koho je výpožička určená.
   * Ak chýba, server nastaví na requesterId (žiadosť pre seba).
   */
  beneficiaryId: ObjectIdSchema.optional(),
  /**
   * Položky — žiadateľ zadáva kategóriu + množstvo (nie konkrétne assetId).
   * quantityFulfilled sa vždy nastaví na 0 (server-side).
   */
  items: z
    .array(
      z.object({
        categoryId: ObjectIdSchema,
        quantityRequested: z.number().int().min(1, 'Množstvo musí byť aspoň 1.'),
        note: z.string().max(1000).nullable().optional(),
      }),
    )
    .min(1, 'Žiadosť musí mať aspoň jednu položku.')
    .max(50),
});

export type CreateLoanRequestInput = z.infer<typeof CreateLoanRequestSchema>;

/**
 * Vydanie z katalógovej žiadosti — správca mapuje položky na konkrétny majetok (ADR-0026).
 *
 * Každé volanie POST /v1/loan-requests/:id/fulfil vytvorí samostatný Loan.
 * Vydanie môže byť čiastočné (quantityFulfilled < quantityRequested).
 */
export const FulfilLoanRequestSchema = z.object({
  /**
   * Vydávané položky — mapovanie requestItemId na konkrétny majetok.
   * SERIALIZED: assetIds[] (inventárne kusy z danej kategórie).
   * BULK: bulkItemId + quantity (množstevná položka z danej kategórie).
   * Každá vydávaná položka žiadosti môže byť SERIALIZED alebo BULK, nie oboje.
   */
  items: z
    .array(
      z.union([
        z.object({
          requestItemIndex: z.number().int().nonnegative(),
          type: z.literal('SERIALIZED'),
          assetIds: z.array(ObjectIdSchema).min(1),
        }),
        z.object({
          requestItemIndex: z.number().int().nonnegative(),
          type: z.literal('BULK'),
          bulkItemId: ObjectIdSchema,
          quantity: z.number().int().min(1),
        }),
      ]),
    )
    .min(1, 'Vydanie musí obsahovať aspoň jednu položku.'),

  /**
   * Záväzný termín vrátenia pre vzniknutý Loan (ADR-0025).
   * Null = výpožička bez termínu ("do odvolania").
   */
  dueAt: TimestampSchema.nullable().default(null),

  /**
   * Ak true, žiadosť sa po tomto vydaní uzavrie (→ CLOSED),
   * aj keď nebolo vydané celé žiadané množstvo.
   * Ak false, žiadosť ostáva PARTIALLY_FULFILLED (čaká na ďalšie vydanie).
   */
  closeRemainder: z.boolean().default(false),

  /** Voliteľné poznámky k tomuto vydaniu. */
  notes: z.string().max(2000).nullable().default(null),
});

export type FulfilLoanRequestInput = z.infer<typeof FulfilLoanRequestSchema>;

// ─────────────────────────────────────────────────────────────────────
// Loan — aktívna zápožička (PO vydaní)
// ─────────────────────────────────────────────────────────────────────

/**
 * Stav konkrétnej položky v zápožičke pri prevzatí/vrátení.
 */
export const LoanItemConditionSchema = z.object({
  /** Stav pri prevzatí (vyplnené pri vzniku Loan-u). */
  atPickup: z.object({
    condition: z.enum(
      Object.values(AssetCondition) as [string, ...string[]],
    ) as z.ZodType<AssetCondition>,
    note: z.string().max(1000).nullable().default(null),
    photoIds: z.array(ObjectIdSchema).default([]),
  }),

  /** Stav pri vrátení (vyplnené pri vrátení). */
  atReturn: z
    .object({
      condition: z.enum(
        Object.values(AssetCondition) as [string, ...string[]],
      ) as z.ZodType<AssetCondition>,
      note: z.string().max(1000).nullable().default(null),
      photoIds: z.array(ObjectIdSchema).default([]),
      requiresService: z.boolean().default(false),
    })
    .nullable()
    .default(null),
});

export type LoanItemCondition = z.infer<typeof LoanItemConditionSchema>;

/**
 * Položka aktívnej zápožičky.
 */
export const LoanItemSchema = z.object({
  assetId: ObjectIdSchema,
  snapshot: z.object({
    inventoryNumber: z.string(),
    name: z.string(),
  }),
  condition: LoanItemConditionSchema,
});

export type LoanItem = z.infer<typeof LoanItemSchema>;

/**
 * Loan = aktívna zápožička.
 */
export const LoanSchema = BaseDocumentSchema.merge(SoftDeleteSchema)
  .merge(OrganisationScopedSchema)
  .extend({
    /**
     * Referencia na katalógovú žiadosť, z ktorej zápožička vznikla (ADR-0026).
     * Null pri priamej výpožičke (direct loan) bez predchádzajúcej žiadosti (ADR-0023).
     */
    requestId: ObjectIdSchema.nullable().default(null),

    /** Vypožičiavajúca osoba. */
    borrowerId: ObjectIdSchema,

    /** Účel (skopírovaný z LoanRequest pri vydaní). */
    purpose: z.string().min(3).max(500),

    /** Reálny dátum prevzatia. */
    pickedUpAt: TimestampSchema,

    /** Osoba, ktorá majetok odovzdala (správca skladu). */
    handedOverBy: ObjectIdSchema,

    /**
     * Dohodnutý termín vrátenia. Null = výpožička bez termínu ("do odvolania", ADR-0025).
     * Ak null, isOverdue === false vždy (trvalé pridelenie nie je nikdy po termíne).
     */
    dueAt: TimestampSchema.nullable().default(null),

    /** Reálny dátum vrátenia (null kým aktívne). */
    returnedAt: TimestampSchema.nullable().default(null),

    /** Osoba, ktorá majetok prijala späť (správca skladu). */
    returnedTo: ObjectIdSchema.nullable().default(null),

    /** Položky v zápožičke + stavy. */
    items: z.array(LoanItemSchema).min(1),

    /** Aktuálny stav zápožičky. */
    status: z.enum(Object.values(LoanStatus) as [string, ...string[]]) as z.ZodType<LoanStatus>,

    /** Počet predĺžení. */
    extensionCount: z.number().int().nonnegative().default(0),

    /** ID protokolu o odovzdaní (PDF v storage). */
    handoverProtocolId: ObjectIdSchema.nullable().default(null),

    /** ID protokolu o vrátení (PDF v storage). */
    returnProtocolId: ObjectIdSchema.nullable().default(null),

    /** Voľné poznámky. */
    notes: z.string().max(2000).nullable().default(null),
  });

export type Loan = z.infer<typeof LoanSchema>;

/**
 * Vytvorenie zápožičky pri prevzatí.
 */
export const CreateLoanSchema = LoanSchema.omit({
  _id: true,
  organisationId: true, // Server-provided from authenticated context
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
  returnedAt: true,
  returnedTo: true,
  status: true,
  extensionCount: true,
  handoverProtocolId: true,
  returnProtocolId: true,
}).extend({
  status: z.literal(LoanStatus.ACTIVE).default(LoanStatus.ACTIVE),
});

export type CreateLoanInput = z.infer<typeof CreateLoanSchema>;

/**
 * Priama výpožička bez žiadosti — vytvorená správcom majetku alebo adminom (ADR-0023).
 * `requestId` je vždy null, `borrowerId` je povinný v tele.
 */
export const CreateDirectLoanSchema = z.object({
  /** Osoba, ktorá si výpožičku berie (povinné). */
  borrowerId: ObjectIdSchema,
  /** Položky — assetIds. */
  items: z
    .array(
      z.object({
        assetId: ObjectIdSchema,
      }),
    )
    .min(1, 'Priama výpožička musí mať aspoň jednu položku.')
    .max(50),
  /** Účel výpožičky. */
  purpose: z.string().min(3, 'Účel je povinný.').max(500),
  /** Dohodnutý termín vrátenia. Null = výpožička bez termínu ("do odvolania", ADR-0025). */
  dueAt: TimestampSchema.nullable().default(null),
  /** Voľné poznámky. */
  notes: z.string().max(2000).nullable().default(null),
});

export type CreateDirectLoanInput = z.infer<typeof CreateDirectLoanSchema>;

/**
 * Vrátenie zápožičky — vyplní sa pri prevzatí späť do skladu.
 */
export const ReturnLoanSchema = z.object({
  returnedTo: ObjectIdSchema,
  items: z.array(
    z.object({
      assetId: ObjectIdSchema,
      condition: z.enum(
        Object.values(AssetCondition) as [string, ...string[]],
      ) as z.ZodType<AssetCondition>,
      note: z.string().max(1000).nullable().default(null),
      photoIds: z.array(ObjectIdSchema).default([]),
      requiresService: z.boolean().default(false),
    }),
  ),
  notes: z.string().max(2000).nullable().default(null),
});

export type ReturnLoanInput = z.infer<typeof ReturnLoanSchema>;
