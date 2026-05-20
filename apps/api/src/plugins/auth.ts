// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Auth plugin — Inventario JWT cookie verification (Slice #6c K17).
 *
 * After the Entra/MSAL cutover, authentication is entirely cookie-based.
 * The `inv_access` httpOnly cookie carries a signed RS256 Inventario JWT
 * (issued by `inventario-jwt.ts`). No Bearer tokens, no MSAL, no JWKS.
 *
 * Provides three decorators:
 *
 *   app.requireAuth        — verifies the inv_access cookie
 *   app.loadCurrentUser    — loads user + org from MongoDB by JWT claims
 *   app.requireRole([...]) — enforces RBAC on request.currentUser
 *
 * loadCurrentUser path:
 *   1. Reads `sub` (user _id) + `org` (org _id) from the verified JWT
 *   2. Fetches both documents from MongoDB
 *   3. Rejects deactivated users and non-ACTIVE tenants
 *   No JIT provisioning — cookie auth only works for existing users.
 *   New-user onboarding goes through registration / OAuth callback flows.
 */

import fp from 'fastify-plugin';
import { ObjectId } from 'mongodb';

import { ForbiddenError, UnauthorizedError } from './error-handler.js';

import type { InventarioJwtPayload } from './inventario-jwt.js';
import type { Organisation, User, UserRole } from '@inventario/shared-types';
import type { FastifyPluginAsync, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Fastify request / instance decoration
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Verified Inventario JWT claims for the current request.
     * Populated by `requireAuth`. Only present on protected routes.
     */
    inventarioClaims?: InventarioJwtPayload;

    /** Resolved tenant Organisation document. Populated by `loadCurrentUser`. */
    organisation: WithId<Organisation>;

    /** Convenience accessor: `organisation._id` as a hex string. */
    organisationId: string;

    /**
     * Current user document. Populated by `loadCurrentUser`.
     * Roles here are authoritative — JWT roles are informational only.
     */
    currentUser: WithId<User>;
  }

  interface FastifyInstance {
    /**
     * Pre-handler that verifies the `inv_access` httpOnly cookie.
     * Throws 401 on missing or invalid/expired token.
     */
    requireAuth: (request: FastifyRequest) => Promise<void>;

    /**
     * Pre-handler that loads `request.currentUser` and
     * `request.organisation` from MongoDB using JWT claims.
     * Must run after `requireAuth`.
     */
    loadCurrentUser: (request: FastifyRequest) => Promise<void>;

    /**
     * Factory: returns a pre-handler that enforces the given roles
     * (OR semantics). Must run after `loadCurrentUser`.
     */
    requireRole: (allowed: readonly UserRole[]) => preHandlerAsyncHookHandler;
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const authPlugin: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // requireAuth
  // -------------------------------------------------------------------------

  fastify.decorate('requireAuth', async (request: FastifyRequest) => {
    const invCookie = request.cookies?.['inv_access'];
    if (!invCookie) {
      throw new UnauthorizedError('Not authenticated');
    }

    // verifyAccessToken throws UnauthorizedError on invalid / expired token.
    const claims = await fastify.inventarioJwt.verifyAccessToken(invCookie);
    request.inventarioClaims = claims;
    request.log.debug({ sub: claims.sub, org: claims.org }, 'Inventario JWT verified');
  });

  // -------------------------------------------------------------------------
  // loadCurrentUser
  // -------------------------------------------------------------------------

  fastify.decorate('loadCurrentUser', async (request: FastifyRequest) => {
    if (!request.inventarioClaims) {
      throw new Error(
        'loadCurrentUser called without prior requireAuth — fix the preHandler chain.',
      );
    }

    const payload = request.inventarioClaims;

    // ----- Resolve tenant -----
    const orgDoc = await fastify.mongo.db
      .collection('organisations')
      .findOne({ _id: new ObjectId(payload.org), deletedAt: null });

    if (!orgDoc) throw new UnauthorizedError('Tenant unavailable.');
    const orgStatus = orgDoc['status'] as string;
    if (orgStatus !== 'ACTIVE')
      throw new UnauthorizedError(`Tenant is ${orgStatus.toLowerCase()}.`);

    request.organisation = orgDoc as unknown as WithId<Organisation>;
    request.organisationId = String(orgDoc._id);

    // ----- Resolve user -----
    const userDoc = await fastify.mongo.db
      .collection('users')
      .findOne({ _id: new ObjectId(payload.sub), deletedAt: null });

    if (!userDoc) throw new UnauthorizedError('User not found.');
    if (!(userDoc['isActive'] as boolean))
      throw new UnauthorizedError('User account is deactivated');

    request.currentUser = userDoc as unknown as WithId<User>;
    request.log.debug(
      { userId: payload.sub, roles: payload.roles, organisationId: request.organisationId },
      'Current user + tenant loaded',
    );
  });

  // -------------------------------------------------------------------------
  // requireRole
  // -------------------------------------------------------------------------

  fastify.decorate('requireRole', (allowed: readonly UserRole[]) => {
    if (allowed.length === 0) {
      throw new Error('requireRole called with empty role list — would deny everyone.');
    }

    const allowedSet = new Set(allowed);

    const handler: preHandlerAsyncHookHandler = async (request) => {
      if (!request.currentUser) {
        throw new Error(
          'requireRole called without prior loadCurrentUser — fix the preHandler chain.',
        );
      }

      const userRoles = request.currentUser.roles;
      const hasAnyAllowedRole = userRoles.some((role) => allowedSet.has(role));

      if (!hasAnyAllowedRole) {
        request.log.warn(
          {
            userId: String(request.currentUser._id),
            userRoles,
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
};

export default fp(authPlugin, {
  name: 'auth',
  dependencies: ['config', 'error-handler', 'inventario-jwt'],
});
