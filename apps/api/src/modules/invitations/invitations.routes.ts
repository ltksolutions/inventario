// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Invitations routes — Slice #9c K10-K12+K14 (ADR-0015).
 *
 * K10: POST /v1/invitations — cross-tenant email match logic
 *   new-user → Invitation { invitedUserId: null }
 *   globally-suspended user → 400 USER_GLOBALLY_SUSPENDED
 *   already a member → 409 ALREADY_MEMBER
 *   soft-deleted membership (left/removed) → rejoin Invitation { invitedUserId }
 *   existing user, no membership → cross-tenant Invitation { invitedUserId }
 *
 * K11: GET /v1/auth/invitations/:token — extended preview
 *   returns acceptMode: 'new-user' | 'existing-user'
 *   returns existingUserPreview when acceptMode === 'existing-user'
 *
 * K12: POST /v1/auth/accept-invitation — existing-user path
 *   acceptMode 'new-user' → unchanged (create User + Membership)
 *   acceptMode 'existing-user' + logged-in matching user → create Membership only
 *   acceptMode 'existing-user' + not logged in → 401 LOGIN_REQUIRED
 *
 * K14: Audit events
 *   USER_INVITED — on new invite
 *   USER_INVITATION_ACCEPTED — on accept (both paths)
 *   USER_JOINED_ORGANISATION — cross-tenant accept
 *   USER_REJOINED_ORGANISATION — rejoin accept
 *
 * Backward compat:
 *   GET /v1/invitations list + DELETE /v1/invitations/:id still work.
 *   Ghost-user fallback in InvitationsRepository handles pre-migration data.
 */

import { randomBytes } from 'node:crypto';

import {
  AccountType,
  AuthProvider,
  UserRole,
  type Organisation,
  type User,
} from '@inventario/shared-types';
import argon2 from 'argon2';
import fp from 'fastify-plugin';
import { ObjectId } from 'mongodb';
import { z } from 'zod';

import { BadRequestError, NotFoundError, UnauthorizedError } from '../../plugins/error-handler.js';
import { setAuthCookies } from '../auth/cookie-helpers.js';
import { InvitationsRepository } from '../invitations/invitations.repository.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';

import type { FastifyPluginAsync } from 'fastify';
import type { WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INVITE_TTL_DAYS = 7;
const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;
const IS_TEST = process.env['NODE_ENV'] === 'test';

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
  // Password required only for new-user path; optional for existing-user path
  password: z.string().min(12).max(128).optional(),
  firstName: z.string().min(1).max(100).trim().optional(),
  lastName: z.string().min(1).max(100).trim().optional(),
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
  const invRepo = new InvitationsRepository(fastify.mongo.db);
  const membRepo = new MembershipsRepository(fastify.mongo.db);
  await invRepo.ensureIndexes();
  await membRepo.ensureIndexes();

  const { OAUTH_REDIRECT_BASE_URL, JWT_ACCESS_TOKEN_TTL_SECONDS, JWT_REFRESH_TOKEN_TTL_DAYS } =
    fastify.config;

  const frontendUrl = OAUTH_REDIRECT_BASE_URL
    ? OAUTH_REDIRECT_BASE_URL.replace('/v1/auth/callback', '').replace('/api', '')
    : 'http://localhost:3001';

  // =========================================================================
  // K10: POST /v1/invitations — cross-tenant email match logic
  // =========================================================================

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
      const orgId = request.organisationId;
      const inviterId = String(inviter._id);

      // Role privilege check: ASSET_MANAGER cannot grant ADMIN
      if (!inviter.roles.includes(UserRole.ADMIN) && roles.includes(UserRole.ADMIN)) {
        throw new BadRequestError('Only ADMIN can invite another ADMIN.');
      }

      // Domain policy check — s per-email exceptions
      const orgSettings = (org.settings ?? {}) as {
        invitations?: { enforceAllowedDomains?: boolean; exceptions?: string[] };
      };
      if (orgSettings.invitations?.enforceAllowedDomains) {
        const domain = email.split('@')[1] ?? '';
        const allowed: string[] = org.autoJoinDomains ?? [];
        const exceptions: string[] = orgSettings.invitations.exceptions ?? [];
        // Exceptions: konkrétne emaily mogú byť pozvané napriek domené politike
        if (!allowed.includes(domain) && !exceptions.includes(email)) {
          throw new BadRequestError(
            `Email domain '@${domain}' is not allowed. Allowed: ${allowed.map((d) => `@${d}`).join(', ')}`,
          );
        }
      }

      // Prevent duplicate active invite to same email+org
      const duplicate = await invRepo.findActiveDuplicate(email, orgId);
      if (duplicate) {
        throw new BadRequestError(
          `An active invitation for '${email}' already exists in this organisation.`,
        );
      }

      const now = new Date().toISOString();
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

      // ----- K10: Email match logic -----
      const usersCol = fastify.mongo.db.collection<User>('users');
      const existingUser = (await usersCol.findOne({
        email,
        deletedAt: null,
      })) as WithId<User> | null;

      let invitedUserId: string | null = null;
      let emailVariant: 'new-user' | 'cross-tenant' | 'rejoin' = 'new-user';

      if (existingUser) {
        // Globally suspended user cannot be invited
        if (!existingUser['isActive']) {
          throw new BadRequestError(
            'USER_GLOBALLY_SUSPENDED: This user account is globally suspended.',
          );
        }

        const userId = String(existingUser['_id']);

        // Check existing membership (active or soft-deleted)
        const activeMembership = await membRepo.findActive({ userId, organisationId: orgId });
        if (activeMembership) {
          // Active membership — 409
          throw Object.assign(new Error('ALREADY_MEMBER'), {
            statusCode: 409,
            name: 'ConflictError',
          });
        }

        // Check for soft-deleted (left/removed) membership — rejoin
        const allMemberships = await membRepo.findByUser(userId);
        const deletedMembership = allMemberships.find(
          (m) => m.organisationId === orgId && m.deletedAt !== null,
        );

        invitedUserId = userId;
        emailVariant = deletedMembership ? 'rejoin' : 'cross-tenant';
      }

      // Insert Invitation into new collection
      const insertedId = await invRepo.create({
        email,
        organisationId: orgId,
        roles,
        firstName: firstName ?? null,
        lastName: lastName ?? null,
        invitedUserId,
        token,
        expiresAt,
        invitedBy: inviterId,
        status: 'PENDING',
        acceptedAt: null,
        membershipId: null,
        createdAt: now,
        updatedAt: now,
        createdBy: inviterId,
        updatedBy: inviterId,
        deletedAt: null,
        deletedBy: null,
      });

      // K14: Audit
      await fastify.mongo.db.collection('audit_logs').insertOne({
        action: 'USER_INVITED',
        severity: 'INFO',
        actor: { userId: inviterId, email: inviter.email },
        target: { entityType: 'Invitation', entityId: insertedId },
        organisationId: orgId,
        metadata: {
          invitedEmail: email,
          roles,
          invitedUserId,
          variant: emailVariant,
        },
        createdAt: now,
      });

      // Send appropriate email
      const roleLabels = roles.map((r) => ROLE_LABELS[r] ?? r).join(', ');
      try {
        if (emailVariant === 'rejoin') {
          await fastify.emailService.send({
            to: email,
            subject: `Ste pozvaný späť do ${org.displayName} — Inventario`,
            html: rejoinInviteHtml({
              url: `${frontendUrl}/accept-invite?token=${token}`,
              tenantName: org.displayName,
              roleLabels,
            }),
            text: `Boli ste pozvaný späť do ${org.displayName} (${roleLabels}). Prijmite pozvánku: ${frontendUrl}/accept-invite?token=${token}`,
          });
        } else {
          await fastify.emailService.sendInvitationEmail(email, {
            inviterName: inviter.displayName,
            tenantName: org.displayName,
            roleLabels,
            token,
            frontendUrl,
          });
        }
      } catch (err) {
        fastify.log.error({ err, to: email }, 'Invitation email failed to send');
      }

      fastify.log.info(
        { invitedEmail: email, invitedBy: inviterId, roles, variant: emailVariant },
        'Invitation created',
      );

      return reply.code(201).send({
        _id: insertedId,
        email,
        roles,
        invitedBy: inviterId,
        invitedAt: now,
        expiresAt,
        acceptMode: invitedUserId ? 'existing-user' : 'new-user',
      });
    },
  );

  // =========================================================================
  // GET /v1/invitations — list pending invitations
  // =========================================================================

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

    const { items, total } = await invRepo.list({
      organisationId: request.organisationId,
      limit,
      skip,
      ...(q !== undefined ? { q } : {}),
    });

    return reply.send({
      data: items.map((inv) => invRepo.toPublic(inv)),
      pagination: { total, limit, skip, hasMore: skip + items.length < total },
    });
  });

  // =========================================================================
  // DELETE /v1/invitations/:id — revoke pending invite
  // =========================================================================

  fastify.delete('/v1/invitations/:id', async (request, reply) => {
    await fastify.requireAuth(request);
    await fastify.loadCurrentUser(request);
    await fastify
      .requireRole([UserRole.ADMIN, UserRole.ASSET_MANAGER])
      .call(fastify, request, reply);

    const { id } = request.params as { id: string };
    if (!id || !/^[a-f0-9]{24}$/i.test(id)) {
      throw new BadRequestError('Invalid invitation id');
    }

    const existing = await invRepo.findById(request.organisationId, id);
    if (!existing) throw new NotFoundError('Invitation', id);

    const now = new Date().toISOString();
    const revoked = await invRepo.revoke(request.organisationId, id, {
      deletedAt: now,
      deletedBy: String(request.currentUser._id),
      updatedAt: now,
      updatedBy: String(request.currentUser._id),
    });
    if (!revoked) throw new NotFoundError('Invitation', id);

    await fastify.mongo.db.collection('audit_logs').insertOne({
      action: 'USER_INVITATION_REVOKED',
      severity: 'WARNING',
      actor: { userId: String(request.currentUser._id), email: request.currentUser.email },
      target: { entityType: 'Invitation', entityId: id },
      organisationId: request.organisationId,
      metadata: { revokedEmail: existing.email },
      createdAt: now,
    });

    return reply.code(204).send();
  });

  // =========================================================================
  // POST /v1/invitations/:id/resend — resend pending invite email
  // =========================================================================

  fastify.post('/v1/invitations/:id/resend', async (request, reply) => {
    await fastify.requireAuth(request);
    await fastify.loadCurrentUser(request);
    await fastify
      .requireRole([UserRole.ADMIN, UserRole.ASSET_MANAGER])
      .call(fastify, request, reply);

    const { id } = request.params as { id: string };
    if (!id || !/^[a-f0-9]{24}$/i.test(id)) {
      throw new BadRequestError('Invalid invitation id');
    }

    const existing = await invRepo.findById(request.organisationId, id);
    if (!existing) throw new NotFoundError('Invitation', id);

    if ((existing as Record<string, unknown>)['status'] !== 'PENDING') {
      throw new BadRequestError('Only PENDING invitations can be resent.');
    }

    // Generate a new token + extended expiry
    const now = new Date().toISOString();
    const newToken = randomBytes(32).toString('hex');
    const newExpiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

    await fastify.mongo.db
      .collection('invitations')
      .updateOne({ _id: (existing as Record<string, unknown>)['_id'] } as never, {
        $set: {
          token: newToken,
          expiresAt: newExpiresAt,
          updatedAt: now,
          updatedBy: String(request.currentUser._id),
        },
      });

    const org = request.organisation;
    const inviter = request.currentUser;
    const email = existing.email;
    const roles: UserRole[] = existing.roles as UserRole[];
    const roleLabels = roles.map((r) => ROLE_LABELS[r] ?? r).join(', ');
    const invitedUserId =
      ((existing as Record<string, unknown>)['invitedUserId'] as string | null) ?? null;
    const isRejoin = !!(await fastify.mongo.db.collection('memberships').findOne({
      userId: invitedUserId,
      organisationId: request.organisationId,
      deletedAt: { $ne: null },
    }));

    try {
      if (isRejoin) {
        await fastify.emailService.send({
          to: email,
          subject: `Ste pozvaný späť do ${org.displayName} — Inventario`,
          html: rejoinInviteHtml({
            url: `${frontendUrl}/accept-invite?token=${newToken}`,
            tenantName: org.displayName,
            roleLabels,
          }),
          text: `Boli ste pozvaný späť do ${org.displayName} (${roleLabels}). Prijmite pozvánku: ${frontendUrl}/accept-invite?token=${newToken}`,
        });
      } else {
        await fastify.emailService.sendInvitationEmail(email, {
          inviterName: inviter.displayName,
          tenantName: org.displayName,
          roleLabels,
          token: newToken,
          frontendUrl,
        });
      }
    } catch (err) {
      fastify.log.error({ err, to: email }, 'Resend invitation email failed');
    }

    fastify.log.info(
      { invitationId: id, invitedEmail: email, resentBy: String(inviter._id) },
      'Invitation resent',
    );

    return reply.code(204).send();
  });

  // =========================================================================
  // K11: GET /v1/auth/invitations/:token — extended preview
  // =========================================================================

  fastify.get('/v1/auth/invitations/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      return reply.code(410).send({ error: 'Invitation not found or expired' });
    }

    const inv = await invRepo.findByToken(token);
    if (!inv) return reply.code(410).send({ error: 'Invitation not found or expired' });

    // Check expiry (expiresAt on Invitation, or emailVerificationExpiresAt on ghost-user)
    const expiresAt =
      ((inv as Record<string, unknown>)['expiresAt'] as string) ??
      ((inv as Record<string, unknown>)['emailVerificationExpiresAt'] as string);
    if (expiresAt && new Date(expiresAt) < new Date()) {
      return reply.code(410).send({ error: 'Invitation not found or expired' });
    }

    // Check status — ACCEPTED/REVOKED/EXPIRED invitations are no longer valid
    const invStatus = (inv as Record<string, unknown>)['status'] as string | undefined;
    if (invStatus && invStatus !== 'PENDING') {
      return reply.code(410).send({ error: 'Invitation not found or expired' });
    }

    // Load org for preview
    const orgDoc = await fastify.mongo.db
      .collection<Organisation>('organisations')
      .findOne(
        { _id: new ObjectId(inv.organisationId) as never, deletedAt: null },
        { projection: { displayName: 1, slug: 1, brandKit: 1 } },
      );

    // Load inviter for preview
    const inviterDoc = ObjectId.isValid(inv.invitedBy as string)
      ? await fastify.mongo.db
          .collection<User>('users')
          .findOne(
            { _id: new ObjectId(inv.invitedBy as string) as never },
            { projection: { displayName: 1 } },
          )
      : null;

    // K11: acceptMode + existingUserPreview
    const invitedUserId =
      ((inv as Record<string, unknown>)['invitedUserId'] as string | null) ?? null;
    const acceptMode = invitedUserId ? 'existing-user' : 'new-user';

    let existingUserPreview: { displayName: string; authProviders: string[] } | null = null;
    if (acceptMode === 'existing-user' && invitedUserId) {
      const existingUser = await fastify.mongo.db
        .collection<User>('users')
        .findOne(
          { _id: new ObjectId(invitedUserId) as never, deletedAt: null },
          { projection: { displayName: 1, authProviders: 1 } },
        );
      if (existingUser) {
        const providers = (
          (existingUser['authProviders'] as Array<{ provider: string }>) ?? []
        ).map((p) => p.provider);
        existingUserPreview = {
          displayName: existingUser['displayName'] as string,
          authProviders: providers,
        };
      }
    }

    return reply.send({
      email: inv.email,
      roles: inv.roles,
      firstName: inv.firstName ?? null,
      lastName: inv.lastName ?? null,
      organisation: {
        displayName: orgDoc?.displayName ?? 'Inventario',
        slug: orgDoc?.slug ?? '',
        brandKit: orgDoc?.brandKit ?? null,
      },
      inviter: { displayName: (inviterDoc?.['displayName'] as string) ?? 'Inventario' },
      expiresAt,
      acceptMode,
      existingUserPreview,
    });
  });

  // =========================================================================
  // K12: POST /v1/auth/accept-invitation — new-user + existing-user paths
  // =========================================================================

  fastify.post('/v1/auth/accept-invitation', async (request, reply) => {
    const parsed = AcceptInvitationSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { token, password, firstName, lastName } = parsed.data;

    const inv = await invRepo.findByToken(token);
    if (!inv) throw new BadRequestError('Invitation is invalid or has already been used.');

    // Check status — only PENDING invitations can be accepted
    const invStatus = (inv as Record<string, unknown>)['status'] as string | undefined;
    if (invStatus && invStatus !== 'PENDING') {
      throw new BadRequestError('Invitation is invalid or has already been used.');
    }

    const expiresAt =
      ((inv as Record<string, unknown>)['expiresAt'] as string) ??
      ((inv as Record<string, unknown>)['emailVerificationExpiresAt'] as string);
    if (expiresAt && new Date(expiresAt) < new Date()) {
      throw new BadRequestError(
        'Invitation has expired. Ask your administrator to send a new one.',
      );
    }

    const invitedUserId =
      ((inv as Record<string, unknown>)['invitedUserId'] as string | null) ?? null;
    const now = new Date().toISOString();

    // Load target org
    const org = (await fastify.mongo.db
      .collection<Organisation>('organisations')
      .findOne({ _id: new ObjectId(inv.organisationId) as never })) as WithId<Organisation> | null;
    if (!org) throw new BadRequestError('Organisation not found.');

    let userId: string;
    let auditAction = 'USER_INVITATION_ACCEPTED';
    let isRejoin = false;

    if (invitedUserId) {
      // -----------------------------------------------------------------------
      // K12: existing-user path — logged-in matching user
      // -----------------------------------------------------------------------
      const accessCookie = request.cookies?.['inv_access'];
      if (!accessCookie) {
        // Not logged in — frontend must redirect to login with invite token in state
        throw new UnauthorizedError(
          'LOGIN_REQUIRED: Please log in with your existing account to accept this invitation.',
        );
      }

      // Verify the cookie belongs to the correct user
      let claims;
      try {
        claims = await fastify.inventarioJwt.verifyAccessToken(accessCookie);
      } catch {
        throw new UnauthorizedError('Invalid session. Please log in again.');
      }

      if (claims.sub !== invitedUserId) {
        throw new BadRequestError(
          `EMAIL_MISMATCH: This invitation is for a different account. ` +
            `Please log in as the invited user and try again.`,
        );
      }

      userId = invitedUserId;

      // Check whether this is a rejoin (soft-deleted membership exists)
      const allMemberships = await membRepo.findByUser(userId);
      isRejoin = allMemberships.some(
        (m) => m.organisationId === inv.organisationId && m.deletedAt !== null,
      );

      // Create Membership in target org (no User changes needed)
      const membership = await membRepo.create({
        userId,
        organisationId: inv.organisationId,
        roles: inv.roles,
        organizationalUnit: null,
        teams: [],
        status: 'ACTIVE',
        isDefault: false, // existing users keep their current default
        invitedBy: inv.invitedBy,
        invitedAt: inv.createdAt,
        acceptedAt: now,
        mustChangePassword: false,
        lastAccessedAt: now,
        notifications: { email: true, push: false },
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
        deletedAt: null,
        deletedBy: null,
      });

      // Mark invitation ACCEPTED
      await invRepo.accept(String(inv._id), {
        acceptedAt: now,
        membershipId: String(membership._id),
        updatedAt: now,
        updatedBy: userId,
      });

      // Issue new JWT with target org as active tenant
      const userDoc = (await fastify.mongo.db
        .collection<User>('users')
        .findOne({ _id: new ObjectId(userId) as never })) as WithId<User> | null;
      if (!userDoc) throw new BadRequestError('User not found.');

      const accessToken = await fastify.inventarioJwt.issueAccessToken(
        userDoc as never,
        org as never,
        String(membership._id),
        inv.roles,
      );
      const refreshToken = await fastify.inventarioJwt.issueRefreshToken(userId, request);
      setAuthCookies(
        reply,
        accessToken,
        refreshToken,
        JWT_ACCESS_TOKEN_TTL_SECONDS,
        JWT_REFRESH_TOKEN_TTL_DAYS,
      );

      auditAction = isRejoin ? 'USER_REJOINED_ORGANISATION' : 'USER_JOINED_ORGANISATION';
    } else {
      // -----------------------------------------------------------------------
      // new-user path — create User + Membership
      // -----------------------------------------------------------------------
      if (!password) throw new BadRequestError('Password is required to accept this invitation.');
      if (!firstName || !lastName) throw new BadRequestError('First and last name are required.');

      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65_536,
        timeCost: 3,
        parallelism: 4,
      });

      const displayName = `${firstName} ${lastName}`.trim();

      // Insert new User
      const userInsert = await fastify.mongo.db.collection<User>('users').insertOne({
        email: inv.email,
        firstName,
        lastName,
        displayName,
        accountType: AccountType.LOCAL,
        entraOid: null,
        authProviders: [
          {
            provider: AuthProvider.EMAIL,
            providerId: inv.email,
            email: inv.email,
            linkedAt: now,
          },
        ],
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpiresAt: null,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
        passwordHash,
        roles: inv.roles,
        isActive: true,
        lastLoginAt: now,
        mfaEnabled: false,
        mfaSecret: null,
        mfaRecoveryCodes: [],
        mfaEnabledAt: null,
        preferences: { language: 'sk', timezone: 'Europe/Bratislava' },
        createdAt: now,
        updatedAt: now,
        createdBy: 'SYSTEM',
        updatedBy: 'SYSTEM',
        deletedAt: null,
        deletedBy: null,
      } as never);

      userId = String(userInsert.insertedId);

      // Create default Membership in target org
      const membership = await membRepo.create({
        userId,
        organisationId: inv.organisationId,
        roles: inv.roles,
        organizationalUnit: null,
        teams: [],
        status: 'ACTIVE',
        isDefault: true,
        invitedBy: inv.invitedBy,
        invitedAt: inv.createdAt,
        acceptedAt: now,
        mustChangePassword: false,
        lastAccessedAt: now,
        notifications: { email: true, push: false },
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
        deletedAt: null,
        deletedBy: null,
      });

      // Mark invitation ACCEPTED
      await invRepo.accept(String(inv._id), {
        acceptedAt: now,
        membershipId: String(membership._id),
        updatedAt: now,
        updatedBy: userId,
      });

      // Issue JWT
      const userDoc = (await fastify.mongo.db
        .collection<User>('users')
        .findOne({ _id: new ObjectId(userId) as never })) as never;

      const accessToken = await fastify.inventarioJwt.issueAccessToken(
        userDoc,
        org as never,
        String(membership._id),
        inv.roles,
      );
      const refreshToken = await fastify.inventarioJwt.issueRefreshToken(userId, request);
      setAuthCookies(
        reply,
        accessToken,
        refreshToken,
        JWT_ACCESS_TOKEN_TTL_SECONDS,
        JWT_REFRESH_TOKEN_TTL_DAYS,
      );
    }

    // K14: Audit
    await fastify.mongo.db.collection('audit_logs').insertOne({
      action: auditAction,
      severity: 'INFO',
      actor: { userId, email: inv.email },
      target: { entityType: 'Organisation', entityId: inv.organisationId },
      organisationId: inv.organisationId,
      metadata: {
        via: invitedUserId ? 'existing-user' : 'password',
        roles: inv.roles,
        isRejoin,
        invitationId: String(inv._id),
      },
      createdAt: now,
    });

    fastify.log.info(
      { userId, email: inv.email, org: inv.organisationId, action: auditAction },
      'Invitation accepted',
    );

    return reply.code(204).send();
  });
};

export default fp(invitationsRoutesPlugin, {
  name: 'invitations-routes',
  dependencies: ['config', 'mongo', 'inventario-jwt', 'auth', 'email'],
});

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

function rejoinInviteHtml(opts: { url: string; tenantName: string; roleLabels: string }): string {
  const { url, tenantName, roleLabels } = opts;
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#F8F6F1;padding:40px 20px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
<div style="background:#1A2D47;padding:24px 32px;">
<p style="margin:0;color:#fff;font-size:20px;font-weight:700;">Inventario</p></div>
<div style="padding:32px;">
<h1 style="color:#1A2D47;font-size:22px;">Ste pozvaný späť do ${tenantName}</h1>
<p style="color:#475569;font-size:15px;">Boli ste opätovne pozvaní do organizácie <strong>${tenantName}</strong> s rolou <strong>${roleLabels}</strong>.</p>
<a href="${url}" style="display:inline-block;background:#388FC3;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:6px;">Prijať pozvánku</a>
</div></div></body></html>`;
}
