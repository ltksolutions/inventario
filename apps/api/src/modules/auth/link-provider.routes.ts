// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Account Linking — OAuth provider → existing local/OAuth account.
 *
 * Problem: a user created via email/password (or another OAuth provider)
 * clicks "Continue with Microsoft". provisionOrFindUser finds no match
 * by providerId, but finds one by email. Instead of invite_required the
 * callback redirects here with a short-lived link_token so the user can
 * prove ownership of the existing account before the provider is linked.
 *
 * Two confirmation paths:
 *
 *   A) Password path — user has passwordHash:
 *      Callback → redirect /link-account?token=<link_token>
 *      Frontend → POST /v1/auth/link-provider/confirm { link_token, password }
 *      API      → verify password, push authProvider, issue cookies
 *
 *   B) Magic-link path — user has no password (OAuth-only account):
 *      Callback → send email with magic link token → redirect
 *                 /link-account?method=email&hint=<masked>
 *      User     → clicks link in email
 *      GET /v1/auth/link-provider/verify?token=<magic_token>
 *      API      → verify token, push authProvider, issue cookies + redirect /dashboard
 *
 * Security notes:
 *   - link_token and magic_token are stored in `account_link_tokens` collection
 *     with a TTL index (10 min password path, 30 min magic-link path).
 *   - Tokens are single-use: consumed on first valid use.
 *   - Only one pending link token per (userId + newProvider) is kept —
 *     creating a new one invalidates any previous.
 *   - Magic-link path checks email_verified on the OAuth side. For Microsoft
 *     this is always true; for Google we gate on emailVerified === true.
 */

import { randomBytes } from 'node:crypto';

import argon2 from 'argon2';
import fp from 'fastify-plugin';
import { z } from 'zod';

import { BadRequestError, UnauthorizedError } from '../../plugins/error-handler.js';

import { setAuthCookies } from './cookie-helpers.js';

import type { AuthProvider, Organisation, User } from '@inventario/shared-types';
import type { FastifyPluginAsync } from 'fastify';
import type { Db, WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Token TTLs
// ---------------------------------------------------------------------------

const PASSWORD_PATH_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAGIC_LINK_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ConfirmSchema = z.object({
  link_token: z.string().length(64),
  password: z.string().min(1).max(128),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const linkProviderRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const db = fastify.mongo.db;
  const linkTokensCol = db.collection('account_link_tokens');
  const usersCol = db.collection<User>('users');
  const orgsCol = db.collection<Organisation>('organisations');
  const membershipsCol = db.collection('memberships');

  // Ensure TTL index exists (idempotent — Mongo ignores if already present)
  await linkTokensCol.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  // -------------------------------------------------------------------------
  // POST /v1/auth/link-provider/confirm
  // Password path: verify password, link provider, issue cookies.
  // -------------------------------------------------------------------------
  fastify.post('/v1/auth/link-provider/confirm', async (request, reply) => {
    const parsed = ConfirmSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Neplatný vstup.');
    }
    const { link_token, password } = parsed.data;

    const tokenDoc = await linkTokensCol.findOne({
      token: link_token,
      method: 'password',
      expiresAt: { $gt: new Date() },
    });

    if (!tokenDoc) {
      throw new BadRequestError('Odkaz na prepojenie je neplatný alebo vypršal.');
    }

    const { ObjectId } = await import('mongodb');
    const user = (await usersCol.findOne({
      _id: new ObjectId(tokenDoc['userId'] as string) as never,
      deletedAt: null,
    })) as WithId<User> | null;

    if (!user || !user.passwordHash) {
      throw new UnauthorizedError('Účet nenájdený.');
    }

    // Verify password
    let passwordValid: boolean;
    try {
      passwordValid = await argon2.verify(user.passwordHash, password);
    } catch {
      passwordValid = false;
    }

    if (!passwordValid) {
      throw new UnauthorizedError('Nesprávne heslo.');
    }

    // Link the provider (idempotent — skip if already linked)
    const newProvider = tokenDoc['newProvider'] as AuthProvider;
    const newProviderId = tokenDoc['newProviderId'] as string;
    const newProviderEmail = tokenDoc['newProviderEmail'] as string;

    const alreadyLinked = (
      (user.authProviders ?? []) as Array<{
        provider: string;
        providerId: string;
      }>
    ).some((p) => p.provider === newProvider && p.providerId === newProviderId);

    const now = new Date().toISOString();
    if (!alreadyLinked) {
      await usersCol.updateOne(
        { _id: user._id },
        {
          $push: {
            authProviders: {
              provider: newProvider,
              providerId: newProviderId,
              email: newProviderEmail,
              linkedAt: now,
            },
          } as never,
          $set: { lastLoginAt: now, updatedAt: now },
        },
      );
    } else {
      await usersCol.updateOne({ _id: user._id }, { $set: { lastLoginAt: now, updatedAt: now } });
    }

    // Consume token (single-use)
    await linkTokensCol.deleteOne({ _id: tokenDoc['_id'] });

    // Find membership for JWT
    const membership = await membershipsCol.findOne({
      userId: String(user._id),
      isDefault: true,
      status: 'ACTIVE',
      deletedAt: null,
    });
    if (!membership) throw new UnauthorizedError('Aktívne členstvo nenájdené.');

    const org = (await orgsCol.findOne({
      _id: new ObjectId(membership['organisationId'] as string) as never,
      deletedAt: null,
    })) as WithId<Organisation> | null;
    if (!org) throw new UnauthorizedError('Organizácia nenájdená.');

    const freshUser = (await usersCol.findOne({ _id: user._id } as never)) as WithId<User>;

    const accessToken = await fastify.inventarioJwt.issueAccessToken(
      freshUser,
      org,
      String(membership['_id']),
      (membership['role'] as string) ?? 'EMPLOYEE',
    );
    const refreshToken = await fastify.inventarioJwt.issueRefreshToken(String(user._id), request);

    setAuthCookies(
      reply,
      accessToken,
      refreshToken,
      fastify.config.JWT_ACCESS_TOKEN_TTL_SECONDS,
      fastify.config.JWT_REFRESH_TOKEN_TTL_DAYS,
    );

    fastify.log.info(
      { userId: String(user._id), newProvider },
      'Account linking confirmed via password',
    );

    return reply.code(204).send();
  });

  // -------------------------------------------------------------------------
  // GET /v1/auth/link-provider/verify
  // Magic-link path: verify token, link provider, redirect to dashboard.
  // -------------------------------------------------------------------------
  fastify.get<{ Querystring: { token?: string } }>(
    '/v1/auth/link-provider/verify',
    async (request, reply) => {
      const { token } = request.query;
      const { FRONTEND_BASE_URL } = fastify.config;

      if (!token || token.length !== 64) {
        return reply.redirect(`${FRONTEND_BASE_URL}/link-account?error=invalid_magic_token`);
      }

      const tokenDoc = await linkTokensCol.findOne({
        token,
        method: 'magic_link',
        expiresAt: { $gt: new Date() },
      });

      if (!tokenDoc) {
        return reply.redirect(`${FRONTEND_BASE_URL}/link-account?error=magic_token_expired`);
      }

      const { ObjectId } = await import('mongodb');
      const user = (await usersCol.findOne({
        _id: new ObjectId(tokenDoc['userId'] as string) as never,
        deletedAt: null,
      })) as WithId<User> | null;

      if (!user) {
        return reply.redirect(`${FRONTEND_BASE_URL}/link-account?error=user_not_found`);
      }

      const newProvider = tokenDoc['newProvider'] as AuthProvider;
      const newProviderId = tokenDoc['newProviderId'] as string;
      const newProviderEmail = tokenDoc['newProviderEmail'] as string;

      const alreadyLinked = (
        (user.authProviders ?? []) as Array<{
          provider: string;
          providerId: string;
        }>
      ).some((p) => p.provider === newProvider && p.providerId === newProviderId);

      const now = new Date().toISOString();
      if (!alreadyLinked) {
        await usersCol.updateOne(
          { _id: user._id },
          {
            $push: {
              authProviders: {
                provider: newProvider,
                providerId: newProviderId,
                email: newProviderEmail,
                linkedAt: now,
              },
            } as never,
            $set: { lastLoginAt: now, updatedAt: now },
          },
        );
      } else {
        await usersCol.updateOne({ _id: user._id }, { $set: { lastLoginAt: now, updatedAt: now } });
      }

      // Consume token
      await linkTokensCol.deleteOne({ _id: tokenDoc['_id'] });

      // Find membership
      const membership = await membershipsCol.findOne({
        userId: String(user._id),
        isDefault: true,
        status: 'ACTIVE',
        deletedAt: null,
      });
      if (!membership) {
        return reply.redirect(`${FRONTEND_BASE_URL}/link-account?error=membership_not_found`);
      }

      const org = (await orgsCol.findOne({
        _id: new ObjectId(membership['organisationId'] as string) as never,
        deletedAt: null,
      })) as WithId<Organisation> | null;
      if (!org) {
        return reply.redirect(`${FRONTEND_BASE_URL}/link-account?error=org_not_found`);
      }

      const freshUser = (await usersCol.findOne({ _id: user._id } as never)) as WithId<User>;

      const accessToken = await fastify.inventarioJwt.issueAccessToken(
        freshUser,
        org,
        String(membership['_id']),
        (membership['role'] as string) ?? 'EMPLOYEE',
      );
      const refreshToken = await fastify.inventarioJwt.issueRefreshToken(String(user._id), request);

      setAuthCookies(
        reply,
        accessToken,
        refreshToken,
        fastify.config.JWT_ACCESS_TOKEN_TTL_SECONDS,
        fastify.config.JWT_REFRESH_TOKEN_TTL_DAYS,
      );

      fastify.log.info(
        { userId: String(user._id), newProvider },
        'Account linking confirmed via magic link',
      );

      return reply.redirect(`${FRONTEND_BASE_URL}/dashboard?linked=true`);
    },
  );
};

export default fp(linkProviderRoutesPlugin, {
  name: 'link-provider-routes',
  dependencies: ['config', 'mongo', 'inventario-jwt', 'email'],
});

// ---------------------------------------------------------------------------
// Exported helpers — used by oauth.routes.ts provisionOrFindUser
// ---------------------------------------------------------------------------

export interface CreateLinkTokenArgs {
  userId: string;
  newProvider: AuthProvider;
  newProviderId: string;
  newProviderEmail: string;
  hasPassword: boolean;
}

export interface CreateLinkTokenResult {
  method: 'password' | 'magic_link';
  token: string;
  maskedEmail: string;
}

/**
 * Create a short-lived account-link token for the given user + new provider.
 * Replaces any existing pending token for the same (userId, newProvider) pair.
 */
export async function createLinkToken(
  db: Db,
  args: CreateLinkTokenArgs,
): Promise<CreateLinkTokenResult> {
  const { userId, newProvider, newProviderId, newProviderEmail, hasPassword } = args;
  const col = db.collection('account_link_tokens');

  const method = hasPassword ? 'password' : 'magic_link';
  const ttlMs = hasPassword ? PASSWORD_PATH_TTL_MS : MAGIC_LINK_TTL_MS;

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttlMs);

  // Replace any previous pending token for this user+provider pair
  await col.deleteMany({ userId, newProvider });

  await col.insertOne({
    token,
    method,
    userId,
    newProvider,
    newProviderId,
    newProviderEmail,
    expiresAt,
    createdAt: new Date().toISOString(),
  });

  const [localPart, domain] = newProviderEmail.split('@');
  const masked = localPart && domain ? `${localPart.slice(0, 2)}***@${domain}` : newProviderEmail;

  return { method, token, maskedEmail: masked };
}
