// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Registration endpoint — K7 per ADR-0013.
 *
 * POST /v1/auth/register
 *
 * Unified entry point for the /register page. Accepts org info + chosen
 * auth provider and routes to the appropriate flow:
 *
 *   provider = 'google' | 'microsoft':
 *     Builds the OAuth authorization URL (PKCE + signed state cookie),
 *     sets the inv_oauth_state cookie, and returns the URL as JSON.
 *     The frontend navigates to this URL — the rest happens in K3
 *     GET /v1/auth/callback/:provider.
 *
 *   provider = 'email':
 *     Validates email + password and executes the email registration
 *     flow inline (same logic as K5 POST /v1/auth/register/email, but
 *     accessed through the unified register endpoint). Returns 201 with
 *     emailVerificationRequired: true.
 *
 *   provider = 'apple':
 *     Apple Sign-In is K4 (not yet implemented). Returns 503.
 *
 * Rate limit: 5 requests per 15 minutes per IP (tighter than default).
 */

import { randomBytes } from 'node:crypto';

import { AccountType, AuthProvider, MemberJoinPolicy, UserRole } from '@inventario/shared-types';
import { Google, MicrosoftEntraId } from 'arctic';
import argon2 from 'argon2';
import fp from 'fastify-plugin';
import { z } from 'zod';

import { BadRequestError } from '../../plugins/error-handler.js';

import {
  OAUTH_STATE_COOKIE,
  generateOAuthState,
  oauthStateCookieOptions,
  serializeOAuthState,
} from './oauth-state.js';

import type { Organisation, User } from '@inventario/shared-types';
import type { FastifyPluginAsync } from 'fastify';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const RegisterSchema = z
  .object({
    orgName: z.string().min(2).max(200).trim(),
    contactEmail: z.string().email().toLowerCase(),
    ico: z.string().max(20).optional(),
    provider: z.enum(['google', 'microsoft', 'apple', 'email']),
    dpaAccepted: z.literal(true, {
      errorMap: () => ({ message: 'DPA acceptance is required.' }),
    }),
    // Email-only fields
    password: z.string().min(12).max(128).optional(),
  })
  .refine((d) => d.provider !== 'email' || (d.password !== undefined && d.password.length >= 12), {
    message: 'Password is required for email registration (min 12 chars).',
    path: ['password'],
  });

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const IS_TEST = process.env['NODE_ENV'] === 'test';

const registrationRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET,
    OAUTH_STATE_SECRET,
    OAUTH_REDIRECT_BASE_URL,
  } = fastify.config;

  fastify.post(
    '/v1/auth/register',
    { ...(IS_TEST ? {} : { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }) },
    async (request, reply) => {
      const parsed = RegisterSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid input');
      }
      const { orgName, contactEmail, ico, provider, password } = parsed.data;
      const dpaAcceptedAt = new Date().toISOString();

      // -----------------------------------------------------------------------
      // Apple — not yet implemented (K4)
      // -----------------------------------------------------------------------
      if (provider === 'apple') {
        return reply
          .code(503)
          .send({ error: 'Apple Sign-In is not yet available. Use Google, Microsoft, or email.' });
      }

      // -----------------------------------------------------------------------
      // Email registration
      // -----------------------------------------------------------------------
      if (provider === 'email') {
        if (!password) {
          throw new BadRequestError('Password is required for email registration.');
        }

        const db = fastify.mongo.db;
        const usersCol = db.collection<User>('users');
        const orgsCol = db.collection<Organisation>('organisations');

        // Duplicate check
        const existing = await usersCol.findOne({ email: contactEmail, deletedAt: null });
        if (existing) {
          throw new BadRequestError('Tento e-mail je už zaregistrovaný.');
        }

        const passwordHash = await argon2.hash(password, {
          type: argon2.argon2id,
          memoryCost: 65_536,
          timeCost: 3,
          parallelism: 4,
        });

        const verificationToken = randomBytes(32).toString('hex');
        const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        const now = dpaAcceptedAt;
        const slug = slugify(orgName);
        const slugExists = await orgsCol.findOne({ slug, deletedAt: null });
        const finalSlug = slugExists ? `${slug}-${Date.now().toString(36)}` : slug;

        const orgInsert = await orgsCol.insertOne({
          displayName: orgName,
          slug: finalSlug,
          entraTenantId: null,
          customDomain: null,
          status: 'ACTIVE' as const,
          plan: 'FREE' as const,
          primaryContactEmail: contactEmail,
          brandKit: null,
          settings: {},
          allowedAuthProviders: [
            AuthProvider.GOOGLE,
            AuthProvider.APPLE,
            AuthProvider.MICROSOFT,
            AuthProvider.EMAIL,
          ],
          memberJoinPolicy: MemberJoinPolicy.INVITE_ONLY,
          autoJoinDomains: [],
          registeredBy: null,
          registrationMethod: 'SELF_SERVE' as const,
          onboardingCompletedAt: null,
          dpaAcceptedAt,
          dpaAcceptedBy: null,
          createdAt: now,
          updatedAt: now,
          createdBy: 'SYSTEM',
          updatedBy: 'SYSTEM',
          deletedAt: null,
          deletedBy: null,
        } as never);

        const orgId = orgInsert.insertedId;

        const userInsert = await usersCol.insertOne({
          organisationId: orgId.toString(),
          email: contactEmail,
          firstName: contactEmail.split('@')[0] ?? 'User',
          lastName: '',
          displayName: contactEmail,
          accountType: AccountType.LOCAL,
          entraOid: null,
          authProviders: [
            {
              provider: AuthProvider.EMAIL,
              providerId: contactEmail,
              email: contactEmail,
              linkedAt: now,
            },
          ],
          emailVerified: false,
          emailVerificationToken: verificationToken,
          emailVerificationExpiresAt: verificationExpiresAt,
          passwordResetToken: null,
          passwordResetExpiresAt: null,
          passwordHash,
          roles: [UserRole.ADMIN],
          organizationalUnit: null,
          teams: [],
          isActive: true,
          lastLoginAt: now,
          invitationSentAt: null,
          mustChangePassword: false,
          preferences: {
            language: 'sk',
            timezone: 'Europe/Bratislava',
            emailNotifications: true,
            pushNotifications: false,
          },
          createdAt: now,
          updatedAt: now,
          createdBy: 'SYSTEM',
          updatedBy: 'SYSTEM',
          deletedAt: null,
          deletedBy: null,
        } as never);

        const userId = userInsert.insertedId;

        await orgsCol.updateOne(
          { _id: orgId },
          {
            $set: {
              registeredBy: userId.toString(),
              dpaAcceptedBy: userId.toString(),
              updatedAt: now,
            },
          },
        );

        const apiBase = OAUTH_REDIRECT_BASE_URL ?? 'http://localhost:3000';
        await fastify.emailService.sendVerificationEmail(contactEmail, verificationToken, apiBase);

        fastify.log.info(
          { userId: userId.toString(), email: contactEmail },
          'Email registration via /register',
        );

        return reply.code(201).send({
          type: 'email',
          message: 'Registrácia úspešná. Skontrolujte e-mail a potvrďte svoju adresu.',
          emailVerificationRequired: true,
        });
      }

      // -----------------------------------------------------------------------
      // SSO registration (google | microsoft) — build OAuth URL
      // -----------------------------------------------------------------------
      if (!OAUTH_STATE_SECRET || !OAUTH_REDIRECT_BASE_URL) {
        return reply.code(503).send({ error: 'OAuth is not configured on this server.' });
      }

      // Build the provider
      let oauthProvider: Google | MicrosoftEntraId | null = null;
      if (provider === 'google' && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
        oauthProvider = new Google(
          GOOGLE_CLIENT_ID,
          GOOGLE_CLIENT_SECRET,
          `${OAUTH_REDIRECT_BASE_URL}/google`,
        );
      } else if (provider === 'microsoft' && MICROSOFT_CLIENT_ID && MICROSOFT_CLIENT_SECRET) {
        oauthProvider = new MicrosoftEntraId(
          'organizations',
          MICROSOFT_CLIENT_ID,
          MICROSOFT_CLIENT_SECRET,
          `${OAUTH_REDIRECT_BASE_URL}/microsoft`,
        );
      }

      if (!oauthProvider) {
        return reply.code(503).send({ error: `Provider ${provider} is not configured.` });
      }

      const statePayload = generateOAuthState({
        provider: provider as 'google' | 'microsoft',
        redirectAfter: '/onboarding',
        pendingOrg: {
          name: orgName,
          contactEmail,
          ...(ico !== undefined && { ico }),
          dpaAcceptedAt,
        },
      });

      const scopes =
        provider === 'google'
          ? ['openid', 'profile', 'email']
          : ['openid', 'profile', 'email', 'offline_access'];
      const authUrl = oauthProvider.createAuthorizationURL(
        statePayload.state,
        statePayload.codeVerifier,
        scopes,
      );

      reply.setCookie(
        OAUTH_STATE_COOKIE,
        serializeOAuthState(statePayload, OAUTH_STATE_SECRET),
        oauthStateCookieOptions(),
      );

      fastify.log.info({ provider, orgName, contactEmail }, 'SSO registration initiated');

      return reply.code(200).send({
        type: 'oauth',
        authUrl: authUrl.toString(),
      });
    },
  );

  // ---------------------------------------------------------------------------
  // GET /v1/auth/me — current user info (Inventario JWT)
  // ---------------------------------------------------------------------------

  fastify.get('/v1/auth/me', async (request, reply) => {
    const token = request.cookies?.['inv_access'];
    if (!token) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    try {
      const payload = await fastify.inventarioJwt.verifyAccessToken(token);
      return reply.send({
        sub: payload.sub,
        org: payload.org,
        roles: payload.roles,
        email: payload.email,
        name: payload.name,
      });
    } catch {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }
  });
};

export default fp(registrationRoutesPlugin, {
  name: 'registration-routes',
  dependencies: ['config', 'mongo', 'inventario-jwt', 'email'],
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'org'
  );
}
