// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Invitations routes — Slice #6c K18.
 *
 * Tenant-side (authenticated, ADMIN or ASSET_MANAGER):
 *   POST   /v1/invitations          — create + send invite email
 *   GET    /v1/invitations          — list pending invitations
 *   DELETE /v1/invitations/:id      — revoke pending invite
 *
 * Accept-side (public, no auth):
 *   GET    /v1/auth/invitations/:token   — preview invite metadata
 *   POST   /v1/auth/accept-invitation   — accept with password
 */

import { randomBytes } from 'node:crypto';

import { AccountType, AuthProvider, UserRole } from '@inventario/shared-types';
import argon2 from 'argon2';
import fp from 'fastify-plugin';
import { z } from 'zod';

import { BadRequestError, NotFoundError } from '../../plugins/error-handler.js';
import { setAuthCookies } from '../auth/cookie-helpers.js';

import { InvitationsRepository } from './invitations.repository.js';

import type { Organisation, User } from '@inventario/shared-types';
import type { FastifyPluginAsync } from 'fastify';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INVITE_TTL_DAYS = 7;
const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

const IS_TEST = process.env['NODE_ENV'] === 'test';

// Human-readable Slovak role labels for the invite email.
const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.ADMIN]: 'Administrátor',
  [UserRole.ASSET_MANAGER]: 'Správca majetku',
  [UserRole.TEAM_MANAGER]: 'Vedúci tímu',
  [UserRole.EMPLOYEE]: 'Zamestnanec',
  [UserRole.EXTERNAL]: 'Externý používateľ',
};

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const CreateInvitationSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  roles: z.array(z.nativeEnum(UserRole)).min(1),
  firstName: z.string().min(1).max(100).trim().optional(),
  lastName: z.string().min(1).max(100).trim().optional(),
});

const AcceptInvitationSchema = z.object({
  token: z.string().length(64),
  password: z.string().min(12).max(128),
  firstName: z.string().min(1).max(100).trim(),
  lastName: z.string().min(1).max(100).trim(),
});

const ListInvitationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  q: z.string().min(1).max(100).optional(),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const invitationsRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const repo = new InvitationsRepository(fastify.mongo.db);
  const { OAUTH_REDIRECT_BASE_URL, JWT_ACCESS_TOKEN_TTL_SECONDS, JWT_REFRESH_TOKEN_TTL_DAYS } =
    fastify.config;

  const frontendUrl = OAUTH_REDIRECT_BASE_URL
    ? OAUTH_REDIRECT_BASE_URL.replace('/v1/auth/callback', '').replace('/api', '')
    : 'http://localhost:3001';

  // -------------------------------------------------------------------------
  // POST /v1/invitations — create + send invite
  // -------------------------------------------------------------------------
  fastify.post(
    '/v1/invitations',
    { ...(IS_TEST ? {} : { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }) },
    async (request, reply) => {
      await fastify.requireAuth(request);
      await fastify.loadCurrentUser(request);
      await fastify
        .requireRole([UserRole.ADMIN, UserRole.ASSET_MANAGER])
        .call(fastify, request, reply);

      const parsed = CreateInvitationSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid input');
      }
      const { email, roles, firstName, lastName } = parsed.data;
      const inviter = request.currentUser;
      const org = request.organisation;

      // --- Role privilege check: ASSET_MANAGER cannot grant ADMIN --------
      if (!inviter.roles.includes(UserRole.ADMIN) && roles.includes(UserRole.ADMIN)) {
        throw new BadRequestError('Only ADMIN can invite another ADMIN.');
      }

      // --- Domain policy check -------------------------------------------
      const orgSettings = (org.settings ?? {}) as {
        invitations?: { enforceAllowedDomains?: boolean };
      };
      if (orgSettings.invitations?.enforceAllowedDomains) {
        const domain = email.split('@')[1] ?? '';
        const allowed: string[] = org.autoJoinDomains ?? [];
        if (!allowed.includes(domain)) {
          throw new BadRequestError(
            `Email domain '@${domain}' is not allowed for this organisation. ` +
              `Allowed domains: ${allowed.map((d) => `@${d}`).join(', ')}`,
          );
        }
      }

      // --- Uniqueness check (any tenant, any state) -----------------------
      const alreadyExists = await repo.emailExists(email);
      if (alreadyExists) {
        throw new BadRequestError(
          `A user with email '${email}' already exists. ` +
            `If they are in another organisation, cross-tenant invitations are not yet supported.`,
        );
      }

      // --- Create pending User document -----------------------------------
      const token = randomBytes(32).toString('hex'); // 64-char hex
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
      const inviterId = inviter._id.toString();

      const pendingUser: Omit<User, '_id'> = {
        organisationId: org._id.toString(),
        email,
        firstName: firstName ?? '',
        lastName: lastName ?? '',
        displayName: firstName && lastName ? `${firstName} ${lastName}` : email,
        accountType: AccountType.LOCAL,
        entraOid: null,
        authProviders: [],
        emailVerified: false,
        emailVerificationToken: token,
        emailVerificationExpiresAt: expiresAt,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
        passwordHash: null,
        roles,
        organizationalUnit: null,
        teams: [],
        isActive: true,
        lastLoginAt: null,
        invitationSentAt: now,
        mustChangePassword: false,
        preferences: {
          language: 'sk',
          timezone: 'Europe/Bratislava',
          emailNotifications: true,
          pushNotifications: false,
        },
        createdAt: now,
        updatedAt: now,
        createdBy: inviterId,
        updatedBy: inviterId,
        deletedAt: null,
        deletedBy: null,
      };

      const insertedId = await repo.insertInvite(pendingUser);

      // --- Audit log -------------------------------------------------------
      const auditCol = fastify.mongo.db.collection('audit_logs');
      await auditCol.insertOne({
        action: 'USER_INVITED',
        severity: 'INFO',
        actor: { userId: inviterId, email: inviter.email },
        target: { entityType: 'User', entityId: insertedId },
        organisationId: org._id.toString(),
        metadata: { invitedEmail: email, roles, invitedBy: inviterId },
        createdAt: now,
      });

      // --- Send invitation email -------------------------------------------
      const roleLabels = roles.map((r) => ROLE_LABELS[r] ?? r).join(', ');
      try {
        await fastify.emailService.sendInvitationEmail(email, {
          inviterName: inviter.displayName,
          tenantName: org.displayName,
          roleLabels,
          token,
          frontendUrl,
        });
      } catch (err) {
        fastify.log.error({ err, to: email }, 'Invitation email failed to send');
        // Non-fatal: invitation is created, user can resend manually later.
      }

      fastify.log.info({ invitedEmail: email, invitedBy: inviterId, roles }, 'User invited');

      return reply.code(201).send({
        _id: insertedId,
        email,
        roles,
        invitedBy: inviterId,
        invitedAt: now,
        expiresAt,
      });
    },
  );

  // -------------------------------------------------------------------------
  // GET /v1/invitations — list pending
  // -------------------------------------------------------------------------
  fastify.get('/v1/invitations', async (request, reply) => {
    await fastify.requireAuth(request);
    await fastify.loadCurrentUser(request);
    await fastify
      .requireRole([UserRole.ADMIN, UserRole.ASSET_MANAGER])
      .call(fastify, request, reply);

    const parsed = ListInvitationsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid query');
    }
    const { limit, skip, q } = parsed.data;
    const org = request.organisation;

    const { items, total } = await repo.list({
      organisationId: org._id.toString(),
      limit,
      skip,
      ...(q !== undefined ? { q } : {}),
    });

    return reply.send({
      data: items.map((u) => repo.toPublic(u)),
      pagination: {
        total,
        limit,
        skip,
        hasMore: skip + items.length < total,
      },
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /v1/invitations/:id — revoke
  // -------------------------------------------------------------------------
  fastify.delete('/v1/invitations/:id', async (request, reply) => {
    await fastify.requireAuth(request);
    await fastify.loadCurrentUser(request);
    await fastify
      .requireRole([UserRole.ADMIN, UserRole.ASSET_MANAGER])
      .call(fastify, request, reply);

    const { id } = request.params as { id: string };
    if (!id || !/^[a-f0-9]{24}$/.test(id)) {
      throw new BadRequestError('Invalid invitation id');
    }

    const org = request.organisation;
    const inviter = request.currentUser;

    // Confirm it exists and is still pending
    const existing = await repo.findById(org._id.toString(), id);
    if (!existing) {
      throw new NotFoundError('Invitation not found or already accepted');
    }

    const revoked = await repo.revoke(org._id.toString(), id);
    if (!revoked) {
      throw new NotFoundError('Invitation not found or already accepted');
    }

    const now = new Date().toISOString();
    await fastify.mongo.db.collection('audit_logs').insertOne({
      action: 'USER_INVITATION_REVOKED',
      severity: 'WARNING',
      actor: { userId: inviter._id.toString(), email: inviter.email },
      target: { entityType: 'User', entityId: id },
      organisationId: org._id.toString(),
      metadata: { revokedEmail: existing.email },
      createdAt: now,
    });

    fastify.log.info(
      { revokedId: id, revokedEmail: existing.email, by: inviter._id.toString() },
      'Invitation revoked',
    );

    return reply.code(204).send();
  });

  // -------------------------------------------------------------------------
  // GET /v1/auth/invitations/:token — public preview
  // -------------------------------------------------------------------------
  fastify.get('/v1/auth/invitations/:token', async (request, reply) => {
    const { token } = request.params as { token: string };

    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      return reply.code(410).send({ error: 'Invitation not found or expired' });
    }

    const user = await repo.findByToken(token);

    if (!user) {
      return reply.code(410).send({ error: 'Invitation not found or expired' });
    }

    if (new Date(user.emailVerificationExpiresAt ?? 0) < new Date()) {
      return reply.code(410).send({ error: 'Invitation not found or expired' });
    }

    // Load org + inviter for preview
    const [org, inviterDoc] = await Promise.all([
      fastify.mongo.db
        .collection<Organisation>('organisations')
        .findOne({ _id: { $exists: true }, deletedAt: null } as never),
      fastify.mongo.db.collection<User>('users').findOne(
        {
          _id: { $exists: true },
          organisationId: user.organisationId,
          deletedAt: null,
        } as never,
        { projection: { displayName: 1 } },
      ),
    ]);

    // Load correct org
    const { ObjectId } = await import('mongodb');
    const correctOrg = await fastify.mongo.db
      .collection<Organisation>('organisations')
      .findOne(
        { _id: new ObjectId(user.organisationId) as never, deletedAt: null },
        { projection: { displayName: 1, slug: 1, brandKit: 1 } },
      );

    const correctInviter = ObjectId.isValid(user.createdBy)
      ? await fastify.mongo.db
          .collection<User>('users')
          .findOne(
            { _id: new ObjectId(user.createdBy) as never },
            { projection: { displayName: 1 } },
          )
      : null;

    void org;
    void inviterDoc;

    return reply.send({
      email: user.email,
      roles: user.roles,
      firstName: user.firstName || null,
      lastName: user.lastName || null,
      organisation: {
        displayName: correctOrg?.displayName ?? 'Inventario',
        slug: correctOrg?.slug ?? '',
        brandKit: correctOrg?.brandKit ?? null,
      },
      inviter: {
        displayName: correctInviter?.displayName ?? 'Inventario',
      },
      expiresAt: user.emailVerificationExpiresAt,
    });
  });

  // -------------------------------------------------------------------------
  // POST /v1/auth/accept-invitation — accept with password
  // -------------------------------------------------------------------------
  fastify.post('/v1/auth/accept-invitation', async (request, reply) => {
    const parsed = AcceptInvitationSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { token, password, firstName, lastName } = parsed.data;

    const user = await repo.findByToken(token);
    if (!user) {
      throw new BadRequestError('Invitation is invalid or has already been used.');
    }
    if (new Date(user.emailVerificationExpiresAt ?? 0) < new Date()) {
      throw new BadRequestError(
        'Invitation has expired. Ask your administrator to send a new one.',
      );
    }

    // Hash password
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 4,
    });

    const now = new Date().toISOString();
    const displayName = `${firstName} ${lastName}`.trim();

    // Update User: activate the account
    const { ObjectId } = await import('mongodb');
    await fastify.mongo.db.collection<User>('users').updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash,
          emailVerified: true,
          emailVerificationToken: null,
          emailVerificationExpiresAt: null,
          firstName,
          lastName,
          displayName,
          accountType: AccountType.LOCAL,
          authProviders: [
            {
              provider: AuthProvider.EMAIL,
              providerId: user.email,
              email: user.email,
              linkedAt: now,
            },
          ],
          lastLoginAt: now,
          updatedAt: now,
          updatedBy: user._id.toString(),
        } as Partial<User>,
      },
    );

    // Load org for JWT payload
    const org = await fastify.mongo.db
      .collection<Organisation>('organisations')
      .findOne({ _id: new ObjectId(user.organisationId) as never });

    if (!org) {
      throw new BadRequestError('Organisation not found.');
    }

    // Issue JWT cookies
    const updatedUser = { ...user, firstName, lastName, displayName, emailVerified: true };
    const accessToken = await fastify.inventarioJwt.issueAccessToken(
      updatedUser as unknown as typeof user,
      org as never,
    );
    const refreshToken = await fastify.inventarioJwt.issueRefreshToken(
      user._id.toString(),
      request,
    );

    setAuthCookies(
      reply,
      accessToken,
      refreshToken,
      JWT_ACCESS_TOKEN_TTL_SECONDS,
      JWT_REFRESH_TOKEN_TTL_DAYS,
    );

    // Audit
    await fastify.mongo.db.collection('audit_logs').insertOne({
      action: 'USER_INVITATION_ACCEPTED',
      severity: 'INFO',
      actor: { userId: user._id.toString(), email: user.email },
      target: { entityType: 'User', entityId: user._id.toString() },
      organisationId: user.organisationId,
      metadata: { via: 'password', roles: user.roles },
      createdAt: now,
    });

    fastify.log.info(
      { userId: user._id.toString(), email: user.email },
      'Invitation accepted via password',
    );

    return reply.code(204).send();
  });
};

export default fp(invitationsRoutesPlugin, {
  name: 'invitations-routes',
  dependencies: ['config', 'mongo', 'inventario-jwt', 'auth', 'email'],
});
