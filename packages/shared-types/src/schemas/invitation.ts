// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Invitation schema — dedicated collection replacing the ghost-user pattern
 * (ADR-0015, K1).
 *
 * Pending invitations boli pred Slice #9 uložené ako User dokumenty
 * s passwordHash=null. Tento pattern blokoval cross-tenant invites pretože
 * globálny unique index na email neumožňoval druhú pozvánku na rovnakú adresu.
 *
 * Nová kolekcia `invitations` oddeľuje pozvánky od identity:
 *   - `invitedUserId = null`      → nový používateľ (email zatiaľ neregistrovaný)
 *   - `invitedUserId = ObjectId`  → cross-tenant alebo rejoin invite
 *
 * Indexes (createIndexes v InvitationsRepository):
 *   - { token }                          unique sparse
 *   - { organisationId, status, deletedAt }
 *   - { email, organisationId, status }  — prevent duplicate active invites
 *   - { expiresAt }                      — cleanup job
 */

import { z } from 'zod';

import { USER_ROLE_VALUES } from '../enums/user-role.js';

import {
  BaseDocumentSchema,
  EmailSchema,
  ObjectIdSchema,
  SoftDeleteSchema,
  TimestampSchema,
} from './common.js';

import type { UserRole } from '../enums/user-role.js';

export const InvitationSchema = BaseDocumentSchema.merge(SoftDeleteSchema).extend({
  /** Target email (lowercase). Membership will be created for the User matching this email. */
  email: EmailSchema,

  /** Target tenant. */
  organisationId: ObjectIdSchema,

  /** Roles to grant on accept. */
  roles: z
    .array(z.enum(USER_ROLE_VALUES as [UserRole, ...UserRole[]]) as z.ZodType<UserRole>)
    .min(1),

  /** Optional pre-fill for the new-user accept page. */
  firstName: z.string().min(1).max(100).nullable().default(null),

  /** Optional pre-fill for the new-user accept page. */
  lastName: z.string().min(1).max(100).nullable().default(null),

  /**
   * Resolved at invitation creation time.
   *   - null      → no Inventario account for this email yet (new-user flow)
   *   - ObjectId  → existing User (cross-tenant invite or rejoin)
   */
  invitedUserId: ObjectIdSchema.nullable().default(null),

  /**
   * Cryptographically random invite token (64 hex chars = 32 bytes).
   * NEVER returned in API responses except through the
   * GET /v1/auth/invitations/:token preview endpoint.
   */
  token: z.string().regex(/^[a-f0-9]{64}$/, 'Token musí byť 64 hex znakov.'),

  /** When the invite expires (default: now + 7 days). */
  expiresAt: TimestampSchema,

  /** Who sent the invite. */
  invitedBy: ObjectIdSchema,

  /** Lifecycle status. */
  status: z.enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED']).default('PENDING'),

  /** Set when the invite transitions to ACCEPTED. */
  acceptedAt: TimestampSchema.nullable().default(null),

  /** Resulting membershipId after successful accept. */
  membershipId: ObjectIdSchema.nullable().default(null),
});

export type Invitation = z.infer<typeof InvitationSchema>;

// ---------------------------------------------------------------------------
// API schemas
// ---------------------------------------------------------------------------

/**
 * POST /v1/invitations request body.
 */
export const CreateInvitationSchema = z.object({
  email: EmailSchema,
  roles: z
    .array(z.enum(USER_ROLE_VALUES as [UserRole, ...UserRole[]]) as z.ZodType<UserRole>)
    .min(1),
  firstName: z.string().min(1).max(100).nullable().default(null),
  lastName: z.string().min(1).max(100).nullable().default(null),
});

export type CreateInvitationInput = z.infer<typeof CreateInvitationSchema>;
