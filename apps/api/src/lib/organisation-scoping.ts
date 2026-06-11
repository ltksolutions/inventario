// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Multi-tenant scoping utilities for MongoDB repositories.
 *
 * Every domain collection in Inventario (assets, categories, locations,
 * users, audit_logs) is scoped to exactly one tenant via the
 * `organisationId` field. This module provides the small primitives the
 * repositories use to enforce that scoping without each repo
 * reinventing the same `{ ...filter, organisationId }` pattern.
 *
 * # Why utility functions instead of a base class
 *
 * Mongo collection types (`Collection<Asset>`, `Collection<Category>`)
 * are generic over the document shape, and our docs have heterogeneous
 * key fields (assets have `inventoryNumber`, categories+locations have
 * `slug`, audit logs have `at`, users have `entraOid`). A single
 * `OrganisationScopedRepository<T>` base class would need either:
 *   - lots of `extends` machinery that fights the WithId<T> driver
 *     types, or
 *   - lowest-common-denominator methods that lose the
 *     resource-specific helpers (findHighestInventorySequence,
 *     findBySlug, countByCategory, ...).
 *
 * Either choice is worse than just calling `requireTenantId(orgId)`
 * and `tenantFilter(orgId, otherFilter)` at the top of each method in
 * the existing repositories. The repos stay flat, the scope check is
 * explicit, and there's no inheritance to debug when something goes
 * wrong.
 *
 * # Placeholder tenant id
 *
 * `PENDING_TENANT_ID` (`'000000000000000000000000'`) is a sentinel
 * organisation id used during just-in-time user provisioning, before
 * the tenant resolution flow lands in Phase C Blok 3. Documents written
 * with this id are valid for the schema but get rewritten by the
 * migration script in Phase C Blok 4 to point at the real default
 * Inventario tenant.
 */

import { BadRequestError } from '../plugins/error-handler.js';

import type { Filter } from 'mongodb';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Placeholder tenant id used during JIT user provisioning until the
 * tenant resolution flow lands in Phase C Blok 3. 24 hex zeros — a
 * valid ObjectIdSchema string that cannot be confused with a real
 * tenant id and is trivially greppable.
 *
 * The migration script in Phase C Blok 4 replaces every occurrence
 * with the real default Inventario tenant _id.
 */
export const PENDING_TENANT_ID = '000000000000000000000000';

/**
 * Regex matching the 24-hex-character ObjectId string format used
 * across the codebase for ids in the Mongo collection.
 *
 * Defined here (not imported from shared-types) because shared-types
 * carries the Zod schema while this module needs a plain regex for
 * runtime guards.
 */
const OBJECT_ID_REGEX = /^[a-f\d]{24}$/i;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Validate that a tenant id looks like a Mongo ObjectId hex string and
 * is non-empty. Throws BadRequestError on bad input.
 *
 * This is the gate that protects every repository operation from being
 * called with an empty / undefined / malformed `organisationId`. Without
 * this gate, a bug in the service layer that forgot to thread tenant
 * scope through could leak data across tenants by passing `''` or
 * `undefined` to a filter, which Mongo would silently treat as "no
 * filter on this field".
 *
 * Returns the validated id unchanged so call sites can chain.
 */
export function requireTenantId(organisationId: string | undefined | null): string {
  if (typeof organisationId !== 'string' || organisationId.length === 0) {
    throw new BadRequestError(
      'Missing organisationId on a tenant-scoped operation. ' +
        'This is a server-side wiring bug — the request reached the repository ' +
        'without a resolved tenant context. Please contact an administrator.',
    );
  }

  if (!OBJECT_ID_REGEX.test(organisationId)) {
    throw new BadRequestError(
      `Malformed organisationId "${organisationId}" on a tenant-scoped operation. ` +
        'Expected a 24-character hex ObjectId string.',
    );
  }

  return organisationId;
}

/**
 * Compose a Mongo filter that adds the tenant scope (and the default
 * soft-delete-exclusion) to a caller-supplied filter. Returns the
 * composed filter ready to pass to `.find()` / `.countDocuments()`.
 *
 * # Soft-delete exclusion
 *
 * By default, the returned filter pins `deletedAt: null` (i.e. excludes
 * soft-deleted docs). Pass `{ includeDeleted: true }` to opt out — that
 * matters for audit / forensic queries that need to see deleted docs,
 * but for everything else, callers want the default behavior.
 *
 * If the caller-supplied filter already specifies `deletedAt` (e.g.
 * to find ONLY deleted docs for a restore endpoint), we respect that
 * and do not override.
 *
 * # Tenant scope
 *
 * `organisationId` is always added. If the caller-supplied filter
 * already has an `organisationId` key, we override it (defensive: the
 * caller shouldn't be setting tenant scope manually; this function
 * is the single source of truth).
 *
 * # Why a function over inlining the spread
 *
 * Easier to grep for ("show me every tenant-scoped query") and the
 * soft-delete default is encoded once rather than repeated at every
 * call site.
 */
export function tenantFilter<T>(
  organisationId: string,
  callerFilter: Filter<T> = {},
  options: { includeDeleted?: boolean } = {},
): Filter<T> {
  const filter = { ...callerFilter } as Record<string, unknown>;

  // Tenant scope is non-negotiable.
  filter['organisationId'] = organisationId;

  // Soft-delete default: exclude unless caller explicitly wanted otherwise.
  if (!options.includeDeleted && filter['deletedAt'] === undefined) {
    filter['deletedAt'] = null;
  }

  return filter as Filter<T>;
}
