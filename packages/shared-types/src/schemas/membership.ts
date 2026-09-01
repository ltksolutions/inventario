// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Membership schema — User ↔ Organisation many-to-many join (ADR-0015).
 *
 * Každá membership reprezentuje vzťah medzi globálnou identitou (User)
 * a jedným tenantom (Organisation). Polia, ktoré boli pôvodne na User
 * a sú per-tenant, sa presunuli sem: roles, organizationalUnit, teams,
 * mustChangePassword, notification preferences.
 *
 * Indexes (createIndexes v MembershipsRepository):
 *   - { userId, organisationId }  unique — max 1 membership per user-tenant pair
 *   - { userId, isDefault }       partial unique where isDefault=true
 *   - { organisationId, status, deletedAt }  — list active members
 *   - { userId, deletedAt }       — list user's tenants
 */

import { z } from 'zod';

import { USER_ROLE_VALUES } from '../enums/user-role.js';

import { BaseDocumentSchema, ObjectIdSchema, SoftDeleteSchema, TimestampSchema } from './common.js';

import type { UserRole } from '../enums/user-role.js';

export const MembershipSchema = BaseDocumentSchema.merge(SoftDeleteSchema).extend({
  /** Reference to global User identity. */
  userId: ObjectIdSchema,

  /** Reference to the Organisation (tenant). */
  organisationId: ObjectIdSchema,

  /**
   * Per-tenant rola (ADR-0029). JEDNA hodnota, nie pole — roly tvoria
   * lineárnu hierarchiu (ADMIN > ASSET_MANAGER > EMPLOYEE/EXTERNAL).
   * Predtým `roles: UserRole[]`; migrácia odvodí jednu rolu cez highestRole().
   */
  role: z.enum(USER_ROLE_VALUES as [UserRole, ...UserRole[]]) as z.ZodType<UserRole>,

  /** Per-tenant organizational unit. Moved from User.organizationalUnit. */
  organizationalUnit: z
    .object({
      id: ObjectIdSchema,
      name: z.string().min(1).max(200),
      type: z.enum(['ORG_DEPARTMENT', 'NATIONAL_TEAM', 'CLUB', 'EXTERNAL_ORG']),
    })
    .nullable()
    .default(null),

  /** Per-tenant team memberships. Moved from User.teams. */
  teams: z
    .array(
      z.object({
        teamId: ObjectIdSchema,
        teamName: z.string().min(1).max(200),
        role: z.enum(['MEMBER', 'MANAGER', 'COACH', 'ASSISTANT']),
      }),
    )
    .default([]),

  /** Lifecycle status. SUSPENDED = blocked from accessing the tenant. */
  status: z.enum(['ACTIVE', 'SUSPENDED']).default('ACTIVE'),

  /**
   * Whether this is the user's default tenant on login.
   * At most one membership per userId may have isDefault=true
   * (enforced by a MongoDB partial unique index).
   */
  isDefault: z.boolean().default(false),

  /**
   * Who created the membership.
   *   - ObjectId  → invited by another user
   *   - 'SYSTEM'  → self-serve registration or migration runner
   */
  invitedBy: z.union([ObjectIdSchema, z.literal('SYSTEM')]),

  /** When the membership row was created (= invite issued time). */
  invitedAt: TimestampSchema,

  /**
   * When user accepted the invite. Null for self-serve registrations
   * where invite == accept in the same request.
   */
  acceptedAt: TimestampSchema.nullable().default(null),

  /** Per-tenant onboarding flag. Moved from User.mustChangePassword. */
  mustChangePassword: z.boolean().default(false),

  /** Last time the user accessed this tenant (for "recently used" UX). */
  lastAccessedAt: TimestampSchema.nullable().default(null),

  /** Per-tenant notification preferences. Moved from User.preferences. */
  notifications: z
    .object({
      email: z.boolean().default(true),
      push: z.boolean().default(false),
    })
    .default({}),
});

export type Membership = z.infer<typeof MembershipSchema>;

// ---------------------------------------------------------------------------
// API schemas
// ---------------------------------------------------------------------------

export const CreateMembershipSchema = MembershipSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
});

export type CreateMembershipInput = z.infer<typeof CreateMembershipSchema>;

/**
 * PATCH payload — only mutable per-tenant fields.
 * role, organizationalUnit, teams, status, mustChangePassword.
 */
export const UpdateMembershipSchema = MembershipSchema.pick({
  role: true,
  organizationalUnit: true,
  teams: true,
  status: true,
  mustChangePassword: true,
  notifications: true,
}).partial();

export type UpdateMembershipInput = z.infer<typeof UpdateMembershipSchema>;

// ---------------------------------------------------------------------------
// Pre-provisioning (ADR-0034) — predpríprava budúceho používateľa
// ---------------------------------------------------------------------------

/**
 * POST /v1/memberships/pre-provisioned request body (ADR-0034).
 *
 * Umožňuje ASSET_MANAGER/ADMIN vopred vytvoriť `User` + `Membership` pre
 * budúceho zamestnanca so známou firemnou e-mailovou adresou — **len**
 * v organizáciách s `memberJoinPolicy: DOMAIN_RESTRICTED`. Výsledná adresa
 * (`localPart@domain`) musí patriť medzi `Organisation.autoJoinDomains`
 * (kontrola v service, nie v tejto schéme — potrebuje prístup k org dokumentu).
 *
 * `localPart` je zámerne oddelený od `domain` (nie jedno `EmailSchema` pole) —
 * UI ponúka `domain` ako select z povolených hodnôt, nie voľný text, takže sa
 * nedá vyplniť iná/cudzia doména.
 */
export const CreatePreProvisionedMemberSchema = z.object({
  /** Krstné meno budúceho zamestnanca. */
  firstName: z.string().min(1, 'Meno je povinné.').max(100, 'Meno je príliš dlhé.').trim(),

  /** Priezvisko budúceho zamestnanca. */
  lastName: z
    .string()
    .min(1, 'Priezvisko je povinné.')
    .max(100, 'Priezvisko je príliš dlhé.')
    .trim(),

  /**
   * Časť e-mailu pred @. Zjednodušená RFC 5321 lokálna časť — písmená,
   * číslice, `.`, `_`, `%`, `+`, `-`. Normalizuje sa na lowercase.
   */
  localPart: z
    .string()
    .min(1, 'Lokálna časť e-mailu je povinná.')
    .max(64, 'Lokálna časť e-mailu môže mať najviac 64 znakov.')
    .regex(/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/, 'Lokálna časť e-mailu obsahuje neplatné znaky.')
    .transform((val) => val.toLowerCase()),

  /**
   * Doména — musí byť jedna z `Organisation.autoJoinDomains` (kontrola v
   * service). Sem prichádza z UI select-u, nie voľný text.
   */
  domain: z
    .string()
    .min(1, 'Doména je povinná.')
    .max(253, 'Doména je príliš dlhá.')
    .trim()
    .toLowerCase(),
});

export type CreatePreProvisionedMemberInput = z.infer<typeof CreatePreProvisionedMemberSchema>;

/**
 * Verejná odpoveď na predpríprava — nie plný `User`/`Membership` dokument.
 * `hasLoggedIn` je odvodené z `User.lastLoginAt !== null` (ADR-0034) — UI ho
 * použije na odznak „Očakáva sa nástup".
 */
export const PreProvisionedMemberSchema = z.object({
  membershipId: ObjectIdSchema,
  userId: ObjectIdSchema,
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  displayName: z.string(),
  role: z.enum(USER_ROLE_VALUES as [UserRole, ...UserRole[]]) as z.ZodType<UserRole>,
  hasLoggedIn: z.boolean(),
  createdAt: TimestampSchema,
});

export type PreProvisionedMember = z.infer<typeof PreProvisionedMemberSchema>;
