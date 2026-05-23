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

  /** Per-tenant roles. Moved from User.roles. */
  roles: z
    .array(z.enum(USER_ROLE_VALUES as [UserRole, ...UserRole[]]) as z.ZodType<UserRole>)
    .min(1, 'Membership musí mať aspoň jednu rolu.'),

  /** Per-tenant organizational unit. Moved from User.organizationalUnit. */
  organizationalUnit: z
    .object({
      id: ObjectIdSchema,
      name: z.string().min(1).max(200),
      type: z.enum(['SFZ_DEPARTMENT', 'NATIONAL_TEAM', 'CLUB', 'EXTERNAL_ORG']),
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
 * roles, organizationalUnit, teams, status, mustChangePassword.
 */
export const UpdateMembershipSchema = MembershipSchema.pick({
  roles: true,
  organizationalUnit: true,
  teams: true,
  status: true,
  mustChangePassword: true,
  notifications: true,
}).partial();

export type UpdateMembershipInput = z.infer<typeof UpdateMembershipSchema>;
