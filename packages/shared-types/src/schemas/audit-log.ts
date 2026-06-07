import { z } from 'zod';

import { ObjectIdSchema, TimestampSchema } from './common.js';

/**
 * Audit log = nemenný (append-only) záznam o každej významnej akcii v systéme.
 *
 * Účel:
 * - Bezpečnostný / súdne použiteľný záznam ("kto, kedy, čo")
 * - Forenzika incidentov
 * - Compliance (GDPR čl. 30 — záznamy o spracovateľských činnostiach)
 *
 * Audit log sa NIKDY nemení ani nemaže z aplikačnej úrovne. Záznamy sú
 * write-only. Iba systémový retention job ich môže pseudonymizovať po
 * uplynutí retention obdobia (viď docs/compliance/gdpr-article-30.md,
 * sekcia "Retention schedule").
 *
 * NEMÁ AuditFields ani SoftDelete — používa iba vlastný `_id` a `at`.
 */
export const AuditLogSchema = z.object({
  /** MongoDB _id. */
  _id: ObjectIdSchema,

  /** Tenant scope. Audit log entries always belong to exactly one tenant. */
  organisationId: ObjectIdSchema,

  /** Kedy sa udalosť stala (server time, UTC). */
  at: TimestampSchema,

  /** Kto akciu vykonal. "SYSTEM" pre automatizované úlohy. */
  actor: z.object({
    userId: z.union([ObjectIdSchema, z.literal('SYSTEM')]),
    displayName: z.string().max(200), // snapshot mena v čase akcie
    accountType: z.enum(['ENTRA_ID', 'LOCAL', 'SYSTEM']),
    ipAddress: z.string().max(45).nullable().default(null), // IPv4 alebo IPv6
    userAgent: z.string().max(500).nullable().default(null),
  }),

  /** Typ akcie. */
  action: z.enum([
    // Auth
    'USER_LOGIN',
    'USER_LOGIN_FAILED',
    'USER_LOGOUT',
    'USER_PASSWORD_CHANGED',
    'USER_PASSWORD_RESET_REQUESTED',
    'USER_MFA_ENABLED',
    'USER_MFA_DISABLED',
    'USER_MFA_RESET_BY_ADMIN',

    // User management
    'USER_CREATED',
    'USER_UPDATED',
    'USER_DEACTIVATED',
    'USER_REACTIVATED',
    'USER_ROLE_GRANTED',
    'USER_ROLE_REVOKED',

    // Organisation (tenant lifecycle — admin only)
    'ORGANISATION_CREATED',
    'ORGANISATION_UPDATED',
    'ORGANISATION_DELETED',
    'ORGANISATION_BRANDING_UPDATED', // ADR-0028: tenant self-service branding update

    // Asset
    'ASSET_CREATED',
    'ASSET_UPDATED',
    'ASSET_DELETED',
    'ASSET_STATUS_CHANGED',
    'ASSET_LOCATION_CHANGED',
    'ASSET_DISPOSED',

    // Category (slice #3)
    'CATEGORY_CREATED',
    'CATEGORY_UPDATED',
    'CATEGORY_DELETED',

    // Location (slice #3)
    'LOCATION_CREATED',
    'LOCATION_UPDATED',
    'LOCATION_DELETED',

    // Loan
    'LOAN_REQUEST_CREATED',
    'LOAN_REQUEST_APPROVED',
    'LOAN_REQUEST_REJECTED',
    'LOAN_REQUEST_CANCELLED',
    'LOAN_PICKED_UP',
    'LOAN_RETURNED',
    'LOAN_EXTENDED',
    'LOAN_MARKED_OVERDUE',
    'LOAN_MARKED_LOST',
    'LOAN_CREATED_DIRECT', // ADR-0023: direct loan without prior request
    'LOAN_REQUEST_FULFILLED', // ADR-0026: vydanie z katalógovej žiadosti
    'LOAN_PROTOCOL_CREATED', // ADR-0022: dodatočné vytvorenie protokolu (backfill)

    // Stock movements (BULK položky — ADR-0020)
    'STOCK_RECEIVED',
    'STOCK_ISSUED',
    'STOCK_RETURNED',
    'STOCK_ADJUSTED',

    // GDPR
    'DATA_EXPORT_REQUESTED',
    'DATA_DELETION_REQUESTED',
    'USER_PSEUDONYMIZED',
    'USER_RESTRICTED',
    'USER_UNRESTRICTED',

    // Membership (slice #9d K18)
    'MEMBERSHIP_CREATED',
    'MEMBERSHIP_ROLES_CHANGED',
    'MEMBERSHIP_REMOVED',
    'USER_SWITCHED_ORGANISATION',

    // Passkeys (slice #8)
    'PASSKEY_REGISTERED',
    'PASSKEY_REMOVED',
    'PASSKEY_RENAMED',
    'PASSKEY_LOGIN',
    'PASSKEY_LOGIN_FAILED',
    'PASSKEY_COUNTER_WARNING',

    // AssetType
    'ASSET_TYPE_CREATED',
    'ASSET_TYPE_UPDATED',
    'ASSET_TYPE_DELETED',

    // AssetCondition
    'ASSET_CONDITION_CREATED',
    'ASSET_CONDITION_UPDATED',
    'ASSET_CONDITION_DELETED',

    // System
    'SYSTEM_CONFIG_CHANGED',
    'BULK_IMPORT_EXECUTED',
    'INTEGRATION_TOKEN_CREATED',
    'INTEGRATION_TOKEN_REVOKED',
  ]),

  /** Cieľová entita akcie. */
  target: z
    .object({
      entityType: z.enum([
        'User',
        'Organisation',
        'Asset',
        'AssetType',
        'AssetCondition',
        'Loan',
        'LoanRequest',
        'StockMovement',
        'Category',
        'Location',
        'Membership',
        'Passkey',
        'System',
      ]),
      entityId: ObjectIdSchema.nullable(),
      snapshot: z.record(z.string(), z.unknown()).optional(), // snapshot kľúčových polí v čase
    })
    .nullable(),

  /** Stručný popis pre čítanie ľuďmi. */
  description: z.string().min(1).max(1000),

  /** Diff zmien (pre UPDATE akcie). */
  changes: z
    .array(
      z.object({
        field: z.string().max(200),
        before: z.unknown(),
        after: z.unknown(),
      }),
    )
    .nullable()
    .default(null),

  /** Voliteľný kontext / metadata. */
  metadata: z.record(z.string(), z.unknown()).default({}),

  /** Severity pre filtrovanie a alerty. */
  severity: z.enum(['INFO', 'WARNING', 'ERROR', 'CRITICAL']).default('INFO'),

  /**
   * GDPR článok 30 — právny základ spracovania pre túto akciu.
   *
   * Mapping na čl. 6 ods. 1 GDPR. Plný kontext v `docs/compliance/gdpr-article-30.md`.
   *
   * Hodnoty:
   * - `contract`            — čl. 6 ods. 1 písm. b) — plnenie zmluvy s tenantom
   * - `legal_obligation`    — čl. 6 ods. 1 písm. c) — zákonná povinnosť (audit log samotný)
   * - `legitimate_interest` — čl. 6 ods. 1 písm. f) — oprávnený záujem (security, prevencia strát)
   * - `public_task`         — čl. 6 ods. 1 písm. e) — verejný záujem (verejný sektor)
   * - `consent`             — čl. 6 ods. 1 písm. a) — súhlas (zatiaľ nevyužívané)
   * - `vital_interests`     — čl. 6 ods. 1 písm. d) — životné záujmy (n/a)
   * - `n/a`                 — udalosť nespracúva osobné údaje (system config, token rotation)
   *
   * Optional pre spätnú kompatibilitu so záznamami zapísanými pred Phase D —
   * staré rows tento field jednoducho nemajú a Zod sa nesťažuje. Nové akcie
   * cez `AuditLogService.record(...)` vždy field vyplnia.
   */
  legalBasis: z
    .enum([
      'contract',
      'legal_obligation',
      'legitimate_interest',
      'public_task',
      'consent',
      'vital_interests',
      'n/a',
    ])
    .nullable()
    .optional(),

  /**
   * GDPR článok 30 ods. 1 písm. c) — kategórie osobných údajov, ktorých sa akcia dotkla.
   *
   * Voľne kombinovateľné kategórie zo zoznamu. Prázdne pole znamená, že akcia
   * nespracúva osobné údaje (napríklad zmena systémovej konfigurácie alebo
   * rotácia integration tokenu).
   *
   * Hodnoty:
   * - `identification` — krstné meno, priezvisko, displayName, Entra ID OID
   * - `contact`        — e-mail, telefón
   * - `account`        — roly, isActive, lastLoginAt, preferences
   * - `authentication` — login event metadata: IP, User-Agent, MFA stav
   * - `asset_custody`  — väzba osoba ↔ pridelené aktívum alebo výpožička
   * - `audit_metadata` — snapshot dotknutého záznamu pre forenznú stopu
   *
   * Optional pre spätnú kompatibilitu so záznamami zapísanými pred Phase D.
   */
  dataCategories: z
    .array(
      z.enum([
        'identification',
        'contact',
        'account',
        'authentication',
        'asset_custody',
        'audit_metadata',
      ]),
    )
    .optional(),

  /** Či je záznam pseudonymizovaný (GDPR). */
  isPseudonymized: z.boolean().default(false),

  /**
   * Kedy bol záznam pseudonymizovaný retention jobom.
   *
   * Null kým `isPseudonymized=false`. Optional pre spätnú kompatibilitu —
   * pre-Phase-D rows tento field nemajú, no `isPseudonymized` zostáva
   * autoritatívne (default false).
   */
  pseudonymizedAt: TimestampSchema.nullable().optional(),
});

export type AuditLog = z.infer<typeof AuditLogSchema>;

/**
 * Schéma pre vytvorenie audit log záznamu. Bez _id (generuje ho Mongo).
 */
export const CreateAuditLogSchema = AuditLogSchema.omit({ _id: true });

export type CreateAuditLogInput = z.infer<typeof CreateAuditLogSchema>;
