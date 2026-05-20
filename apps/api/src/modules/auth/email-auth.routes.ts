// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Email/password auth routes — K5 per ADR-0013.
 *
 * Endpoints:
 *   POST /v1/auth/register/email   → create org + ADMIN user, send verification email
 *   POST /v1/auth/login/email      → verify password, issue tokens
 *   GET  /v1/auth/verify-email     → confirm email address via token
 *   POST /v1/auth/forgot-password  → send password reset email
 *   POST /v1/auth/reset-password   → set new password via reset token
 *
 * Password hashing: argon2id (memory: 65536 KiB, iterations: 3, parallelism: 4).
 * This is the OWASP-recommended configuration as of 2025.
 *
 * Token storage: email verification and password reset tokens are stored
 * plaintext in the User document with an expiry timestamp. They are
 * single-use (cleared on first valid use). For MVP this is acceptable;
 * a future hardening pass can hash them too (tech debt noted).
 *
 * Email sending: K6 wires up nodemailer. K5 calls a stub
 * `fastify.emailService.send(...)` which logs in dev and sends in prod.
 * The stub is set up in this plugin if the real service isn't registered.
 *
 * Rate limiting: the login endpoint has a separate, tighter rate limit
 * (10 attempts per 15 min per IP) applied via `@fastify/rate-limit` per-route
 * config. Register + forgot-password are also tightly limited.
 */

import { randomBytes } from 'node:crypto';

import { AccountType, AuthProvider, MemberJoinPolicy, UserRole } from '@inventario/shared-types';
import argon2 from 'argon2';
import fp from 'fastify-plugin';
import { z } from 'zod';

import { BadRequestError, UnauthorizedError } from '../../plugins/error-handler.js';

import { setAuthCookies } from './cookie-helpers.js';

import type { Organisation, User } from '@inventario/shared-types';
import type { FastifyPluginAsync } from 'fastify';
import type { WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Argon2id config — OWASP recommended 2025
// ---------------------------------------------------------------------------

const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 65_536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
};

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

function tokenExpiresAt(ttlMinutes: number): string {
  return new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const RegisterEmailSchema = z.object({
  orgName: z.string().min(2).max(200).trim(),
  email: z.string().email().toLowerCase(),
  password: z.string().min(12).max(128),
  dpaAccepted: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the Data Processing Agreement to register.' }),
  }),
});

const LoginEmailSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1).max(128),
});

const ForgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase(),
});

const ResetPasswordSchema = z.object({
  token: z.string().length(64), // 32 bytes hex = 64 chars
  password: z.string().min(12).max(128),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const emailAuthRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const { FRONTEND_BASE_URL, JWT_ACCESS_TOKEN_TTL_SECONDS, JWT_REFRESH_TOKEN_TTL_DAYS } =
    fastify.config;

  const db = fastify.mongo.db;
  const usersCol = db.collection<User>('users');
  const orgsCol = db.collection<Organisation>('organisations');

  // -------------------------------------------------------------------------
  // POST /v1/auth/register/email
  // -------------------------------------------------------------------------

  fastify.post(
    '/v1/auth/register/email',
    {
      config: {
        rateLimit: { max: 5, timeWindow: '15 minutes' },
      },
    },
    async (request, reply) => {
      const body = RegisterEmailSchema.safeParse(request.body);
      if (!body.success) {
        throw new BadRequestError(body.error.issues[0]?.message ?? 'Invalid input');
      }
      const { orgName, email, password } = body.data;

      // Check if email already exists
      const existing = await usersCol.findOne({ email, deletedAt: null });
      if (existing) {
        throw new BadRequestError('Tento e-mail je už zaregistrovaný.');
      }

      // Hash password
      const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

      // Generate email verification token (24h TTL)
      const verificationToken = generateToken();
      const verificationExpiresAt = tokenExpiresAt(24 * 60);

      const now = new Date().toISOString();
      const slug = slugify(orgName);
      const slugExists = await orgsCol.findOne({ slug, deletedAt: null });
      const finalSlug = slugExists ? `${slug}-${Date.now().toString(36)}` : slug;

      // Insert org
      const orgInsert = await orgsCol.insertOne({
        displayName: orgName,
        slug: finalSlug,
        entraTenantId: null,
        customDomain: null,
        status: 'ACTIVE' as const,
        plan: 'FREE' as const,
        primaryContactEmail: email,
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
        dpaAcceptedAt: now,
        dpaAcceptedBy: null,
        createdAt: now,
        updatedAt: now,
        createdBy: 'SYSTEM',
        updatedBy: 'SYSTEM',
        deletedAt: null,
        deletedBy: null,
      } as never);

      const orgId = orgInsert.insertedId;

      // Insert user as ADMIN
      const userInsert = await usersCol.insertOne({
        organisationId: orgId.toString(),
        email,
        firstName: extractFirstName(email),
        lastName: '',
        displayName: email,
        accountType: AccountType.LOCAL,
        entraOid: null,
        authProviders: [
          {
            provider: AuthProvider.EMAIL,
            providerId: email,
            email,
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

      // Update org.registeredBy + dpaAcceptedBy
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

      // Send verification email
      const apiBase = fastify.config.OAUTH_REDIRECT_BASE_URL ?? 'http://localhost:3000';
      await fastify.emailService.sendVerificationEmail(email, verificationToken, apiBase);

      fastify.log.info({ userId: userId.toString(), email }, 'New email/password user registered');

      return reply.code(201).send({
        message: 'Registrácia úspešná. Skontrolujte e-mail a potvrďte svoju adresu.',
        emailVerificationRequired: true,
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /v1/auth/login/email
  // -------------------------------------------------------------------------

  fastify.post(
    '/v1/auth/login/email',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '15 minutes' },
      },
    },
    async (request, reply) => {
      const body = LoginEmailSchema.safeParse(request.body);
      if (!body.success) {
        throw new BadRequestError('Neplatný e-mail alebo heslo.');
      }
      const { email, password } = body.data;

      // Look up user
      const user = (await usersCol.findOne({
        email,
        deletedAt: null,
      })) as WithId<User> | null;

      // Constant-time: always hash even if user not found (prevent timing attacks)
      const dummyHash =
        '$argon2id$v=19$m=65536,t=3,p=4$dummysalt1234567890123456789012$dummyhash1234567890123456789012345678901234567890';
      const hashToVerify = user?.passwordHash ?? dummyHash;

      let passwordValid: boolean;
      try {
        passwordValid = await argon2.verify(hashToVerify, password);
      } catch {
        passwordValid = false;
      }

      if (!user || !passwordValid) {
        throw new UnauthorizedError('Nesprávny e-mail alebo heslo.');
      }

      if (!user.isActive) {
        throw new UnauthorizedError('Váš účet je deaktivovaný. Kontaktujte správcu.');
      }

      if (!user.emailVerified) {
        // Don't issue tokens until email is verified
        return reply.code(403).send({
          error: 'EMAIL_NOT_VERIFIED',
          message: 'Najprv potvrďte svoju e-mailovú adresu. Skontrolujte doručenú poštu.',
        });
      }

      // Load organisation
      const { ObjectId } = await import('mongodb');
      const org = (await orgsCol.findOne({
        _id: new ObjectId(user.organisationId),
        deletedAt: null,
      } as never)) as WithId<Organisation> | null;

      if (!org || org.status !== 'ACTIVE') {
        throw new UnauthorizedError('Organizácia nie je dostupná.');
      }

      // Check provider allowed
      if (!org.allowedAuthProviders.includes(AuthProvider.EMAIL)) {
        throw new UnauthorizedError(
          'Vaša organizácia nepovoľuje prihlásenie e-mailom. Použite SSO.',
        );
      }

      // Touch lastLoginAt
      await usersCol.updateOne({ _id: user._id } as never, {
        $set: { lastLoginAt: new Date().toISOString() },
      });

      // Issue tokens
      const accessToken = await fastify.inventarioJwt.issueAccessToken(user, org);
      const refreshToken = await fastify.inventarioJwt.issueRefreshToken(String(user._id), request);

      setAuthCookies(
        reply,
        accessToken,
        refreshToken,
        JWT_ACCESS_TOKEN_TTL_SECONDS,
        JWT_REFRESH_TOKEN_TTL_DAYS,
      );

      fastify.log.info({ userId: String(user._id), email }, 'Email/password login successful');
      return reply.code(204).send();
    },
  );

  // -------------------------------------------------------------------------
  // GET /v1/auth/verify-email
  // -------------------------------------------------------------------------

  fastify.get<{ Querystring: { token?: string } }>(
    '/v1/auth/verify-email',
    async (request, reply) => {
      const { token } = request.query;
      if (!token || token.length !== 64) {
        return reply.redirect(`${FRONTEND_BASE_URL}/login?error=invalid_verification_token`);
      }

      const now = new Date().toISOString();
      const user = (await usersCol.findOne({
        emailVerificationToken: token,
        emailVerificationExpiresAt: { $gt: now } as never,
        deletedAt: null,
      })) as WithId<User> | null;

      if (!user) {
        return reply.redirect(`${FRONTEND_BASE_URL}/login?error=verification_token_expired`);
      }

      // Mark verified, clear token
      await usersCol.updateOne({ _id: user._id } as never, {
        $set: {
          emailVerified: true,
          emailVerificationToken: null,
          emailVerificationExpiresAt: null,
          updatedAt: now,
        },
      });

      fastify.log.info({ userId: String(user._id), email: user.email }, 'Email verified');
      return reply.redirect(`${FRONTEND_BASE_URL}/login?verified=true`);
    },
  );

  // -------------------------------------------------------------------------
  // POST /v1/auth/forgot-password
  // -------------------------------------------------------------------------

  fastify.post(
    '/v1/auth/forgot-password',
    {
      config: {
        rateLimit: { max: 5, timeWindow: '15 minutes' },
      },
    },
    async (request, reply) => {
      const body = ForgotPasswordSchema.safeParse(request.body);
      if (!body.success) {
        // Always return 204 — don't reveal if email exists
        return reply.code(204).send();
      }
      const { email } = body.data;

      const user = (await usersCol.findOne({
        email,
        deletedAt: null,
        isActive: true,
      })) as WithId<User> | null;

      if (user && user.passwordHash) {
        // Only email/password users can reset via email
        const resetToken = generateToken();
        const resetExpiresAt = tokenExpiresAt(60); // 1 hour
        const now = new Date().toISOString();

        await usersCol.updateOne({ _id: user._id } as never, {
          $set: {
            passwordResetToken: resetToken,
            passwordResetExpiresAt: resetExpiresAt,
            updatedAt: now,
          },
        });

        await fastify.emailService.sendPasswordResetEmail(
          email,
          resetToken,
          fastify.config.FRONTEND_BASE_URL,
        );
        fastify.log.info({ userId: String(user._id), email }, 'Password reset email sent');
      }

      // Always 204 — don't reveal if email exists
      return reply.code(204).send();
    },
  );

  // -------------------------------------------------------------------------
  // POST /v1/auth/reset-password
  // -------------------------------------------------------------------------

  fastify.post('/v1/auth/reset-password', async (request, reply) => {
    const body = ResetPasswordSchema.safeParse(request.body);
    if (!body.success) {
      throw new BadRequestError(body.error.issues[0]?.message ?? 'Invalid input');
    }
    const { token, password } = body.data;

    const now = new Date().toISOString();
    const user = (await usersCol.findOne({
      passwordResetToken: token,
      passwordResetExpiresAt: { $gt: now } as never,
      deletedAt: null,
    })) as WithId<User> | null;

    if (!user) {
      throw new BadRequestError('Odkaz na obnovenie hesla je neplatný alebo vypršal.');
    }

    const newHash = await argon2.hash(password, ARGON2_OPTIONS);

    await usersCol.updateOne({ _id: user._id } as never, {
      $set: {
        passwordHash: newHash,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
        updatedAt: now,
      },
    });

    // Revoke all active refresh tokens — new password = all sessions invalidated
    await fastify.inventarioJwt.revokeAllForUser(String(user._id));

    fastify.log.info({ userId: String(user._id), email: user.email }, 'Password reset successful');
    return reply.code(204).send();
  });
};

export default fp(emailAuthRoutesPlugin, {
  name: 'email-auth-routes',
  dependencies: ['config', 'mongo', 'inventario-jwt'],
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

function extractFirstName(email: string): string {
  return email.split('@')[0] ?? 'User';
}
