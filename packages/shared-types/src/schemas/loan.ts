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
// Loan Request — žiadosť o zápožičku (PRED schválením)
// ─────────────────────────────────────────────────────────────────────

/**
 * Položka v žiadosti — referencia na konkrétny asset.
 */
export const LoanRequestItemSchema = z.object({
  /** ID požadovaného assetu. */
  assetId: ObjectIdSchema,

  /** Krátky popis pre čas, keď je už request, ale ešte nie schválený. */
  snapshot: z.object({
    inventoryNumber: z.string(),
    name: z.string(),
  }),

  /** Stav schválenia tejto konkrétnej položky (pri partial approval). */
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUBSTITUTED']).default('PENDING'),

  /** Ak SUBSTITUTED, ID navrhnutej náhrady. */
  substitutedWithAssetId: ObjectIdSchema.nullable().default(null),

  /** Poznámka schvaľovateľa (napr. dôvod zamietnutia). */
  approverNote: z.string().max(1000).nullable().default(null),
});

export type LoanRequestItem = z.infer<typeof LoanRequestItemSchema>;

/**
 * Žiadosť o zápožičku — vytvára používateľ pred prevzatím.
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

    /** Plánovaný termín od. */
    plannedFrom: TimestampSchema,

    /**
     * Plánovaný termín do. Null = výpožička bez termínu ("do odvolania", ADR-0025).
     * Pri žiadosti bez termínu sa OVERDUE nikdy nepočíta.
     */
    plannedTo: TimestampSchema.nullable().default(null),

    /** Položky v žiadosti (môžu byť rôzni schvaľovatelia podľa kategórie). */
    items: z.array(LoanRequestItemSchema).min(1, 'Žiadosť musí mať aspoň jednu položku.'),

    /** Celkový stav žiadosti. */
    status: z.enum(
      Object.values(LoanRequestStatus) as [string, ...string[]],
    ) as z.ZodType<LoanRequestStatus>,

    /** Zoznam schvaľovateľov (môže byť viacero pri hromadných žiadostiach). */
    approvers: z.array(
      z.object({
        userId: ObjectIdSchema,
        categoryScope: z.array(ObjectIdSchema), // Aké kategórie tento schvaľovateľ schvaľuje
        decidedAt: TimestampSchema.nullable().default(null),
        decision: z.enum(['APPROVED', 'REJECTED']).nullable().default(null),
        note: z.string().max(1000).nullable().default(null),
      }),
    ),

    /** Ak je APPROVED, ID vytvoreného Loan dokumentu. */
    resultingLoanId: ObjectIdSchema.nullable().default(null),

    /** Ak je REJECTED alebo CANCELLED, dôvod. */
    rejectionReason: z.string().max(1000).nullable().default(null),

    /** Hromadná žiadosť pre tím — voliteľná referencia na team. */
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
  resultingLoanId: true,
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
});

export type CreateLoanRequestInput = z.infer<typeof CreateLoanRequestSchema>;

// ─────────────────────────────────────────────────────────────────────
// Loan — aktívna zápožička (PO schválení a prevzatí)
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
     * Referencia na žiadosť, z ktorej zápožička vznikla.
     * Null pri priamej výpožičke (direct loan) bez predchádzajúcej žiadosti (ADR-0023).
     */
    requestId: ObjectIdSchema.nullable().default(null),

    /** Vypožičiavajúca osoba. */
    borrowerId: ObjectIdSchema,

    /** Účel (skopírovaný z LoanRequest pri vzniku). */
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
