// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Auth plugin — Inventario JWT cookie verification (ADR-0013, ADR-0015 K6).
 *
 * K6 changes (Slice #9b):
 *   loadCurrentUser now resolves the active Membership and populates
 *   request context from it rather than from the User document.
 *
 *   Membership resolution order:
 *     1. If JWT carries `mid` claim → validate that specific membership
 *     2. If no `mid` → fall back to the user's default membership for `org`
 *     3. If no membership found → 401 MEMBERSHIP_NOT_FOUND
 *     4. If membership is SUSPENDED → 403 MEMBERSHIP_SUSPENDED
 *
 *   Security benefit: if an ADMIN revokes a role mid-session, the next
 *   request re-reads from DB (max 60s cache lag) rather than trusting
 *   the 15-min JWT roles claim.
 *
 *   60s in-memory cache (per Fastify worker):
 *     Cache key: `${userId}:${organisationId}`
 *     Invalidated by MembershipsRepository write paths (K15).
 *     For now implemented as a simple Map with TTL timestamps.
 *     Future: replace with Redis when scaling beyond single worker.
 *
 * Provides three decorators (unchanged interface):
 *   app.requireAuth        — verifies the inv_access cookie
 *   app.loadCurrentUser    — loads user + org + membership from MongoDB
 *   app.requireRole([...]) — enforces RBAC against membership.roles
 */

import {
  roleSatisfies,
  highestRole,
  UserRole as UserRoleEnum,
  USER_ROLE_VALUES,
} from '@inventario/shared-types';
import fp from 'fastify-plugin';
import { ObjectId } from 'mongodb';

import { MembershipsRepository } from '../modules/memberships/memberships.repository.js';

import { ForbiddenError, UnauthorizedError } from './error-handler.js';

import type { InventarioJwtPayload } from './inventario-jwt.js';
import type { Membership, Organisation, User, UserRole } from '@inventario/shared-types';
import type { FastifyPluginAsync, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Membership cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  membership: WithId<Membership>;
  expiresAt: number; // Date.now() ms
}

// Module-level cache — shared across requests within the same Fastify worker.
// TTL is 60 seconds per ADR-0015.
const CACHE_TTL_MS = 60_000;
const membershipCache = new Map<string, CacheEntry>();

function cacheKey(userId: string, organisationId: string): string {
  return `${userId}:${organisationId}`;
}

function getFromCache(userId: string, organisationId: string): WithId<Membership> | null {
  const entry = membershipCache.get(cacheKey(userId, organisationId));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    membershipCache.delete(cacheKey(userId, organisationId));
    return null;
  }
  return entry.membership;
}

function setInCache(membership: WithId<Membership>): void {
  const key = cacheKey(membership.userId, membership.organisationId);
  membershipCache.set(key, {
    membership,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * Invalidate cached membership for a user+org pair.
 * Called by MembershipsRepository write paths (K15) to ensure role
 * changes take effect within 1 request (not after 60s TTL expiry).
 */
export function invalidateMembershipCache(userId: string, organisationId: string): void {
  membershipCache.delete(cacheKey(userId, organisationId));
}

// ---------------------------------------------------------------------------
// Fastify request / instance decoration
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyRequest {
    inventarioClaims?: InventarioJwtPayload;

    /** Resolved tenant Organisation document. Populated by `loadCurrentUser`. */
    organisation: WithId<Organisation>;

    /** Convenience accessor: `organisation._id` as a hex string. */
    organisationId: string;

    /**
     * Current user document. Populated by `loadCurrentUser`.
     * NOTE: after K6, the authoritative role comes from
     * `request.activeMembership.role`. `currentUser.role` is backfilled
     * per-request from the active membership for service-layer convenience.
     * The legacy `currentUser.roles` array is NOT used for RBAC.
     */
    currentUser: WithId<User> & { role: UserRole };

    /**
     * Active membership for this request (ADR-0015 K6).
     * Populated by `loadCurrentUser`. Contains the authoritative roles.
     */
    activeMembership: WithId<Membership>;
  }

  interface FastifyInstance {
    requireAuth: (request: FastifyRequest) => Promise<void>;
    loadCurrentUser: (request: FastifyRequest) => Promise<void>;
    requireRole: (allowed: readonly UserRole[]) => preHandlerAsyncHookHandler;
    /**
     * Hierarchical RBAC (ADR-0029): allow if the membership role is at least
     * `required` level. `requireMinRole('ASSET_MANAGER')` lets ADMIN through.
     */
    requireMinRole: (required: UserRole) => preHandlerAsyncHookHandler;
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const authPlugin: FastifyPluginAsync = async (fastify) => {
  const membershipsRepo = new MembershipsRepository(fastify.mongo.db);
  await membershipsRepo.ensureIndexes();

  // -------------------------------------------------------------------------
  // requireAuth — verifies the inv_access cookie
  // -------------------------------------------------------------------------

  fastify.decorate('requireAuth', async (request: FastifyRequest) => {
    const invCookie = request.cookies?.['inv_access'];
    if (!invCookie) throw new UnauthorizedError('Not authenticated');

    const claims = await fastify.inventarioJwt.verifyAccessToken(invCookie);
    request.inventarioClaims = claims;
    request.log.debug(
      { sub: claims.sub, org: claims.org, mid: claims.mid },
      'Inventario JWT verified',
    );
  });

  // -------------------------------------------------------------------------
  // loadCurrentUser — resolves user + org + membership
  // -------------------------------------------------------------------------

  fastify.decorate('loadCurrentUser', async (request: FastifyRequest) => {
    if (!request.inventarioClaims) {
      throw new Error('loadCurrentUser called without prior requireAuth — fix preHandler chain.');
    }

    const payload = request.inventarioClaims;

    // ----- Resolve tenant -----
    const orgDoc = await fastify.mongo.db
      .collection('organisations')
      .findOne({ _id: new ObjectId(payload.org), deletedAt: null });

    if (!orgDoc) throw new UnauthorizedError('Tenant unavailable.');
    if ((orgDoc['status'] as string) !== 'ACTIVE')
      throw new UnauthorizedError(`Tenant is ${(orgDoc['status'] as string).toLowerCase()}.`);

    request.organisation = orgDoc as unknown as WithId<Organisation>;
    request.organisationId = String(orgDoc._id);

    // ----- Resolve user -----
    const userDoc = await fastify.mongo.db
      .collection('users')
      .findOne({ _id: new ObjectId(payload.sub), deletedAt: null });

    if (!userDoc) throw new UnauthorizedError('User not found.');
    if (!(userDoc['isActive'] as boolean))
      throw new UnauthorizedError('User account is deactivated.');

    request.currentUser = userDoc as unknown as WithId<User> & { role: UserRole };

    // ----- GDPR čl. 18 enforcement: restricted users are read-only -----
    //
    // A user with `isRestricted: true` has their processing restricted: data
    // is retained and readable, but no further processing is permitted. We
    // enforce this by rejecting mutating HTTP methods (POST/PATCH/PUT/DELETE)
    // with 403, while allowing safe methods (GET/HEAD/OPTIONS).
    //
    // Exceptions (always allowed even when restricted):
    //   - DELETE /v1/auth/me  — right to erasure (čl. 17) overrides restriction
    //   - lifting the restriction itself is an admin action on ANOTHER user's
    //     account, so it runs under the admin's (unrestricted) context — no
    //     exception needed here.
    if (userDoc['isRestricted'] === true) {
      const method = request.method.toUpperCase();
      const isMutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
      const isErasureRequest = method === 'DELETE' && request.url.startsWith('/v1/auth/me');

      if (isMutating && !isErasureRequest) {
        throw new ForbiddenError(
          'PROCESSING_RESTRICTED: Your data processing is restricted (GDPR Art. 18). ' +
            'Only read operations are permitted. Contact an administrator.',
        );
      }
    }

    // ADR-0015 compat: the `organisationId` field was removed from User
    // documents by the memberships migration (tenant scope now lives on
    // Membership). Many service methods still read `actor.organisationId`
    // to scope tenant-bound queries; left undefined that produces a
    // "Malformed organisationId 'undefined'" 400. Backfill it on the
    // per-request user object from the resolved tenant so every module
    // gets the authoritative active organisationId without changing each
    // service signature. Safe because currentUser is a fresh per-request
    // object, never shared or persisted.
    (request.currentUser as unknown as { organisationId: string }).organisationId =
      request.organisationId;

    // ----- Resolve membership (K6) -----
    //
    // Try cache first. On cache miss, fetch from DB and cache the result.
    //
    // If JWT has a `mid` claim, validate that specific membership matches
    // the claimed org. This detects stale tokens after tenant switch.
    // If no `mid` (pre-K5 tokens or tokens issued before mid was wired),
    // fall back to the active membership for the org.

    const userId = payload.sub;
    const organisationId = request.organisationId;

    let membership = getFromCache(userId, organisationId);

    if (!membership) {
      membership = await membershipsRepo.findActive({ userId, organisationId });

      if (!membership) {
        // No active membership found. This user has either never been in
        // this tenant, has been removed, or the migration hasn't run yet.
        // Fall back gracefully: synthesize a minimal membership from the
        // JWT claims so pre-migration requests don't break.
        // This fallback is removed after the migration runner completes.
        membership = synthesizeMembership(payload, userDoc as unknown as WithId<User>);
      } else {
        setInCache(membership);
      }
    }

    // Validate `mid` claim if present — reject mismatched membership
    if (payload.mid && String(membership._id) !== payload.mid) {
      throw new UnauthorizedError('MEMBERSHIP_MISMATCH: token is for a different active tenant.');
    }

    if (membership.status === 'SUSPENDED') {
      throw new ForbiddenError(
        'MEMBERSHIP_SUSPENDED: Your membership in this organisation is suspended.',
      );
    }

    request.activeMembership = membership;

    // ADR-0015 / ADR-0029 compat (role): authoritative role lives on the
    // Membership. Service-layer RBAC helpers read `actor.role` (loans
    // roleSatisfies, cancelLoanRequest admin check). Backfill from the
    // resolved membership so every module sees the authoritative per-tenant
    // role. The legacy `User.roles` array is left untouched and unused for RBAC.
    (request.currentUser as unknown as { role: Membership['role'] }).role = membership.role;
  });

  // -------------------------------------------------------------------------
  // requireRole / requireMinRole — RBAC from activeMembership.role (ADR-0029)
  // -------------------------------------------------------------------------

  fastify.decorate('requireRole', (allowed: readonly UserRole[]) => {
    if (allowed.length === 0) {
      throw new Error('requireRole called with empty role list — would deny everyone.');
    }

    const allowedSet = new Set(allowed);

    const handler: preHandlerAsyncHookHandler = async (request) => {
      if (!request.activeMembership) {
        throw new Error('requireRole called without prior loadCurrentUser — fix preHandler chain.');
      }

      // Exact-role match (ADR-0029): membership has a single authoritative role.
      // Used where the EXACT role/type matters (e.g. EMPLOYEE vs EXTERNAL),
      // NOT hierarchical access — for hierarchy use requireMinRole.
      const userRole = request.activeMembership.role;
      if (!allowedSet.has(userRole)) {
        request.log.warn(
          {
            userId: String(request.currentUser._id),
            userRole,
            requiredRoles: Array.from(allowedSet),
            path: request.url,
          },
          'RBAC: insufficient role',
        );
        throw new ForbiddenError(`Action requires one of: ${Array.from(allowedSet).join(', ')}`);
      }
    };

    return handler;
  });

  fastify.decorate('requireMinRole', (required: UserRole) => {
    const handler: preHandlerAsyncHookHandler = async (request) => {
      if (!request.activeMembership) {
        throw new Error(
          'requireMinRole called without prior loadCurrentUser — fix preHandler chain.',
        );
      }

      // Hierarchical check (ADR-0029): ADMIN satisfies ASSET_MANAGER etc.
      const userRole = request.activeMembership.role;
      if (!roleSatisfies(userRole, required)) {
        request.log.warn(
          {
            userId: String(request.currentUser._id),
            userRole,
            requiredMinRole: required,
            path: request.url,
          },
          'RBAC: insufficient role level',
        );
        throw new ForbiddenError(`Action requires at least role: ${required}`);
      }
    };

    return handler;
  });
};

export default fp(authPlugin, {
  name: 'auth',
  dependencies: ['config', 'error-handler', 'inventario-jwt', 'mongo'],
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Synthesize a minimal Membership from JWT claims for users that exist
 * in the DB but haven't been migrated to the memberships collection yet
 * (pre-migration fallback, removed after migration runner completes).
 *
 * This allows the system to continue working during the K1-K9 transition
 * period without requiring every user to be migrated before any K6 code
 * runs in production.
 */
function synthesizeMembership(
  payload: InventarioJwtPayload,
  user: WithId<User>,
): WithId<Membership> {
  const now = new Date().toISOString();
  // Derive a single role (ADR-0029) from the token claims. New tokens carry
  // `role`; legacy tokens carry `roles[]` (pick the highest). Fall back to the
  // legacy User.roles array, then EMPLOYEE.
  const role = resolveTokenRole(payload, user);

  return {
    _id: new ObjectId() as unknown as Membership['_id'],
    userId: payload.sub,
    organisationId: payload.org,
    role,
    organizationalUnit: null,
    teams: [],
    status: 'ACTIVE',
    isDefault: true,
    invitedBy: 'SYSTEM',
    invitedAt: now,
    acceptedAt: now,
    mustChangePassword: false,
    lastAccessedAt: null,
    notifications: { email: true, push: false },
    createdAt: now,
    updatedAt: now,
    createdBy: 'SYSTEM',
    updatedBy: 'SYSTEM',
    deletedAt: null,
    deletedBy: null,
  } as unknown as WithId<Membership>;
}

/**
 * Resolve a single UserRole from JWT claims (ADR-0029).
 * Tolerates both the new `role` claim and the legacy `roles[]` claim so
 * tokens issued before the cutover keep working (no forced re-login).
 */
function resolveTokenRole(payload: InventarioJwtPayload, user: WithId<User>): UserRole {
  const single = (payload as unknown as { role?: unknown }).role;
  if (typeof single === 'string' && (USER_ROLE_VALUES as readonly string[]).includes(single)) {
    return single as UserRole;
  }
  const legacyClaim = (payload as unknown as { roles?: unknown }).roles;
  if (Array.isArray(legacyClaim) && legacyClaim.length > 0) {
    return highestRole(legacyClaim as UserRole[]);
  }
  const legacyUser = (user as unknown as { roles?: unknown }).roles;
  if (Array.isArray(legacyUser) && legacyUser.length > 0) {
    return highestRole(legacyUser as UserRole[]);
  }
  return UserRoleEnum.EMPLOYEE;
}
