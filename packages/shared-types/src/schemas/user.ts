import { z } from 'zod';

import { AuthProvider } from '../enums/auth-provider.js';
import { AccountType, UserRole } from '../enums/user-role.js';

import {
  BaseDocumentSchema,
  EmailSchema,
  ObjectIdSchema,
  OrganisationScopedSchema,
  PhoneSchema,
  SoftDeleteSchema,
  TimestampSchema,
} from './common.js';

/**
 * Reprezentácia používateľa systému.
 *
 * Hlavné identitné polia:
 * - `email` — primárny identifikátor, unique
 * - `accountType` — určuje spôsob prihlásenia (Entra SSO vs lokálne heslo)
 * - `entraOid` — Object ID z Microsoft Entra (povinné pre ENTRA_ID účty)
 *
 * Bezpečnostné polia (`passwordHash`, `passwordSalt`, `mfaSecret`) sa NIKDY
 * neserializujú do API response — repository vrstva ich odfiltruje cez projekcie.
 */
export const UserSchema = BaseDocumentSchema.merge(SoftDeleteSchema)
  .merge(OrganisationScopedSchema)
  .extend({
    /** Primárny e-mail (unique, lowercase, normalizovaný). */
    email: EmailSchema,

    /** Krstné meno. */
    firstName: z
      .string()
      .min(1, 'Meno je povinné.')
      .max(100, 'Meno je príliš dlhé (max 100 znakov).')
      .trim(),

    /** Priezvisko. */
    lastName: z
      .string()
      .min(1, 'Priezvisko je povinné.')
      .max(100, 'Priezvisko je príliš dlhé (max 100 znakov).')
      .trim(),

    /** Display name — celé meno, pre UI. */
    displayName: z.string().min(1).max(200).trim(),

    /** Telefón. Voliteľný, ale silne odporúčaný (pre notifikácie). */
    phone: PhoneSchema.optional(),

    /** Typ účtu — určuje spôsob autentifikácie. */
    accountType: z.enum(
      Object.values(AccountType) as [string, ...string[]],
    ) as z.ZodType<AccountType>,

    /** Microsoft Entra ID Object ID — povinné pre ENTRA_ID účty, null pre LOCAL. */
    entraOid: z.string().uuid().nullable().default(null),

    // -----------------------------------------------------------------
    // Multi-provider auth (ADR-0013)
    // -----------------------------------------------------------------

    /**
     * Linked auth providers for this user. A user can have multiple
     * providers linked (e.g. Microsoft at work, Google at home).
     *
     * For legacy Entra ID users, migration script populates this from
     * `entraOid`. For new users, populated during OAuth callback or
     * email registration.
     *
     * Empty array for legacy users not yet migrated (backward compat).
     */
    authProviders: z
      .array(
        z.object({
          /** Which auth provider. */
          provider: z.enum(
            Object.values(AuthProvider) as [string, ...string[]],
          ) as z.ZodType<AuthProvider>,
          /** Provider-specific user ID (Google sub, Apple sub, Entra oid, or email). */
          providerId: z.string().min(1),
          /** Email used with this provider. */
          email: z.string().email(),
          /** When this provider was linked. */
          linkedAt: z.string().datetime(),
        }),
      )
      .default([]),

    /** Whether the user’s primary email has been verified. */
    emailVerified: z.boolean().default(false),

    /** Token for email verification flow. Null when not pending. NEVER in API response. */
    emailVerificationToken: z.string().nullable().default(null),

    /** Expiry for email verification token. */
    emailVerificationExpiresAt: z.string().datetime().nullable().default(null),

    /** Token for password reset flow. Null when not pending. NEVER in API response. */
    passwordResetToken: z.string().nullable().default(null),

    /** Expiry for password reset token. */
    passwordResetExpiresAt: z.string().datetime().nullable().default(null),

    /** Hash hesla (bcrypt/argon2). Len pre LOCAL účty. NIKDY do API response. */
    passwordHash: z.string().nullable().default(null),

    /** Roly používateľa. Používateľ môže mať viacero rolí naraz. */
    roles: z
      .array(z.enum(Object.values(UserRole) as [string, ...string[]]) as z.ZodType<UserRole>)
      .min(1, 'Používateľ musí mať aspoň jednu rolu.'),

    /** ID organizačnej jednotky / útvaru SFZ (alebo klubu pre EXTERNAL). */
    organizationalUnit: z
      .object({
        id: ObjectIdSchema,
        name: z.string().min(1).max(200),
        type: z.enum(['SFZ_DEPARTMENT', 'NATIONAL_TEAM', 'CLUB', 'EXTERNAL_ORG']),
      })
      .nullable()
      .default(null),

    /** Tímy, ktorých je členom (pre TEAM_MANAGER). */
    teams: z
      .array(
        z.object({
          teamId: ObjectIdSchema,
          teamName: z.string().min(1).max(200),
          role: z.enum(['MEMBER', 'MANAGER', 'COACH', 'ASSISTANT']),
        }),
      )
      .default([]),

    /** Či je účet aktívny (povolený prihlásiť sa). */
    isActive: z.boolean().default(true),

    /** Posledné prihlásenie. */
    lastLoginAt: TimestampSchema.nullable().default(null),

    /** Posledné odoslanie aktivačného e-mailu (pre LOCAL účty). */
    invitationSentAt: TimestampSchema.nullable().default(null),

    /** Či musí používateľ pri ďalšom prihlásení zmeniť heslo (pre LOCAL). */
    mustChangePassword: z.boolean().default(false),

    // -----------------------------------------------------------------
    // TOTP MFA (Slice #7)
    // -----------------------------------------------------------------

    /**
     * Či má používateľ aktivované TOTP MFA. Default `false`.
     * Zapína sa cez `POST /v1/auth/mfa/verify-setup`, vypína cez
     * `POST /v1/auth/mfa/disable`. Pri login-e ak `true`, server
     * vyžaduje druhý faktor (TOTP code alebo recovery code).
     *
     * OAuth (Google/Microsoft) sessions ignorujú tento flag — providers
     * majú vlastné MFA na svojej strane.
     */
    mfaEnabled: z.boolean().default(false),

    /**
     * AES-256-GCM-encrypted base32 TOTP secret. Null keď MFA nie je
     * aktívne. NIKDY do API response — repository projekcia ho
     * filtruje rovnako ako `passwordHash`.
     *
     * Formát uloženia: `<iv-hex>:<authTag-hex>:<ciphertext-hex>` (split
     * by ':'). Šifruje sa cez `MFA_SECRET_ENCRYPTION_KEY` env var.
     */
    mfaSecret: z.string().nullable().default(null),

    /**
     * Argon2id-hashed single-use recovery codes. Default 8 ks pri
     * setup-e. Pri použití kódu sa odstráni z poľa.
     *
     * NIKDY do API response — okrem jedného momentu hneď po
     * `verify-setup` keď server vráti plaintext kódy používateľovi
     * (a uloží si len hashes). Po tom je už k dispozícii iba pre
     * porovnanie počas challenge.
     */
    mfaRecoveryCodes: z.array(z.string()).default([]),

    /** Kedy bolo MFA aktivované. Null = neaktivované. */
    mfaEnabledAt: TimestampSchema.nullable().default(null),

    /** Preferencie používateľa. */
    preferences: z
      .object({
        language: z.enum(['sk', 'en']).default('sk'),
        timezone: z.string().default('Europe/Bratislava'),
        emailNotifications: z.boolean().default(true),
        pushNotifications: z.boolean().default(false),
      })
      .default({}),
  });

export type User = z.infer<typeof UserSchema>;

/**
 * Schéma pre vytvorenie nového používateľa cez API.
 * Bez audit fields (tie generuje server) a bez bezpečnostných polí.
 */
export const CreateUserSchema = UserSchema.omit({
  _id: true,
  organisationId: true, // Server-provided from authenticated context
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
  passwordHash: true,
  lastLoginAt: true,
  invitationSentAt: true,
  authProviders: true, // managed by auth system
  emailVerified: true, // managed by auth system
  emailVerificationToken: true, // internal security token
  emailVerificationExpiresAt: true, // internal
  passwordResetToken: true, // internal security token
  passwordResetExpiresAt: true, // internal
  mfaEnabled: true, // managed via /v1/auth/mfa endpoints
  mfaSecret: true, // internal security material
  mfaRecoveryCodes: true, // internal security material
  mfaEnabledAt: true, // managed via /v1/auth/mfa endpoints
}).extend({
  /** Pre LOCAL účty — počiatočné heslo. Musí byť zaslané cez secure channel. */
  initialPassword: z.string().min(12).max(128).optional(),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;

/**
 * Schéma pre update používateľa — všetky polia voliteľné okrem identity.
 */
export const UpdateUserSchema = UserSchema.omit({
  _id: true,
  organisationId: true, // Tenant scope is immutable
  email: true, // E-mail sa nemení (alebo cez special flow)
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
  passwordHash: true,
  accountType: true,
  entraOid: true,
  authProviders: true, // managed by auth system
  emailVerified: true, // managed by auth system
  emailVerificationToken: true, // internal security token
  emailVerificationExpiresAt: true, // internal
  passwordResetToken: true, // internal security token
  passwordResetExpiresAt: true, // internal
  mfaEnabled: true, // managed via /v1/auth/mfa endpoints
  mfaSecret: true, // internal security material
  mfaRecoveryCodes: true, // internal security material
  mfaEnabledAt: true, // managed via /v1/auth/mfa endpoints
}).partial();

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

/**
 * Public profile — verzia, ktorú môžu vidieť ostatní používatelia.
 * Bez sensitive polí.
 */
export const UserPublicSchema = UserSchema.pick({
  _id: true,
  firstName: true,
  lastName: true,
  displayName: true,
  email: true,
  organizationalUnit: true,
  roles: true,
});

export type UserPublic = z.infer<typeof UserPublicSchema>;
