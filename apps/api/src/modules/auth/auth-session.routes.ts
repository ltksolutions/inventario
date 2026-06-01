// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Auth session routes — ADR-0015 K7 + K8.
 *
 * K7: POST /v1/auth/switch-organisation
 *   Allows a user to switch their active tenant. Issues new JWT cookies
 *   with updated `org`, `mid`, and `roles` from the target membership.
 *   Rate-limited to prevent JWT issuance spam.
 *
 * K8: GET /v1/auth/me (extended)
 *   Returns the current user's global identity + active membership context
 *   + list of all available organisations (for tenant switcher UI).
 *   Replaces the minimal /v1/auth/me in registration.routes.ts.
 *
 * Audit events:
 *   USER_SWITCHED_ORGANISATION — emitted on successful switch
 */

import fp from 'fastify-plugin';
import { ObjectId } from 'mongodb';
import { z } from 'zod';

import { ForbiddenError, NotFoundError } from '../../plugins/error-handler.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { MembershipsService } from '../memberships/memberships.service.js';

import { setAuthCookies } from './cookie-helpers.js';

import type { Organisation } from '@inventario/shared-types';
import type { FastifyPluginAsync } from 'fastify';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const SwitchOrganisationBodySchema = z.object({
  organisationId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid organisationId format'),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const IS_TEST = process.env['NODE_ENV'] === 'test';

const authSessionRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const membershipsRepo = new MembershipsRepository(fastify.mongo.db);
  const membershipsService = new MembershipsService(membershipsRepo);
  const { JWT_ACCESS_TOKEN_TTL_SECONDS, JWT_REFRESH_TOKEN_TTL_DAYS } = fastify.config;

  // -------------------------------------------------------------------------
  // POST /v1/auth/switch-organisation (K7)
  // -------------------------------------------------------------------------

  fastify.post(
    '/v1/auth/switch-organisation',
    {
      ...(IS_TEST ? {} : { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }),
    },
    async (request, reply) => {
      await fastify.requireAuth(request);
      await fastify.loadCurrentUser(request);

      const parsed = SwitchOrganisationBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ForbiddenError(parsed.error.issues[0]?.message ?? 'Invalid input');
      }
      const { organisationId: targetOrgId } = parsed.data;

      const userId = String(request.currentUser._id);

      // Validate that the user has an active membership in the target org
      const targetMembership = await membershipsRepo.findActive({
        userId,
        organisationId: targetOrgId,
      });

      if (!targetMembership) {
        throw new ForbiddenError(
          'NOT_A_MEMBER: You do not have an active membership in this organisation.',
        );
      }

      // Load target org
      const targetOrg = (await fastify.mongo.db.collection<Organisation>('organisations').findOne({
        _id: new ObjectId(targetOrgId) as never,
        deletedAt: null,
      })) as never;

      if (!targetOrg) throw new NotFoundError('Organisation', targetOrgId);

      // Update lastAccessedAt on the target membership
      const now = new Date().toISOString();
      await membershipsRepo.update(String(targetMembership._id), {
        lastAccessedAt: now,
        updatedAt: now,
        updatedBy: userId,
      });

      // Issue new JWT with updated org + mid + roles
      const newAccessToken = await fastify.inventarioJwt.issueAccessToken(
        request.currentUser,
        targetOrg,
        String(targetMembership._id),
        targetMembership.roles,
      );
      const newRefreshToken = await fastify.inventarioJwt.issueRefreshToken(userId, request);

      setAuthCookies(
        reply,
        newAccessToken,
        newRefreshToken,
        JWT_ACCESS_TOKEN_TTL_SECONDS,
        JWT_REFRESH_TOKEN_TTL_DAYS,
      );

      // Audit
      await fastify.mongo.db.collection('audit_logs').insertOne({
        action: 'USER_SWITCHED_ORGANISATION',
        severity: 'INFO',
        actor: { userId, email: request.currentUser.email },
        target: { entityType: 'Organisation', entityId: targetOrgId },
        organisationId: targetOrgId,
        metadata: {
          fromOrganisationId: request.organisationId,
          toOrganisationId: targetOrgId,
          membershipId: String(targetMembership._id),
        },
        createdAt: now,
      });

      fastify.log.info(
        { userId, fromOrg: request.organisationId, toOrg: targetOrgId },
        'User switched organisation',
      );

      return reply.code(204).send();
    },
  );

  // -------------------------------------------------------------------------
  // GET /v1/auth/me (K8 — extended)
  // -------------------------------------------------------------------------

  fastify.get('/v1/auth/me', async (request, reply) => {
    const token = request.cookies?.['inv_access'];
    fastify.log.info(
      { hasToken: Boolean(token), tokenPrefix: token?.slice(0, 20) },
      'GET /me cookie check',
    );
    if (!token) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    let payload;
    try {
      payload = await fastify.inventarioJwt.verifyAccessToken(token);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      fastify.log.warn({ errMsg: msg }, 'GET /me token verification failed');
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    // Load user
    const userDoc = await fastify.mongo.db
      .collection('users')
      .findOne({ _id: new ObjectId(payload.sub), deletedAt: null });

    if (!userDoc) return reply.code(401).send({ error: 'User not found.' });

    // Load active membership (for current org)
    const activeMembership = await membershipsRepo.findActive({
      userId: payload.sub,
      organisationId: payload.org,
    });

    // Load all memberships for this user (for tenant switcher)
    const allMemberships = await membershipsRepo.findByUser(payload.sub);

    // Load org names for each membership (batch)
    const orgIds = [...new Set(allMemberships.map((m) => m.organisationId))];
    const orgs =
      orgIds.length > 0
        ? await fastify.mongo.db
            .collection<Organisation>('organisations')
            .find({
              _id: { $in: orgIds.map((id) => new ObjectId(id)) } as never,
              deletedAt: null,
            })
            .project({ displayName: 1, slug: 1, brandKit: 1 })
            .toArray()
        : [];

    const orgMap = new Map(orgs.map((o) => [String(o['_id']), o]));

    const availableOrganisations = allMemberships
      .filter((m) => m.status === 'ACTIVE')
      .map((m) => {
        const org = orgMap.get(m.organisationId);
        return {
          organisationId: m.organisationId,
          organisationName: org?.['displayName'] ?? 'Unknown',
          slug: org?.['slug'] ?? '',
          brandKit: org?.['brandKit'] ?? null,
          roles: m.roles,
          isDefault: m.isDefault,
          lastAccessedAt: m.lastAccessedAt,
          membershipId: String(m._id),
        };
      });

    return reply.send({
      user: {
        _id: String(userDoc['_id']),
        email: userDoc['email'],
        firstName: userDoc['firstName'],
        lastName: userDoc['lastName'],
        displayName: userDoc['displayName'],
        accountType: userDoc['accountType'],
        isActive: userDoc['isActive'],
        lastLoginAt: userDoc['lastLoginAt'],
        preferences: userDoc['preferences'],
        mfaEnabled: userDoc['mfaEnabled'],
      },
      activeMembership: activeMembership
        ? {
            membershipId: String(activeMembership._id),
            organisationId: activeMembership.organisationId,
            roles: activeMembership.roles,
            status: activeMembership.status,
            isDefault: activeMembership.isDefault,
          }
        : null,
      availableOrganisations,
    });
  });
  // -------------------------------------------------------------------------
  // DELETE /v1/auth/me — GDPR right-to-erasure (K17)
  // -------------------------------------------------------------------------

  fastify.delete('/v1/auth/me', async (request, reply) => {
    await fastify.requireAuth(request);
    await fastify.loadCurrentUser(request);

    const userId = String(request.currentUser._id);

    // Zoznam všetkých aktívnych memberships (cross-org)
    const allMemberships = await membershipsRepo.findByUser(userId);
    const activeOrgs = allMemberships
      .filter((m) => m.status === 'ACTIVE' && m.deletedAt === null)
      .map((m) => m.organisationId);

    // K16: per-org LAST_ADMIN check — user nemôže odísť ak je posledný ADMIN
    // v niektorom tente. Beží mimo transakcie (read-only kontrola pred write-om).
    for (const orgId of activeOrgs) {
      await membershipsService.assertNotLastAdminForDeletion(orgId, userId);
    }

    const now = new Date().toISOString();

    // Transakcne: soft-delete všetkých memberships + pseudonymizácia User
    const session = fastify.mongo.client.startSession();
    try {
      await session.withTransaction(async () => {
        // 1. Soft-delete všetkých memberships
        await membershipsRepo.softDeleteAllForUser(
          userId,
          { deletedAt: now, deletedBy: userId, updatedAt: now, updatedBy: userId },
          session,
        );

        // 2. Pseudonymizácia User — zachováme _id pre audit trail
        const pseudoEmail = `deleted-${userId}@deleted.inventario`;
        await fastify.mongo.db.collection('users').updateOne(
          { _id: new ObjectId(userId) as never },
          {
            $set: {
              email: pseudoEmail,
              firstName: 'Deleted',
              lastName: 'User',
              displayName: 'Deleted User',
              passwordHash: null,
              isActive: false,
              authProviders: [],
              entraOid: null,
              emailVerified: false,
              emailVerificationToken: null,
              passwordResetToken: null,
              mfaSecret: null,
              mfaRecoveryCodes: [],
              deletedAt: now,
              deletedBy: userId,
              updatedAt: now,
              updatedBy: userId,
            },
          },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    // Audit — cez AuditLogService pre konzistentný tvar (legalBasis,
    // dataCategories, plný actor snapshot). DATA_DELETION_REQUESTED =
    // legal_obligation per GDPR čl. 17.
    await fastify.auditLog.record(request.currentUser, request, {
      action: 'DATA_DELETION_REQUESTED',
      target: {
        entityType: 'User',
        entityId: userId,
        snapshot: {
          email: request.currentUser.email,
          displayName: request.currentUser.displayName,
        },
      },
      description: `User "${request.currentUser.displayName}" requested account erasure (GDPR čl. 17)`,
      severity: 'WARNING',
      metadata: {
        deletedMemberships: allMemberships.length,
        orgs: activeOrgs,
      },
    });

    // Zmazanie JWT cookies
    reply
      .clearCookie('inv_access', { path: '/' })
      .clearCookie('inv_refresh', { path: '/v1/auth/refresh' });

    fastify.log.info({ userId, orgs: activeOrgs.length }, 'User account deleted (GDPR erasure)');

    return reply.code(204).send();
  });
};

export default fp(authSessionRoutesPlugin, {
  name: 'auth-session-routes',
  dependencies: ['config', 'mongo', 'inventario-jwt', 'auth', 'audit'],
});
