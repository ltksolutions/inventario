// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Memberships routes — K15 (Slice #9d).
 *
 * GET    /v1/members                  — EMPLOYEE+; picker-safe zoznam členov org
 * GET    /v1/memberships/:id           — ADMIN alebo vlastná membership
 * PATCH  /v1/memberships/:id           — ADMIN only; roles/status/notifications
 * DELETE /v1/memberships/:id           — ADMIN only; soft-delete + cache invalidation
 * POST   /v1/memberships/:id/default   — self-service; nastavenie default org
 *
 * RBAC matrix:
 *   GET    — ADMIN alebo membership.userId === actor
 *   PATCH  — ADMIN only
 *   DELETE — ADMIN only (K16 doplní assertNotLastAdmin transakčnú ochranu)
 *   POST default — any authenticated; len vlastná membership (cross-org OK)
 *
 * Cache invalidation:
 *   Každý write path volá invalidateMembershipCache() z auth.ts
 *   aby rola zmena bola viditeľná do 1 requestu (nie až po 60s TTL).
 *
 * Audit events:
 *   MEMBERSHIP_ROLES_CHANGED, MEMBERSHIP_REMOVED — pridané v K18.
 *   Tu sú iba TODO komentáre na príslušných miestach.
 *
 * Dependency note:
 *   assertNotLastAdmin() bude extrahovaná v K16 a zapojená do
 *   DELETE endpoint-u. V K15 je inline fallback kontrola.
 */

import fp from 'fastify-plugin';
import { z } from 'zod';

import { invalidateMembershipCache } from '../../plugins/auth.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../plugins/error-handler.js';

import { MembershipsRepository } from './memberships.repository.js';
import { MembershipsService } from './memberships.service.js';

import type { UserRole } from '@inventario/shared-types';
import type { FastifyPluginAsync } from 'fastify';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const MembershipIdParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i),
});
void MembershipIdParamsSchema; // Referenced in future typed routes

/**
 * PATCH body — len per-tenant mutable polia.
 * roles, status, mustChangePassword, notifications.
 * organizationalUnit + teams sú vynechané (rezervované pre neskorší slice).
 */
const PatchMembershipBodySchema = z
  .object({
    role: z.enum(['EMPLOYEE', 'ASSET_MANAGER', 'ADMIN', 'EXTERNAL'] as [UserRole, ...UserRole[]]),
    status: z.enum(['ACTIVE', 'SUSPENDED']),
    mustChangePassword: z.boolean(),
    notifications: z.object({
      email: z.boolean(),
      push: z.boolean(),
    }),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Prázdny PATCH body — aspoň jedno pole musí byť uvedené.',
  });

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const membershipsRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const repo = new MembershipsRepository(fastify.mongo.db);
  const service = new MembershipsService(repo);
  await repo.ensureIndexes();

  // =========================================================================
  // GET /v1/members — picker-safe zoznam aktívnych členov org (EMPLOYEE+)
  // ADR-0025: beneficiary picker potrebuje zoznam dostupných používateľov.
  // Vracia len _id, displayName, firstName, lastName — bez citlivých polí.
  // =========================================================================

  fastify.get('/v1/members', async (request, reply) => {
    await fastify.requireAuth(request);
    await fastify.loadCurrentUser(request);
    await fastify.requireMinRole('EMPLOYEE' as UserRole).call(fastify, request, reply);

    const { ObjectId: ObjId } = await import('mongodb');
    const limit = Math.min(Number((request.query as Record<string, unknown>)['limit'] ?? 200), 500);
    const skip = Number((request.query as Record<string, unknown>)['skip'] ?? 0);

    // Nájdi aktívne memberships v tejto org, zoradené podľa userId
    const memberships = await fastify.mongo.db
      .collection('memberships')
      .find({ organisationId: request.organisationId, status: 'ACTIVE', deletedAt: null })
      .skip(skip)
      .limit(limit)
      .toArray();

    const total = await fastify.mongo.db.collection('memberships').countDocuments({
      organisationId: request.organisationId,
      status: 'ACTIVE',
      deletedAt: null,
    });

    // Batch lookup userov — len picker-safe polia
    const userIds = memberships
      .map((m) => m['userId'] as string)
      .filter((id) => /^[a-f0-9]{24}$/i.test(id));

    const users = userIds.length
      ? await fastify.mongo.db
          .collection('users')
          .find({ _id: { $in: userIds.map((id) => new ObjId(id)) } as never })
          .project({ _id: 1, displayName: 1, firstName: 1, lastName: 1, isActive: 1 })
          .toArray()
      : [];

    const userMap = new Map(users.map((u) => [String(u['_id']), u]));

    const data = memberships
      .map((m) => {
        const user = userMap.get(m['userId'] as string);
        if (!user) return null;
        return {
          _id: String(user['_id']),
          displayName:
            (user['displayName'] as string) || `${user['firstName']} ${user['lastName']}`.trim(),
          firstName: user['firstName'] as string,
          lastName: user['lastName'] as string,
          isActive: user['isActive'] as boolean,
          membershipId: String(m['_id']),
          role: m['role'],
        };
      })
      .filter(Boolean);

    return reply.send({
      data,
      pagination: { total, limit, skip, hasMore: skip + memberships.length < total },
    });
  });

  // =========================================================================
  // GET /v1/memberships — list členov org (ADMIN only, K19)
  // =========================================================================

  fastify.get('/v1/memberships', async (request, reply) => {
    await fastify.requireAuth(request);
    await fastify.loadCurrentUser(request);
    await fastify.requireMinRole('ADMIN' as UserRole).call(fastify, request, reply);

    const q = request.query as Record<string, unknown>;
    const limit = Math.min(Number(q['limit'] ?? 50), 200);
    const skip = Number(q['skip'] ?? 0);

    const { items, total } = await repo.listByOrganisation(request.organisationId, { limit, skip });

    // Obohatiť o user displayName + email (single batch lookup)
    const { ObjectId } = await import('mongodb');
    const userIds = items.map((m) => m.userId).filter((id) => /^[a-f0-9]{24}$/i.test(id));
    const usersRaw = userIds.length
      ? await fastify.mongo.db
          .collection('users')
          .find({ _id: { $in: userIds.map((id) => new ObjectId(id)) } as never })
          .project({ _id: 1, displayName: 1, email: 1 })
          .toArray()
      : [];
    const userMap = new Map(usersRaw.map((u) => [String(u['_id']), u]));

    return reply.send({
      data: items.map((m) => ({
        ...toPublic(m as unknown as Record<string, unknown>),
        userEmail: userMap.get(m.userId)?.['email'] ?? null,
        userDisplayName: userMap.get(m.userId)?.['displayName'] ?? null,
      })),
      pagination: { total, limit, skip, hasMore: skip + items.length < total },
    });
  });

  // =========================================================================
  // GET /v1/memberships/:id
  // =========================================================================

  fastify.get('/v1/memberships/:id', async (request, reply) => {
    await fastify.requireAuth(request);
    await fastify.loadCurrentUser(request);

    const { id } = request.params as { id: string };
    if (!id || !/^[a-f0-9]{24}$/i.test(id)) {
      throw new BadRequestError('Neplatný formát ID.');
    }

    const membership = await repo.findById(id);
    if (!membership || membership.organisationId !== request.organisationId) {
      throw new NotFoundError('Membership', id);
    }

    const actorId = String(request.currentUser._id);
    const isAdmin = request.activeMembership.role === ('ADMIN' as UserRole);
    const isSelf = membership.userId === actorId;

    if (!isAdmin && !isSelf) {
      throw new ForbiddenError(
        'Môžete zobraziť len vlastnú membership alebo vyžadujete rolu ADMIN.',
      );
    }

    return reply.send(toPublic(membership));
  });

  // =========================================================================
  // PATCH /v1/memberships/:id
  // =========================================================================

  fastify.patch('/v1/memberships/:id', async (request, reply) => {
    await fastify.requireAuth(request);
    await fastify.loadCurrentUser(request);
    await fastify.requireMinRole('ADMIN' as UserRole).call(fastify, request, reply);

    const { id } = request.params as { id: string };
    if (!id || !/^[a-f0-9]{24}$/i.test(id)) {
      throw new BadRequestError('Neplatný formát ID.');
    }

    const parsed = PatchMembershipBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Neplatný vstup.');
    }
    const patch = parsed.data;

    const existing = await repo.findById(id);
    if (!existing || existing.organisationId !== request.organisationId) {
      throw new NotFoundError('Membership', id);
    }

    const actorId = String(request.currentUser._id);

    // K16: assertNotLastAdmin — ak sa mení role a cieľový user je ADMIN,
    // skontroluje, že v org zostane aspoň jeden iný ADMIN.
    if (patch.role !== undefined && patch.role !== ('ADMIN' as UserRole)) {
      await service.assertNotLastAdmin(request.organisationId, existing.userId, existing.role);
    }

    const now = new Date().toISOString();
    const updated = await repo.update(id, {
      ...patch,
      updatedAt: now,
      updatedBy: actorId,
    });

    if (!updated) throw new NotFoundError('Membership', id);

    // Invalidate auth cache — rola/status sa mohla zmeniť
    invalidateMembershipCache(existing.userId, request.organisationId);

    // K18: MEMBERSHIP_ROLES_CHANGED audit event
    await fastify.mongo.db.collection('audit_logs').insertOne({
      action: 'MEMBERSHIP_ROLES_CHANGED',
      severity: 'INFO',
      actor: { userId: actorId, email: request.currentUser.email },
      target: { entityType: 'Membership', entityId: id },
      organisationId: request.organisationId,
      metadata: {
        targetUserId: existing.userId,
        membershipId: id,
        changedFields: Object.keys(patch),
        roleAfter: patch.role ?? existing.role,
      },
      createdAt: now,
    });

    fastify.log.info(
      { membershipId: id, actorId, patch: Object.keys(patch) },
      'Membership updated',
    );

    return reply.send(toPublic(updated));
  });

  // =========================================================================
  // DELETE /v1/memberships/:id
  // =========================================================================

  fastify.delete('/v1/memberships/:id', async (request, reply) => {
    await fastify.requireAuth(request);
    await fastify.loadCurrentUser(request);

    const { id } = request.params as { id: string };
    if (!id || !/^[a-f0-9]{24}$/i.test(id)) {
      throw new BadRequestError('Neplatný formát ID.');
    }

    const existing = await repo.findById(id);
    if (!existing || existing.organisationId !== request.organisationId) {
      throw new NotFoundError('Membership', id);
    }

    const actorId = String(request.currentUser._id);
    const isAdmin = request.activeMembership.role === ('ADMIN' as UserRole);
    const isSelf = existing.userId === actorId;

    // RBAC: ADMIN môže odstraňovať kohokovek; user môže len seba samého (opustenie org)
    if (!isAdmin && !isSelf) {
      throw new ForbiddenError(
        'Môžete odstrániť len vlastnú membership alebo vyžadujete rolu ADMIN.',
      );
    }

    // K16: assertNotLastAdmin — chráni pred odstránením posledného ADMINa
    await service.assertNotLastAdmin(request.organisationId, existing.userId, existing.role);

    const now = new Date().toISOString();
    const deleted = await repo.softDelete(id, {
      deletedAt: now,
      deletedBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
    });

    if (!deleted) throw new NotFoundError('Membership', id);

    // Invalidate auth cache
    invalidateMembershipCache(existing.userId, request.organisationId);

    // K18: MEMBERSHIP_REMOVED audit event
    await fastify.mongo.db.collection('audit_logs').insertOne({
      action: 'MEMBERSHIP_REMOVED',
      severity: 'WARNING',
      actor: { userId: actorId, email: request.currentUser.email },
      target: { entityType: 'Membership', entityId: id },
      organisationId: request.organisationId,
      metadata: {
        targetUserId: existing.userId,
        membershipId: id,
        roleAtDeletion: existing.role,
      },
      createdAt: now,
    });

    fastify.log.info(
      { membershipId: id, targetUserId: existing.userId, actorId },
      'Membership soft-deleted',
    );

    return reply.code(204).send();
  });

  // =========================================================================
  // POST /v1/memberships/:id/default — self-service default org
  // =========================================================================

  fastify.post('/v1/memberships/:id/default', async (request, reply) => {
    await fastify.requireAuth(request);
    await fastify.loadCurrentUser(request);

    const { id } = request.params as { id: string };
    if (!id || !/^[a-f0-9]{24}$/i.test(id)) {
      throw new BadRequestError('Neplatný formát ID.');
    }

    const actorId = String(request.currentUser._id);

    // Načítame membership bez org-scope (isDefault je cross-org operácia)
    const membership = await repo.findById(id);
    if (!membership || membership.deletedAt !== null) {
      throw new NotFoundError('Membership', id);
    }

    // Len vlastná membership — nie je povolené meniť default iného používateľa
    if (membership.userId !== actorId) {
      throw new ForbiddenError('Môžete nastaviť ako default len vlastnú membership.');
    }

    // Membership musí byť ACTIVE — SUSPENDED membership nemôže byť default
    if (membership.status !== 'ACTIVE') {
      throw new BadRequestError(
        'MEMBERSHIP_SUSPENDED: Suspended membership nemôže byť nastavená ako default.',
      );
    }

    const session = fastify.mongo.client.startSession();
    try {
      await session.withTransaction(async () => {
        const now = new Date().toISOString();
        const ok = await repo.setDefault(id, actorId, now, session);
        if (!ok) throw new NotFoundError('Membership', id);
      });
    } finally {
      await session.endSession();
    }

    // TODO K18: USER_SWITCHED_ORGANISATION emitovaný v auth-session.routes.ts (K7)
    // Pre post/:id/default nie je potrebný špeciálny audit event.

    fastify.log.info(
      { membershipId: id, actorId, organisationId: membership.organisationId },
      'Default membership updated',
    );

    return reply.code(204).send();
  });
};

export default fp(membershipsRoutesPlugin, {
  name: 'memberships-routes',
  dependencies: ['config', 'mongo', 'auth'],
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Konvertuje MongoDB membership dokument na verejné API telo.
 * Vynecháva interné polia (deletedAt, deletedBy, invitedBy, ...).
 */
function toPublic(membership: Record<string, unknown>): Record<string, unknown> {
  return {
    _id: String(membership['_id']),
    userId: membership['userId'],
    organisationId: membership['organisationId'],
    role: membership['role'],
    organizationalUnit: membership['organizationalUnit'] ?? null,
    teams: membership['teams'] ?? [],
    status: membership['status'],
    isDefault: membership['isDefault'],
    mustChangePassword: membership['mustChangePassword'] ?? false,
    lastAccessedAt: membership['lastAccessedAt'] ?? null,
    notifications: membership['notifications'] ?? { email: true, push: false },
    acceptedAt: membership['acceptedAt'] ?? null,
    createdAt: membership['createdAt'],
    updatedAt: membership['updatedAt'],
  };
}
