// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * User schema — globálna identita (ADR-0015, Slice #9 K1).
 *
 * Po refaktore cross-tenant memberships (ADR-0015) je User **globálny**
 * dokument reprezentujúci identitu osoby naprieč všetkými tenantmi.
 *
 * Polia označené @deprecated sú per-tenant polia presunuté na Membership.
 * Zostávajú voliteľné pre backward compat počas migrácie a budú úplne
 * odstránené z kódu v K3 (repozitáre) po spustení migration runnera.
 *
 * Globálne identity polia (zostávajú):
 *   email, firstName, lastName, displayName, phone,
 *   accountType, entraOid, authProviders[],
 *   emailVerified + verification tokens,
 *   passwordHash + reset tokens,
 *   MFA fields, isActive, lastLoginAt,
 *   preferences: { language, timezone }
 *
 * @deprecated polia (presunúť na Membership, odstrániť po K3):
 *   organisationId, roles, organizationalUnit, teams,
 *   invitationSentAt, mustChangePassword,
 *   preferences.emailNotifications, preferences.pushNotifications
 */

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

export const UserSchema = BaseDocumentSchema.merge(SoftDeleteSchema)
  // NOTE: OrganisationScopedSchema (organisationId) kept as migration compat.
  // After migration runner removes `organisationId` from all User docs,
  // remove this merge in K3 cleanup.
  .merge(OrganisationScopedSchema.partial())
  .extend({
    /** Primárny e-mail — globally unique, lowercase, normalizovaný. */
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

    /** Display name — celé meno pre UI. */
    displayName: z.string().min(1).max(200).trim(),

    /** Telefón. Voliteľný. */
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

    authProviders: z
      .array(
        z.object({
          provider: z.enum(
            Object.values(AuthProvider) as [string, ...string[]],
          ) as z.ZodType<AuthProvider>,
          providerId: z.string().min(1),
          email: z.string().email(),
          linkedAt: z.string().datetime(),
        }),
      )
      .default([]),

    emailVerified: z.boolean().default(false),

    /** Token pre overenie e-mailu. NIKDY do API response. */
    emailVerificationToken: z.string().nullable().default(null),

    emailVerificationExpiresAt: z.string().datetime().nullable().default(null),

    /** Token pre reset hesla. NIKDY do API response. */
    passwordResetToken: z.string().nullable().default(null),

    passwordResetExpiresAt: z.string().datetime().nullable().default(null),

    /** Hash hesla. Len pre LOCAL účty. NIKDY do API response. */
    passwordHash: z.string().nullable().default(null),

    // -----------------------------------------------------------------
    // Email change verification (post-Slice #9)
    // -----------------------------------------------------------------

    /** Nová e-mailová adresa čakajúca na potvrdenie. */
    emailChangePendingTo: z.string().email().nullable().default(null),

    /** Token pre potvrdenie zmeny e-mailu. NIKDY do API response. */
    emailChangeToken: z.string().nullable().default(null),

    emailChangeExpiresAt: z.string().datetime().nullable().default(null),

    // -----------------------------------------------------------------
    // @deprecated per-tenant fields — presunúť na Membership po K3
    // -----------------------------------------------------------------

    /**
     * @deprecated Presunúť na Membership.roles. Zostáva pre migration compat.
     * Odstráni sa z User schémy v K3. Default [] aby existujúci kód neskompiloval na undefined.
     */
    roles: z
      .array(z.enum(Object.values(UserRole) as [string, ...string[]]) as z.ZodType<UserRole>)
      .default([]),

    /**
     * @deprecated Presunúť na Membership.organizationalUnit. Zostáva pre migration compat.
     */
    organizationalUnit: z
      .object({
        id: ObjectIdSchema,
        name: z.string().min(1).max(200),
        type: z.enum(['SFZ_DEPARTMENT', 'NATIONAL_TEAM', 'CLUB', 'EXTERNAL_ORG']),
      })
      .nullable()
      .optional(),

    /**
     * @deprecated Presunúť na Membership.teams. Zostáva pre migration compat.
     */
    teams: z
      .array(
        z.object({
          teamId: ObjectIdSchema,
          teamName: z.string().min(1).max(200),
          role: z.enum(['MEMBER', 'MANAGER', 'COACH', 'ASSISTANT']),
        }),
      )
      .optional(),

    /**
     * @deprecated Presunúť na Membership.mustChangePassword. Zostáva pre migration compat.
     */
    mustChangePassword: z.boolean().optional(),

    /**
     * @deprecated Presunúť na Membership.invitedAt. Zostáva pre migration compat.
     */
    invitationSentAt: TimestampSchema.nullable().optional(),

    // -----------------------------------------------------------------
    // Global state
    // -----------------------------------------------------------------

    /**
     * Globálna aktívnosť účtu.
     * false = súdny zákaz / GDPR right-to-restrict / admin block.
     */
    isActive: z.boolean().default(true),

    /** Posledné prihlásenie (globálne, nie per-tenant). */
    lastLoginAt: TimestampSchema.nullable().default(null),

    // -----------------------------------------------------------------
    // TOTP MFA (Slice #7)
    // -----------------------------------------------------------------

    mfaEnabled: z.boolean().default(false),

    /** AES-256-GCM-encrypted TOTP secret. NIKDY do API response. */
    mfaSecret: z.string().nullable().default(null),

    /** Argon2id-hashed single-use recovery codes. NIKDY do API response. */
    mfaRecoveryCodes: z.array(z.string()).default([]),

    /** Kedy bolo MFA aktivované. */
    mfaEnabledAt: TimestampSchema.nullable().default(null),

    /**
     * Preferencie používateľa.
     *
     * Globálne: language, timezone.
     * @deprecated emailNotifications, pushNotifications → Membership.notifications (K3).
     */
    preferences: z
      .object({
        language: z.enum(['sk', 'en']).default('sk'),
        timezone: z.string().default('Europe/Bratislava'),
        /** @deprecated Presunúť na Membership.notifications.email. */
        emailNotifications: z.boolean().optional(),
        /** @deprecated Presunúť na Membership.notifications.push. */
        pushNotifications: z.boolean().optional(),
      })
      .default({}),
  });

export type User = z.infer<typeof UserSchema>;

// ---------------------------------------------------------------------------
// API schemas
// ---------------------------------------------------------------------------

export const CreateUserSchema = UserSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
  passwordHash: true,
  lastLoginAt: true,
  authProviders: true,
  emailVerified: true,
  emailVerificationToken: true,
  emailVerificationExpiresAt: true,
  passwordResetToken: true,
  passwordResetExpiresAt: true,
  mfaEnabled: true,
  mfaSecret: true,
  mfaRecoveryCodes: true,
  mfaEnabledAt: true,
  invitationSentAt: true,
}).extend({
  /** Pre LOCAL účty — počiatočné heslo. */
  initialPassword: z.string().min(12).max(128).optional(),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = UserSchema.omit({
  _id: true,
  email: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
  passwordHash: true,
  accountType: true,
  entraOid: true,
  authProviders: true,
  emailVerified: true,
  emailVerificationToken: true,
  emailVerificationExpiresAt: true,
  passwordResetToken: true,
  passwordResetExpiresAt: true,
  mfaEnabled: true,
  mfaSecret: true,
  mfaRecoveryCodes: true,
  mfaEnabledAt: true,
}).partial();

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

/** Public profile — bez sensitive polí. */
export const UserPublicSchema = UserSchema.pick({
  _id: true,
  firstName: true,
  lastName: true,
  displayName: true,
  email: true,
});

export type UserPublic = z.infer<typeof UserPublicSchema>;
