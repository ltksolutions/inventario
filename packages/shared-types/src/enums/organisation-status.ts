// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Status of a tenant organisation in the multi-tenant Inventario platform.
 *
 * Lifecycle: ACTIVE is the default. SUSPENDED freezes write access but
 * lets users still read their data (useful for billing disputes or
 * trial expirations). ARCHIVED is a soft-delete tombstone — data
 * retained for legal/audit reasons but tenant cannot log in.
 *
 * See ADR-0010 for multi-tenant rationale.
 */
export const OrganisationStatus = {
  /** Active tenant — full read/write access. */
  ACTIVE: 'ACTIVE',
  /** Read-only access. Used for billing disputes, trial expiration, manual review. */
  SUSPENDED: 'SUSPENDED',
  /** Soft-deleted tenant. Data retained for audit/legal reasons but no user can log in. */
  ARCHIVED: 'ARCHIVED',
} as const;

export type OrganisationStatus = (typeof OrganisationStatus)[keyof typeof OrganisationStatus];

export const ORGANISATION_STATUS_VALUES = Object.values(
  OrganisationStatus,
) as readonly OrganisationStatus[];

/**
 * Subscription plan that determines feature gates and per-tenant limits.
 *
 * FREE is for trial / community use, limited tenant count and feature set.
 * PRO adds custom branding and increased limits.
 * ENTERPRISE adds custom domain, SLA, dedicated support, and (eventually)
 * per-tenant cluster for organisations with hard compliance requirements.
 */
export const OrganisationPlan = {
  FREE: 'FREE',
  PRO: 'PRO',
  ENTERPRISE: 'ENTERPRISE',
} as const;

export type OrganisationPlan = (typeof OrganisationPlan)[keyof typeof OrganisationPlan];

export const ORGANISATION_PLAN_VALUES = Object.values(
  OrganisationPlan,
) as readonly OrganisationPlan[];
