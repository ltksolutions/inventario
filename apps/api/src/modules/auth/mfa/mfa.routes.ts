// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * TOTP MFA routes — Slice #7.
 *
 * Endpoints:
 *   POST /v1/auth/mfa/setup          — generate secret + QR + recovery codes (auth)
 *   POST /v1/auth/mfa/verify-setup   — confirm first code, activate MFA  (auth)
 *   POST /v1/auth/mfa/disable        — verify password, clear MFA         (auth)
 *   POST /v1/auth/mfa/challenge      — exchange mfaSessionToken + code → cookies (public)
 *   GET  /v1/auth/mfa/status         — return enabled + enabledAt         (auth)
 *
 * Boot guard: if `MFA_SECRET_ENCRYPTION_KEY` is not configured, the
 * plugin registers the routes but every call returns 503. This lets
 * the rest of the API run without MFA support during early dev.
 */

import { AccountType, type Organisation, type User } from '@inventario/shared-types';
import argon2 from 'argon2';
import fp from 'fastify-plugin';
import { ObjectId } from 'mongodb';
import { z } from 'zod';

import {
  decryptMfaSecret,
  encryptMfaSecret,
  findMatchingRecoveryHash,
  generateRecoveryCodes,
} from '../../../lib/mfa-crypto.js';
import { buildOtpauthUrl, generateTotpSecret, verifyTotpCode } from '../../../lib/totp.js';
import { BadRequestError, UnauthorizedError } from '../../../plugins/error-handler.js';
import { setAuthCookies } from '../cookie-helpers.js';

import type { FastifyPluginAsync } from 'fastify';
import type { WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const VerifySetupSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'TOTP code must be 6 digits'),
});

const ForcedSetupSchema = z.object({
  mfaSetupToken: z.string().min(20),
});

const ForcedVerifySchema = z.object({
  mfaSetupToken: z.string().min(20),
  code: z.string().regex(/^\d{6}$/, 'TOTP code must be 6 digits'),
});

const DisableSchema = z.object({
  password: z.string().min(1).max(128),
});

const ChallengeSchema = z.object({
  mfaSessionToken: z.string().min(20),
  /** Either a 6-digit TOTP code or a recovery code (8-9 chars with optional dash). */
  code: z.string().min(6).max(20),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const IS_TEST = process.env['NODE_ENV'] === 'test';

const mfaRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const { MFA_SECRET_ENCRYPTION_KEY, JWT_ACCESS_TOKEN_TTL_SECONDS, JWT_REFRESH_TOKEN_TTL_DAYS } =
    fastify.config;

  const db = fastify.mongo.db;
  const usersCol = db.collection<User>('users');
  const orgsCol = db.collection<Organisation>('organisations');

  // -------------------------------------------------------------------------
  // Boot-time guard
  // -------------------------------------------------------------------------
  //
  // If the symmetric encryption key isn't set, register the routes but
  // make every call return 503. This is friendlier than refusing to
  // start the server entirely (rest of the API still works).
  if (!MFA_SECRET_ENCRYPTION_KEY) {
    fastify.log.warn(
      'MFA_SECRET_ENCRYPTION_KEY not set — MFA endpoints will return 503. ' +
        'Generate with: openssl rand -hex 32',
    );
    const notConfigured = async (
      _req: unknown,
      reply: {
        code: (n: number) => { send: (body: unknown) => unknown };
      },
    ): Promise<unknown> => reply.code(503).send({ error: 'MFA is not configured on this server.' });

    fastify.post('/v1/auth/mfa/setup', notConfigured);
    fastify.post('/v1/auth/mfa/verify-setup', notConfigured);
    fastify.post('/v1/auth/mfa/disable', notConfigured);
    fastify.post('/v1/auth/mfa/challenge', notConfigured);
    fastify.get('/v1/auth/mfa/status', notConfigured);
    fastify.post('/v1/auth/mfa/forced-setup', notConfigured);
    fastify.post('/v1/auth/mfa/forced-verify', notConfigured);
    return;
  }

  // -------------------------------------------------------------------------
  // POST /v1/auth/mfa/setup
  // -------------------------------------------------------------------------
  // Generates a fresh TOTP secret + 8 recovery codes for the authenticated
  // user. STORES the encrypted secret and the argon2 hashes of the codes,
  // but does NOT set mfaEnabled=true yet. Activation happens after the
  // user confirms with verify-setup.
  //
  // Calling setup again before verify-setup overwrites the pending secret
  // (no harm — they haven't confirmed it yet).
  //
  // Calling setup when mfaEnabled is already true → 400. The user must
  // first disable MFA, then re-setup.
  fastify.post(
    '/v1/auth/mfa/setup',
    { ...(IS_TEST ? {} : { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }) },
    async (request, reply) => {
      await fastify.requireAuth(request);
      await fastify.loadCurrentUser(request);
      const user = request.currentUser;

      if (user.mfaEnabled === true) {
        throw new BadRequestError(
          'MFA is already enabled. Disable it first to set up a new authenticator.',
        );
      }

      const secretPlaintext = generateTotpSecret();
      const secretEncrypted = encryptMfaSecret(secretPlaintext, MFA_SECRET_ENCRYPTION_KEY);
      const { plaintext: recoveryPlain, hashes: recoveryHashes } = await generateRecoveryCodes();

      const now = new Date().toISOString();
      await usersCol.updateOne({ _id: user._id } as never, {
        $set: {
          mfaSecret: secretEncrypted,
          mfaRecoveryCodes: recoveryHashes,
          // mfaEnabled stays false until verify-setup succeeds
          updatedAt: now,
        },
      });

      const otpauthUrl = buildOtpauthUrl({
        issuer: 'Inventario',
        accountName: user.email,
        secret: secretPlaintext,
      });

      fastify.log.info(
        { userId: String(user._id), email: user.email },
        'MFA setup initiated (pending confirmation)',
      );

      return reply.code(200).send({
        /** Base32 secret — to be typed manually if QR can't be scanned. */
        secret: secretPlaintext,
        /** otpauth:// URL for QR-code rendering on the frontend. */
        otpauthUrl,
        /** Plaintext recovery codes — shown ONCE; user must save them. */
        recoveryCodes: recoveryPlain,
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /v1/auth/mfa/verify-setup
  // -------------------------------------------------------------------------
  // Confirms the pending secret by checking the first TOTP code the user
  // enters from their authenticator app. On success, flips mfaEnabled to
  // true and sets mfaEnabledAt.
  fastify.post(
    '/v1/auth/mfa/verify-setup',
    { ...(IS_TEST ? {} : { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }) },
    async (request, reply) => {
      await fastify.requireAuth(request);
      await fastify.loadCurrentUser(request);
      const user = request.currentUser;

      const parsed = VerifySetupSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid input');
      }

      if (user.mfaEnabled === true) {
        throw new BadRequestError('MFA is already enabled.');
      }

      // Need full doc with mfaSecret (loadCurrentUser doesn't project it out,
      // but for clarity re-fetch with explicit projection).
      const fullUser = (await usersCol.findOne({ _id: user._id } as never, {
        projection: { mfaSecret: 1 },
      })) as { mfaSecret: string | null } | null;

      if (!fullUser?.mfaSecret) {
        throw new BadRequestError('No pending MFA setup. Call POST /v1/auth/mfa/setup first.');
      }

      let secretPlain: string;
      try {
        secretPlain = decryptMfaSecret(fullUser.mfaSecret, MFA_SECRET_ENCRYPTION_KEY);
      } catch (err) {
        fastify.log.error({ err, userId: String(user._id) }, 'MFA secret decrypt failed');
        throw new BadRequestError('MFA setup is in an invalid state. Try setup again.');
      }

      const codeValid = verifyTotpCode(parsed.data.code, secretPlain);
      if (!codeValid) {
        throw new BadRequestError('Invalid code. Try again with a fresh code from your app.');
      }

      const now = new Date().toISOString();
      await usersCol.updateOne({ _id: user._id } as never, {
        $set: {
          mfaEnabled: true,
          mfaEnabledAt: now,
          updatedAt: now,
        },
      });

      fastify.log.info(
        { userId: String(user._id), email: user.email },
        'MFA setup confirmed and activated',
      );

      return reply.code(204).send();
    },
  );

  // -------------------------------------------------------------------------
  // POST /v1/auth/mfa/disable
  // -------------------------------------------------------------------------
  // Requires password re-entry for LOCAL accounts. For OAuth-only accounts
  // (no passwordHash), the request is rejected with a clear error — they
  // should disable via their identity provider or use a recovery code.
  fastify.post(
    '/v1/auth/mfa/disable',
    { ...(IS_TEST ? {} : { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }) },
    async (request, reply) => {
      await fastify.requireAuth(request);
      await fastify.loadCurrentUser(request);
      const user = request.currentUser;

      const parsed = DisableSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid input');
      }

      // Re-fetch with passwordHash for verification
      const fullUser = (await usersCol.findOne({ _id: user._id } as never, {
        projection: { passwordHash: 1 },
      })) as { passwordHash: string | null } | null;

      if (!fullUser?.passwordHash) {
        throw new BadRequestError(
          'Cannot verify password for OAuth-only account. Use a recovery code or contact admin.',
        );
      }

      const ok = await argon2.verify(fullUser.passwordHash, parsed.data.password);
      if (!ok) {
        throw new UnauthorizedError('Incorrect password.');
      }

      const now = new Date().toISOString();
      await usersCol.updateOne({ _id: user._id } as never, {
        $set: {
          mfaEnabled: false,
          mfaSecret: null,
          mfaRecoveryCodes: [],
          mfaEnabledAt: null,
          updatedAt: now,
        },
      });

      fastify.log.info(
        { userId: String(user._id), email: user.email },
        'MFA disabled (via password)',
      );

      return reply.code(204).send();
    },
  );

  // -------------------------------------------------------------------------
  // GET /v1/auth/mfa/status
  // -------------------------------------------------------------------------
  fastify.get('/v1/auth/mfa/status', async (request, reply) => {
    await fastify.requireAuth(request);
    await fastify.loadCurrentUser(request);
    const user = request.currentUser;

    return reply.send({
      enabled: user.mfaEnabled === true,
      enabledAt: user.mfaEnabledAt ?? null,
      recoveryCodesRemaining: user.mfaEnabled ? (user.mfaRecoveryCodes?.length ?? 0) : 0,
    });
  });

  // -------------------------------------------------------------------------
  // POST /v1/auth/mfa/forced-setup  (K12a)
  // -------------------------------------------------------------------------
  // Token-authenticated variant of /setup for the forced-MFA flow.
  // The caller provides the mfaSetupToken issued by POST /v1/auth/login/email
  // when org.settings.mfa.requireMfa is true and the user hasn't set up MFA.
  // Returns the same payload as /setup (secret, otpauthUrl, recoveryCodes).
  fastify.post(
    '/v1/auth/mfa/forced-setup',
    { ...(IS_TEST ? {} : { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }) },
    async (request, reply) => {
      const parsed = ForcedSetupSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid input');
      }

      const { sub: userId } = await fastify.inventarioJwt.verifyMfaSetupToken(
        parsed.data.mfaSetupToken,
      );
      if (!ObjectId.isValid(userId)) {
        throw new UnauthorizedError('Invalid MFA setup session.');
      }

      const user = (await usersCol.findOne({
        _id: new ObjectId(userId),
        deletedAt: null,
        isActive: true,
      } as never)) as WithId<User> | null;

      if (!user) {
        throw new UnauthorizedError('User not found or inactive.');
      }
      if (user.mfaEnabled === true) {
        throw new BadRequestError(
          'MFA is already enabled. Disable it first to set up a new authenticator.',
        );
      }

      const secretPlaintext = generateTotpSecret();
      const secretEncrypted = encryptMfaSecret(secretPlaintext, MFA_SECRET_ENCRYPTION_KEY);
      const { plaintext: recoveryPlain, hashes: recoveryHashes } = await generateRecoveryCodes();

      const now = new Date().toISOString();
      await usersCol.updateOne({ _id: user._id } as never, {
        $set: {
          mfaSecret: secretEncrypted,
          mfaRecoveryCodes: recoveryHashes,
          updatedAt: now,
        },
      });

      const otpauthUrl = buildOtpauthUrl({
        issuer: 'Inventario',
        accountName: user.email,
        secret: secretPlaintext,
      });

      fastify.log.info(
        { userId: String(user._id), email: user.email },
        'Forced MFA setup initiated',
      );

      return reply.code(200).send({
        secret: secretPlaintext,
        otpauthUrl,
        recoveryCodes: recoveryPlain,
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /v1/auth/mfa/forced-verify  (K12a)
  // -------------------------------------------------------------------------
  // Confirms the pending forced-setup secret and issues real auth cookies.
  // Accepts mfaSetupToken + 6-digit TOTP code. On success: enables MFA
  // and issues access + refresh cookies (same as a normal successful login).
  fastify.post(
    '/v1/auth/mfa/forced-verify',
    { ...(IS_TEST ? {} : { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }) },
    async (request, reply) => {
      const parsed = ForcedVerifySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid input');
      }
      const { mfaSetupToken, code } = parsed.data;

      const { sub: userId } = await fastify.inventarioJwt.verifyMfaSetupToken(mfaSetupToken);
      if (!ObjectId.isValid(userId)) {
        throw new UnauthorizedError('Invalid MFA setup session.');
      }

      // Fetch full user with mfaSecret
      const user = (await usersCol.findOne({
        _id: new ObjectId(userId),
        deletedAt: null,
        isActive: true,
      } as never)) as WithId<User> | null;

      if (!user) {
        throw new UnauthorizedError('User not found or inactive.');
      }
      if (user.mfaEnabled === true) {
        throw new BadRequestError('MFA is already active. Use /v1/auth/mfa/challenge instead.');
      }

      // Re-fetch mfaSecret (projected out by PUBLIC_PROJECTION in other places)
      const secretDoc = (await usersCol.findOne({ _id: user._id } as never, {
        projection: { mfaSecret: 1 },
      })) as { mfaSecret: string | null } | null;

      if (!secretDoc?.mfaSecret) {
        throw new BadRequestError(
          'No pending MFA setup. Call POST /v1/auth/mfa/forced-setup first.',
        );
      }

      let secretPlain: string;
      try {
        secretPlain = decryptMfaSecret(secretDoc.mfaSecret, MFA_SECRET_ENCRYPTION_KEY);
      } catch (err) {
        fastify.log.error({ err, userId }, 'MFA secret decrypt failed in forced-verify');
        throw new BadRequestError('MFA setup is in an invalid state. Try forced-setup again.');
      }

      if (!verifyTotpCode(code, secretPlain)) {
        throw new BadRequestError('Invalid code. Try again with a fresh code from your app.');
      }

      // Load org for token issuance
      const org = (await orgsCol.findOne({
        _id: new ObjectId(user.organisationId),
        deletedAt: null,
      } as never)) as WithId<Organisation> | null;

      if (!org || org.status !== 'ACTIVE') {
        throw new UnauthorizedError('Organisation unavailable.');
      }

      // Enable MFA
      const now = new Date().toISOString();
      await usersCol.updateOne({ _id: user._id } as never, {
        $set: {
          mfaEnabled: true,
          mfaEnabledAt: now,
          updatedAt: now,
        },
      });

      // Issue real auth cookies
      const accessToken = await fastify.inventarioJwt.issueAccessToken(user, org);
      const refreshToken = await fastify.inventarioJwt.issueRefreshToken(String(user._id), request);

      setAuthCookies(
        reply,
        accessToken,
        refreshToken,
        JWT_ACCESS_TOKEN_TTL_SECONDS,
        JWT_REFRESH_TOKEN_TTL_DAYS,
      );

      fastify.log.info(
        { userId: String(user._id), email: user.email },
        'Forced MFA setup confirmed — session issued',
      );

      return reply.code(204).send();
    },
  );

  // -------------------------------------------------------------------------
  // POST /v1/auth/mfa/challenge
  // -------------------------------------------------------------------------
  // Public endpoint (no auth cookies). Caller submits the mfaSessionToken
  // from the 202 response of /v1/auth/login/email plus either a TOTP
  // code or a recovery code. On success, normal access+refresh cookies
  // are set.
  fastify.post(
    '/v1/auth/mfa/challenge',
    { ...(IS_TEST ? {} : { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }) },
    async (request, reply) => {
      const parsed = ChallengeSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid input');
      }
      const { mfaSessionToken, code } = parsed.data;

      const { sub: userId } = await fastify.inventarioJwt.verifyMfaSessionToken(mfaSessionToken);
      if (!ObjectId.isValid(userId)) {
        throw new UnauthorizedError('Invalid MFA session.');
      }

      const user = (await usersCol.findOne({
        _id: new ObjectId(userId),
        deletedAt: null,
      } as never)) as WithId<User> | null;

      if (!user || !user.isActive) {
        throw new UnauthorizedError('User not found or inactive.');
      }
      if (!user.mfaEnabled || !user.mfaSecret) {
        throw new UnauthorizedError('MFA is not enabled for this user.');
      }

      // -- Try TOTP code first ---------------------------------------------
      let challengePassed = false;
      let recoveryHashToConsume: string | null = null;

      if (/^\d{6}$/.test(code)) {
        let secretPlain: string;
        try {
          secretPlain = decryptMfaSecret(user.mfaSecret, MFA_SECRET_ENCRYPTION_KEY);
        } catch (err) {
          fastify.log.error({ err, userId }, 'MFA secret decrypt failed at challenge');
          throw new UnauthorizedError('MFA verification failed.');
        }
        challengePassed = verifyTotpCode(code, secretPlain);
      }

      // -- Fall back to recovery code --------------------------------------
      if (!challengePassed) {
        const matched = await findMatchingRecoveryHash(code, user.mfaRecoveryCodes ?? []);
        if (matched !== null) {
          challengePassed = true;
          recoveryHashToConsume = matched;
        }
      }

      if (!challengePassed) {
        throw new UnauthorizedError('Invalid code.');
      }

      // -- Load org for token issuance -------------------------------------
      const org = (await orgsCol.findOne({
        _id: new ObjectId(user.organisationId),
        deletedAt: null,
      } as never)) as WithId<Organisation> | null;

      if (!org || org.status !== 'ACTIVE') {
        throw new UnauthorizedError('Organisation unavailable.');
      }

      // -- Consume recovery code if used -----------------------------------
      const now = new Date().toISOString();
      const updates: Record<string, unknown> = { lastLoginAt: now };
      if (recoveryHashToConsume) {
        updates['mfaRecoveryCodes'] = (user.mfaRecoveryCodes ?? []).filter(
          (h) => h !== recoveryHashToConsume,
        );
      }
      await usersCol.updateOne({ _id: user._id } as never, { $set: updates });

      // -- Issue tokens ----------------------------------------------------
      const accessToken = await fastify.inventarioJwt.issueAccessToken(user, org);
      const refreshToken = await fastify.inventarioJwt.issueRefreshToken(String(user._id), request);

      setAuthCookies(
        reply,
        accessToken,
        refreshToken,
        JWT_ACCESS_TOKEN_TTL_SECONDS,
        JWT_REFRESH_TOKEN_TTL_DAYS,
      );

      fastify.log.info(
        {
          userId: String(user._id),
          email: user.email,
          via: recoveryHashToConsume ? 'recovery' : 'totp',
        },
        'MFA challenge passed; session issued',
      );

      // Silence accountType unused-import warning when types reduce here.
      void AccountType;

      return reply.code(204).send();
    },
  );
};

export default fp(mfaRoutesPlugin, {
  name: 'mfa-routes',
  dependencies: ['config', 'mongo', 'inventario-jwt', 'auth'],
});
