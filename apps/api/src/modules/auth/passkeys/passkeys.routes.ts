// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Passkeys / WebAuthn routes — ADR-0016, Slice #8.
 *
 * Endpoints:
 *   POST /v1/auth/passkeys/register/options  — generate registration challenge (auth)
 *   POST /v1/auth/passkeys/register/verify   — verify + store credential (auth)
 *   POST /v1/auth/passkeys/login/options     — generate authentication challenge (public)
 *   POST /v1/auth/passkeys/login/verify      — verify assertion + issue cookies (public)
 *   GET  /v1/auth/passkeys                   — list user's passkeys (auth)
 *   PATCH /v1/auth/passkeys/:id              — rename credential (auth)
 *   DELETE /v1/auth/passkeys/:id             — soft-delete credential (auth)
 *
 * Boot guard: if WEBAUTHN_RP_ID is not set, all endpoints return 503.
 * Consistent with MFA boot-guard pattern.
 *
 * Security notes:
 * - Credentials are GLOBAL (no tenant scope). One passkey works across all tenants.
 * - After successful login, server resolves default Membership → JWT with mid claim.
 * - Counter regression is ADVISORY (logged, not blocking) — synced platform passkeys
 *   (iCloud Keychain, Google PW Manager) don't reliably increment the counter.
 */

import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import fp from 'fastify-plugin';
import { ObjectId } from 'mongodb';
import { z } from 'zod';

import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
} from '../../../plugins/error-handler.js';
import { setAuthCookies } from '../cookie-helpers.js';

import { PasskeysRepository } from './passkeys.repository.js';

import type { Organisation, User } from '@inventario/shared-types';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { FastifyPluginAsync } from 'fastify';
import type { Db, WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const RegisterOptionsSchema = z.object({});

const RegisterVerifySchema = z.object({
  credential: z.record(z.string(), z.unknown()),
  challengeToken: z.string().min(20),
  deviceName: z.string().min(1).max(100).optional(),
});

const LoginOptionsSchema = z.object({
  email: z.string().email().toLowerCase().optional(),
});

const LoginVerifySchema = z.object({
  credential: z.record(z.string(), z.unknown()),
  challengeToken: z.string().min(20),
});

const RenameSchema = z.object({
  deviceName: z.string().min(1).max(100),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IS_TEST = process.env['NODE_ENV'] === 'test';

/** Best-effort device name from User-Agent string. */
function guessDeviceName(userAgent: string | undefined): string {
  if (!userAgent) return 'Passkey';
  if (/iPhone/i.test(userAgent)) return 'iPhone';
  if (/iPad/i.test(userAgent)) return 'iPad';
  if (/Macintosh|Mac OS/i.test(userAgent)) return 'Mac';
  if (/Android/i.test(userAgent)) return 'Android zariadenie';
  if (/Windows/i.test(userAgent)) return 'Windows PC';
  if (/Linux/i.test(userAgent)) return 'Linux PC';
  return 'Passkey';
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const passkeysRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const {
    WEBAUTHN_RP_ID,
    WEBAUTHN_RP_NAME,
    WEBAUTHN_EXPECTED_ORIGINS,
    JWT_ACCESS_TOKEN_TTL_SECONDS,
    JWT_REFRESH_TOKEN_TTL_DAYS,
  } = fastify.config;

  // -------------------------------------------------------------------------
  // Boot-time guard (consistent with MFA pattern)
  // -------------------------------------------------------------------------
  if (!WEBAUTHN_RP_ID) {
    fastify.log.warn('WEBAUTHN_RP_ID not set — passkey endpoints will return 503.');
    const notConfigured = async (
      _req: unknown,
      reply: { code: (n: number) => { send: (body: unknown) => unknown } },
    ): Promise<unknown> =>
      reply.code(503).send({ error: 'Passkeys are not configured on this server.' });

    fastify.post('/v1/auth/passkeys/register/options', notConfigured);
    fastify.post('/v1/auth/passkeys/register/verify', notConfigured);
    fastify.post('/v1/auth/passkeys/login/options', notConfigured);
    fastify.post('/v1/auth/passkeys/login/verify', notConfigured);
    fastify.get('/v1/auth/passkeys', notConfigured);
    fastify.patch('/v1/auth/passkeys/:id', notConfigured);
    fastify.delete('/v1/auth/passkeys/:id', notConfigured);
    return;
  }

  const rpID = WEBAUTHN_RP_ID;
  const rpName = WEBAUTHN_RP_NAME ?? 'Inventario';
  const expectedOrigins: string[] =
    WEBAUTHN_EXPECTED_ORIGINS && WEBAUTHN_EXPECTED_ORIGINS.length > 0
      ? WEBAUTHN_EXPECTED_ORIGINS
      : ['https://app.inventario.estate'];

  const db = fastify.mongo.db;
  const usersCol = db.collection<User>('users');
  const orgsCol = db.collection<Organisation>('organisations');
  const membershipsCol = db.collection('memberships');
  const passkeysRepo = new PasskeysRepository(db);

  // Init indexes once at startup
  await passkeysRepo.initIndexes();

  // =========================================================================
  // K6 — Registration
  // =========================================================================

  // POST /v1/auth/passkeys/register/options
  fastify.post(
    '/v1/auth/passkeys/register/options',
    { ...(IS_TEST ? {} : { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }) },
    async (request, reply) => {
      await fastify.requireAuth(request);
      await fastify.loadCurrentUser(request);
      const user = request.currentUser;
      const userId = String(user._id);

      RegisterOptionsSchema.parse(request.body ?? {});

      // Build excludeCredentials — prevent re-registering existing authenticators
      const existingPasskeys = await passkeysRepo.findByUserId(userId);
      const excludeCredentials = existingPasskeys.map((pk) => ({
        id: (pk as Record<string, unknown>)['credentialId'] as string,
        type: 'public-key' as const,
        transports: ((pk as Record<string, unknown>)['transports'] as string[] | undefined) ?? [],
      }));

      const { token, challenge } = await fastify.inventarioJwt.issueWebauthnChallenge(
        userId,
        'registration',
      );

      // Build PublicKeyCredentialCreationOptions
      const options = {
        rp: { id: rpID, name: rpName },
        user: {
          id: Buffer.from(userId).toString('base64url'),
          name: user.email,
          displayName: user.displayName,
        },
        challenge,
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' as const }, // ES256 (ECDSA P-256)
          { alg: -257, type: 'public-key' as const }, // RS256 (RSA)
        ],
        timeout: 300_000, // 5 minutes
        excludeCredentials,
        authenticatorSelection: {
          residentKey: 'preferred' as const,
          userVerification: 'required' as const,
        },
        attestation: 'none' as const,
      };

      fastify.log.info(
        { userId, excludeCount: excludeCredentials.length },
        'Passkey register options issued',
      );
      return reply.send({ options, challengeToken: token });
    },
  );

  // POST /v1/auth/passkeys/register/verify
  fastify.post(
    '/v1/auth/passkeys/register/verify',
    { ...(IS_TEST ? {} : { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }) },
    async (request, reply) => {
      await fastify.requireAuth(request);
      await fastify.loadCurrentUser(request);
      const user = request.currentUser;
      const userId = String(user._id);

      const body = RegisterVerifySchema.safeParse(request.body);
      if (!body.success) {
        throw new BadRequestError(body.error.issues[0]?.message ?? 'Neplatný vstup.');
      }
      const { credential, challengeToken, deviceName } = body.data;

      // Verify challenge token
      const { challenge, userId: tokenUserId } =
        await fastify.inventarioJwt.verifyWebauthnChallenge(challengeToken, 'registration');

      if (tokenUserId !== userId) {
        throw new UnauthorizedError('Challenge token user mismatch.');
      }

      // Verify registration response
      let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
      try {
        verification = await verifyRegistrationResponse({
          response: credential as unknown as RegistrationResponseJSON,
          expectedChallenge: challenge,
          expectedOrigin: expectedOrigins,
          expectedRPID: rpID,
          requireUserVerification: true,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Registration verification failed';
        fastify.log.warn({ userId, err: msg }, 'Passkey registration verification failed');
        throw new BadRequestError(`Registrácia passkey zlyhala: ${msg}`);
      }

      if (!verification.verified || !verification.registrationInfo) {
        throw new BadRequestError('Passkey registrácia nebola overená.');
      }

      const { registrationInfo } = verification;
      const credentialId = registrationInfo.credential.id;

      // Check for duplicate credentialId
      const existing = await passkeysRepo.findByCredentialId(credentialId);
      if (existing) {
        throw new BadRequestError(
          'Tento authenticator je už zaregistrovaný. Použite iné zariadenie.',
          { code: 'CREDENTIAL_EXISTS' },
        );
      }

      const now = new Date().toISOString();
      const resolvedDeviceName = deviceName ?? guessDeviceName(request.headers['user-agent']);

      // Determine authenticatorAttachment from response
      const attachment =
        (credential as Record<string, unknown>)['authenticatorAttachment'] === 'cross-platform'
          ? 'cross-platform'
          : (credential as Record<string, unknown>)['authenticatorAttachment'] === 'platform'
            ? 'platform'
            : null;

      const passkeyId = await passkeysRepo.insert({
        userId,
        credentialId,
        publicKey: Buffer.from(registrationInfo.credential.publicKey).toString('base64url'),
        counter: registrationInfo.credential.counter,
        transports: (registrationInfo.credential.transports ?? []) as string[],
        backupEligible: registrationInfo.credentialBackedUp ?? false,
        backedUp: registrationInfo.credentialBackedUp ?? false,
        authenticatorAttachment: attachment,
        deviceName: resolvedDeviceName,
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
        deletedAt: null,
        deletedBy: null,
      });

      // Update User convenience flag
      await usersCol.updateOne({ _id: user._id } as never, {
        $set: {
          passkeyEnabled: true,
          ...(!(user as Record<string, unknown>)['passkeyEnabledAt'] && { passkeyEnabledAt: now }),
          updatedAt: now,
        },
      });

      // Audit
      await db.collection('audit_logs').insertOne({
        action: 'PASSKEY_REGISTERED',
        severity: 'INFO',
        actor: {
          userId,
          email: user.email,
          displayName: user.displayName,
          accountType: user.accountType,
          ipAddress: request.ip ?? null,
          userAgent: request.headers['user-agent'] ?? null,
        },
        target: { entityType: 'Passkey', entityId: passkeyId },
        organisationId: request.inventarioClaims?.org ?? 'GLOBAL',
        description: `Passkey "${resolvedDeviceName}" zaregistrovaný`,
        changes: null,
        metadata: {
          deviceName: resolvedDeviceName,
          transports: registrationInfo.credential.transports,
          backedUp: registrationInfo.credentialBackedUp,
        },
        severity_: undefined,
        legalBasis: 'legitimate_interest',
        dataCategories: ['authentication'],
        isPseudonymized: false,
        createdAt: now,
      } as never);

      fastify.log.info({ userId, passkeyId, deviceName: resolvedDeviceName }, 'Passkey registered');
      return reply.code(201).send({
        passkey: {
          _id: passkeyId,
          deviceName: resolvedDeviceName,
          backedUp: registrationInfo.credentialBackedUp ?? false,
          transports: registrationInfo.credential.transports ?? [],
          authenticatorAttachment: attachment,
          createdAt: now,
          lastUsedAt: null,
        },
      });
    },
  );

  // =========================================================================
  // K7 — Authentication
  // =========================================================================

  // POST /v1/auth/passkeys/login/options  (public)
  fastify.post(
    '/v1/auth/passkeys/login/options',
    { ...(IS_TEST ? {} : { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } }) },
    async (request, reply) => {
      const body = LoginOptionsSchema.safeParse(request.body ?? {});
      if (!body.success) {
        throw new BadRequestError('Neplatný vstup.');
      }
      const { email } = body.data;

      let allowCredentials: { id: string; type: 'public-key'; transports: string[] }[] = [];
      let resolvedUserId: string | null = null;

      if (email) {
        const user = (await usersCol.findOne({
          email,
          deletedAt: null,
        })) as WithId<User> | null;

        if (user) {
          resolvedUserId = String(user._id);
          const passkeys = await passkeysRepo.findByUserId(resolvedUserId);
          allowCredentials = passkeys.map((pk) => ({
            id: (pk as Record<string, unknown>)['credentialId'] as string,
            type: 'public-key' as const,
            transports:
              ((pk as Record<string, unknown>)['transports'] as string[] | undefined) ?? [],
          }));
        }
        // If user not found: still issue options with empty allowCredentials
        // (don't leak email enumeration via different response structure)
      }

      const { token, challenge } = await fastify.inventarioJwt.issueWebauthnChallenge(
        resolvedUserId,
        'authentication',
      );

      const options = {
        rpId: rpID,
        challenge,
        allowCredentials,
        userVerification: 'required' as const,
        timeout: 300_000,
      };

      return reply.send({ options, challengeToken: token });
    },
  );

  // POST /v1/auth/passkeys/login/verify  (public)
  fastify.post(
    '/v1/auth/passkeys/login/verify',
    { ...(IS_TEST ? {} : { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }) },
    async (request, reply) => {
      const body = LoginVerifySchema.safeParse(request.body);
      if (!body.success) {
        throw new BadRequestError('Neplatný vstup.');
      }
      const { credential, challengeToken } = body.data;

      // Verify challenge token
      const { challenge } = await fastify.inventarioJwt.verifyWebauthnChallenge(
        challengeToken,
        'authentication',
      );

      // Find passkey by credentialId
      const credentialId = credential['id'] as string;
      if (!credentialId) throw new BadRequestError('Chýba credentialId.');

      const passkey = await passkeysRepo.findByCredentialId(credentialId);
      if (!passkey) {
        await emitLoginFailed(db, null, 'unknown-credential', request);
        throw new UnauthorizedError('Neznámy passkey. Skúste sa prihlásiť inak.');
      }

      const userId = (passkey as Record<string, unknown>)['userId'] as string;

      // Load user
      const user = (await usersCol.findOne({
        _id: new ObjectId(userId),
        deletedAt: null,
      } as never)) as WithId<User> | null;

      if (!user || !user.isActive) {
        await emitLoginFailed(db, userId, 'user-disabled', request);
        throw new UnauthorizedError('Účet nie je dostupný.');
      }

      // Verify assertion
      let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
      try {
        verification = await verifyAuthenticationResponse({
          response: credential as unknown as AuthenticationResponseJSON,
          expectedChallenge: challenge,
          expectedOrigin: expectedOrigins,
          expectedRPID: rpID,
          requireUserVerification: true,
          credential: {
            id: credentialId,
            publicKey: Buffer.from(
              (passkey as Record<string, unknown>)['publicKey'] as string,
              'base64url',
            ),
            counter: (passkey as Record<string, unknown>)['counter'] as number,
            transports: (passkey as Record<string, unknown>)['transports'] as
              string[] | undefined as never,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Authentication verification failed';
        fastify.log.warn({ userId, err: msg }, 'Passkey authentication verification failed');
        await emitLoginFailed(db, userId, 'invalid-assertion', request);
        throw new UnauthorizedError('Overenie passkey zlyhalo.');
      }

      if (!verification.verified) {
        await emitLoginFailed(db, userId, 'invalid-assertion', request);
        throw new UnauthorizedError('Overenie passkey zlyhalo.');
      }

      // Counter regression check (advisory)
      const newCounter = verification.authenticationInfo.newCounter;
      const oldCounter = (passkey as Record<string, unknown>)['counter'] as number;
      if (newCounter <= oldCounter && newCounter !== 0) {
        fastify.log.warn(
          { userId, credentialId: credentialId.slice(0, 12), oldCounter, newCounter },
          'Passkey counter regression detected (PASSKEY_COUNTER_WARNING)',
        );
        await db.collection('audit_logs').insertOne({
          action: 'PASSKEY_COUNTER_WARNING',
          severity: 'WARNING',
          actor: {
            userId,
            email: user.email,
            displayName: user.displayName,
            accountType: user.accountType,
            ipAddress: request.ip ?? null,
            userAgent: request.headers['user-agent'] ?? null,
          },
          target: {
            entityType: 'Passkey',
            entityId: String((passkey as Record<string, unknown>)['_id']),
          },
          organisationId: 'GLOBAL',
          description: 'Passkey counter regression — synced passkey alebo potenciálne clonovanie',
          changes: null,
          metadata: {
            expected: oldCounter + 1,
            received: newCounter,
            credentialIdPrefix: credentialId.slice(0, 12),
          },
          legalBasis: 'legitimate_interest',
          dataCategories: ['authentication'],
          isPseudonymized: false,
          createdAt: new Date().toISOString(),
        } as never);
      }

      // Update counter + lastUsedAt
      const now = new Date().toISOString();
      await passkeysRepo.updateAfterAuth(credentialId, newCounter, now);

      // Find default membership → resolve active org
      const defaultMembership = await membershipsCol.findOne({
        userId,
        isDefault: true,
        status: 'ACTIVE',
        deletedAt: null,
      });

      if (!defaultMembership) {
        throw new UnauthorizedError('Žiadny aktívny tenant. Kontaktujte správcu.');
      }

      const org = (await orgsCol.findOne({
        _id: new ObjectId(defaultMembership['organisationId'] as string),
        deletedAt: null,
      } as never)) as WithId<Organisation> | null;

      if (!org || org.status !== 'ACTIVE') {
        throw new UnauthorizedError('Organizácia nie je dostupná.');
      }

      // Update lastLoginAt + membership.lastAccessedAt
      await usersCol.updateOne({ _id: user._id } as never, { $set: { lastLoginAt: now } });
      await membershipsCol.updateOne(
        { _id: defaultMembership['_id'] },
        { $set: { lastAccessedAt: now } },
      );

      // Issue tokens
      const membershipId = String(defaultMembership['_id']);
      const accessToken = await fastify.inventarioJwt.issueAccessToken(
        user,
        org,
        membershipId,
        (defaultMembership['role'] as string) ?? 'EMPLOYEE',
      );
      const refreshToken = await fastify.inventarioJwt.issueRefreshToken(userId, request);

      setAuthCookies(
        reply,
        accessToken,
        refreshToken,
        JWT_ACCESS_TOKEN_TTL_SECONDS,
        JWT_REFRESH_TOKEN_TTL_DAYS,
      );

      // Audit PASSKEY_LOGIN
      await db.collection('audit_logs').insertOne({
        action: 'PASSKEY_LOGIN',
        severity: 'INFO',
        actor: {
          userId,
          email: user.email,
          displayName: user.displayName,
          accountType: user.accountType,
          ipAddress: request.ip ?? null,
          userAgent: request.headers['user-agent'] ?? null,
        },
        target: {
          entityType: 'Passkey',
          entityId: String((passkey as Record<string, unknown>)['_id']),
        },
        organisationId: String(org._id),
        description: 'Prihlásenie cez passkey',
        changes: null,
        metadata: {
          credentialIdPrefix: credentialId.slice(0, 12),
          counter: newCounter,
          via: (credential as Record<string, unknown>)['allowCredentials']
            ? 'allow-credentials'
            : 'discovery',
        },
        legalBasis: 'legitimate_interest',
        dataCategories: ['authentication'],
        isPseudonymized: false,
        createdAt: now,
      } as never);

      fastify.log.info(
        { userId, membershipId, orgId: String(org._id) },
        'Passkey login successful',
      );
      return reply.code(204).send();
    },
  );

  // =========================================================================
  // K8 — Management
  // =========================================================================

  // GET /v1/auth/passkeys
  fastify.get('/v1/auth/passkeys', async (request, reply) => {
    await fastify.requireAuth(request);
    await fastify.loadCurrentUser(request);
    const userId = String(request.currentUser._id);

    const passkeys = await passkeysRepo.findByUserId(userId);
    return reply.send({
      data: passkeys.map((pk) => {
        const p = pk as Record<string, unknown>;
        return {
          _id: String(p['_id']),
          deviceName: p['deviceName'],
          transports: p['transports'] ?? [],
          backedUp: p['backedUp'] ?? false,
          authenticatorAttachment: p['authenticatorAttachment'] ?? null,
          createdAt: p['createdAt'],
          lastUsedAt: p['lastUsedAt'] ?? null,
        };
      }),
    });
  });

  // PATCH /v1/auth/passkeys/:id — rename only
  fastify.patch(
    '/v1/auth/passkeys/:id',
    { ...(IS_TEST ? {} : { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }) },
    async (request, reply) => {
      await fastify.requireAuth(request);
      await fastify.loadCurrentUser(request);

      const { id } = request.params as { id: string };
      const body = RenameSchema.safeParse(request.body);
      if (!body.success) throw new BadRequestError('Neplatný vstup.');

      const userId = String(request.currentUser._id);
      const now = new Date().toISOString();

      const existing = await passkeysRepo.findByIdAndUser(id, userId);
      if (!existing) throw new NotFoundError('Passkey', id);

      const renamed = await passkeysRepo.rename(id, userId, body.data.deviceName, now);
      if (!renamed) throw new NotFoundError('Passkey', id);

      await db.collection('audit_logs').insertOne({
        action: 'PASSKEY_RENAMED',
        severity: 'INFO',
        actor: {
          userId,
          email: request.currentUser.email,
          displayName: request.currentUser.displayName,
          accountType: request.currentUser.accountType,
          ipAddress: request.ip ?? null,
          userAgent: request.headers['user-agent'] ?? null,
        },
        target: { entityType: 'Passkey', entityId: id },
        organisationId: request.inventarioClaims?.org ?? 'GLOBAL',
        description: `Passkey premenovaný na "${body.data.deviceName}"`,
        changes: [
          {
            field: 'deviceName',
            before: (existing as Record<string, unknown>)['deviceName'],
            after: body.data.deviceName,
          },
        ],
        metadata: {
          oldName: (existing as Record<string, unknown>)['deviceName'],
          newName: body.data.deviceName,
        },
        legalBasis: 'legitimate_interest',
        dataCategories: ['authentication'],
        isPseudonymized: false,
        createdAt: now,
      } as never);

      return reply.code(204).send();
    },
  );

  // DELETE /v1/auth/passkeys/:id
  fastify.delete(
    '/v1/auth/passkeys/:id',
    { ...(IS_TEST ? {} : { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }) },
    async (request, reply) => {
      await fastify.requireAuth(request);
      await fastify.loadCurrentUser(request);

      const { id } = request.params as { id: string };
      const userId = String(request.currentUser._id);
      const now = new Date().toISOString();

      const existing = await passkeysRepo.findByIdAndUser(id, userId);
      if (!existing) throw new NotFoundError('Passkey', id);

      const deleted = await passkeysRepo.softDelete(id, userId, userId, now);
      if (!deleted) throw new NotFoundError('Passkey', id);

      // Check if last passkey removed — clear convenience flag
      const remaining = await passkeysRepo.countActiveByUserId(userId);
      if (remaining === 0) {
        await usersCol.updateOne({ _id: request.currentUser._id } as never, {
          $set: { passkeyEnabled: false, updatedAt: now },
        });
      }

      await db.collection('audit_logs').insertOne({
        action: 'PASSKEY_REMOVED',
        severity: 'WARNING',
        actor: {
          userId,
          email: request.currentUser.email,
          displayName: request.currentUser.displayName,
          accountType: request.currentUser.accountType,
          ipAddress: request.ip ?? null,
          userAgent: request.headers['user-agent'] ?? null,
        },
        target: { entityType: 'Passkey', entityId: id },
        organisationId: request.inventarioClaims?.org ?? 'GLOBAL',
        description: `Passkey "${(existing as Record<string, unknown>)['deviceName']}" odstránený`,
        changes: null,
        metadata: {
          deviceName: (existing as Record<string, unknown>)['deviceName'],
          removedSelf: true,
          remainingCount: remaining,
        },
        legalBasis: 'legitimate_interest',
        dataCategories: ['authentication', 'audit_metadata'],
        isPseudonymized: false,
        createdAt: now,
      } as never);

      fastify.log.info({ userId, passkeyId: id, remainingCount: remaining }, 'Passkey removed');
      return reply.code(204).send();
    },
  );
};

export default fp(passkeysRoutesPlugin, {
  name: 'passkeys-routes',
  dependencies: ['config', 'mongo', 'inventario-jwt', 'auth'],
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function emitLoginFailed(
  db: Db,
  userId: string | null,
  reason: 'unknown-credential' | 'invalid-assertion' | 'user-disabled' | 'challenge-expired',
  request: { ip?: string; headers: Record<string, unknown> },
): Promise<void> {
  await db.collection('audit_logs').insertOne({
    action: 'PASSKEY_LOGIN_FAILED',
    severity: 'WARNING',
    actor: {
      userId: userId ?? 'UNKNOWN',
      displayName: 'unknown',
      accountType: 'SYSTEM',
      ipAddress: request.ip ?? null,
      userAgent: (request.headers['user-agent'] as string | undefined) ?? null,
    },
    target: null,
    organisationId: 'GLOBAL',
    description: `Passkey prihlásenie zlyhalo: ${reason}`,
    changes: null,
    metadata: { reason },
    legalBasis: 'legitimate_interest',
    dataCategories: ['authentication'],
    isPseudonymized: false,
    createdAt: new Date().toISOString(),
  } as never);
}
