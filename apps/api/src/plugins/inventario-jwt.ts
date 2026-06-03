// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Inventario JWT plugin — ADR-0013, ADR-0015.
 *
 * Issues and verifies Inventario's own RS256-signed access tokens.
 *
 * K5 (Slice #9b): JWT payload extended with `mid` claim (membershipId).
 * `issueAccessToken` now accepts an optional `membershipId` parameter.
 * When present, the token carries `mid` so the auth middleware can
 * validate the active membership on every request (K6).
 *
 * Backward compat: `mid` is optional in the payload type so existing
 * tokens (without `mid`) continue to verify. Auth middleware handles
 * the missing-mid case by fetching the default membership from DB.
 */

import fp from 'fastify-plugin';
import { SignJWT, importPKCS8, importSPKI, jwtVerify, type JWTPayload, type KeyLike } from 'jose';

import { RefreshTokensRepository } from '../modules/auth/refresh-tokens.repository.js';

import { UnauthorizedError } from './error-handler.js';

import type { Organisation, User } from '@inventario/shared-types';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// JWT payload shape
// ---------------------------------------------------------------------------

export interface InventarioJwtPayload extends JWTPayload {
  sub: string; // user _id (global identity)
  org: string; // active organisationId
  /** Active membershipId (ADR-0015 K5). Optional for backward compat with pre-K5 tokens. */
  mid?: string;
  /** Per-tenant role (ADR-0029). Single value. Legacy tokens may carry `roles[]` instead. */
  role?: string;
  /** @deprecated Legacy multi-role claim (pre-ADR-0029). Tolerated for backward compat. */
  roles?: string[];
  email: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface InventarioJwtService {
  /**
   * Sign and return an access token for a user.
   *
   * @param user          - Global user document
   * @param org           - Active organisation
   * @param membershipId  - Active membership _id (optional; omitted for
   *                        legacy flows until K6 wires memberships fully)
   * @param role          - Per-tenant role, sourced from the active
   *                        Membership (ADR-0015 + ADR-0029). Single value.
   *                        NOT from user.roles (deprecated legacy array).
   */
  issueAccessToken(
    user: WithId<User>,
    org: WithId<Organisation>,
    membershipId: string | undefined,
    role: string,
  ): Promise<string>;

  /**
   * Verify an Inventario access token. Returns the payload on success.
   * Throws UnauthorizedError on invalid/expired tokens.
   */
  verifyAccessToken(token: string): Promise<InventarioJwtPayload>;

  issueMfaSessionToken(userId: string): Promise<string>;
  verifyMfaSessionToken(token: string): Promise<{ sub: string }>;
  issueMfaSetupToken(userId: string): Promise<string>;
  verifyMfaSetupToken(token: string): Promise<{ sub: string }>;

  issueRefreshToken(userId: string, request?: FastifyRequest): Promise<string>;
  rotateRefreshToken(
    rawToken: string,
    request?: FastifyRequest,
  ): Promise<{ newRawToken: string; userId: string }>;
  revokeRefreshToken(rawToken: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<number>;

  /**
   * Issue a short-lived challenge token for WebAuthn ceremonies.
   *
   * @param userId  - Owner user _id (null for passwordless discovery flow)
   * @param purpose - 'registration' or 'authentication'
   * @returns { token, challenge } — token for client to return, challenge for browser API
   */
  issueWebauthnChallenge(
    userId: string | null,
    purpose: 'registration' | 'authentication',
  ): Promise<{ token: string; challenge: string }>;

  /**
   * Verify a WebAuthn challenge token.
   * Returns { challenge, userId } — userId may be null for discovery flow.
   */
  verifyWebauthnChallenge(
    token: string,
    purpose: 'registration' | 'authentication',
  ): Promise<{ challenge: string; userId: string | null }>;

  readonly isConfigured: boolean;
}

// ---------------------------------------------------------------------------
// Fastify decoration
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyInstance {
    inventarioJwt: InventarioJwtService;
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const inventarioJwtPlugin: FastifyPluginAsync = async (fastify) => {
  const {
    JWT_PRIVATE_KEY,
    JWT_PUBLIC_KEY,
    JWT_ACCESS_TOKEN_TTL_SECONDS,
    JWT_REFRESH_TOKEN_TTL_DAYS,
  } = fastify.config;

  if (!JWT_PRIVATE_KEY || !JWT_PUBLIC_KEY) {
    fastify.log.warn(
      'JWT_PRIVATE_KEY / JWT_PUBLIC_KEY not set — Inventario JWT service is in stub mode.',
    );
    const stub: InventarioJwtService = {
      isConfigured: false,
      issueAccessToken: notConfigured,
      verifyAccessToken: notConfigured,
      issueMfaSessionToken: notConfigured,
      verifyMfaSessionToken: notConfigured,
      issueMfaSetupToken: notConfigured,
      verifyMfaSetupToken: notConfigured,
      issueRefreshToken: notConfigured,
      rotateRefreshToken: notConfigured,
      revokeRefreshToken: notConfigured,
      revokeAllForUser: notConfigured,
      issueWebauthnChallenge: notConfigured,
      verifyWebauthnChallenge: notConfigured,
    };
    fastify.decorate('inventarioJwt', stub);
    return;
  }

  let privateKey: KeyLike;
  let publicKey: KeyLike;
  try {
    // Keys may be stored in different formats to avoid multiline env var issues:
    // 1. Raw PEM (starts with -----) — used directly
    // 2. PEM with literal \n (e.g. "-----BEGIN...\nMII...\n-----END...")
    // 3. Base64-encoded PEM — decoded first
    const normalizeKey = (raw: string): string => {
      const trimmed = raw.trim();
      if (trimmed.startsWith('-----')) return trimmed;
      // Check for literal \n sequences (escaped newlines)
      if (trimmed.includes('\\n')) return trimmed.replace(/\\n/g, '\n');
      // Otherwise assume base64
      return Buffer.from(trimmed, 'base64').toString('utf-8');
    };
    const privateKeyPem = normalizeKey(JWT_PRIVATE_KEY);
    const publicKeyPem = normalizeKey(JWT_PUBLIC_KEY);
    privateKey = await importPKCS8(privateKeyPem, 'RS256');
    publicKey = await importSPKI(publicKeyPem, 'RS256');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to import JWT key material: ${msg}. Check JWT_PRIVATE_KEY / JWT_PUBLIC_KEY format.`,
    );
  }

  const refreshTokens = new RefreshTokensRepository(fastify.mongo.db);
  await refreshTokens.ensureIndexes();

  fastify.log.info(
    { ttlSeconds: JWT_ACCESS_TOKEN_TTL_SECONDS, refreshTtlDays: JWT_REFRESH_TOKEN_TTL_DAYS },
    'Inventario JWT service initialized',
  );

  const service: InventarioJwtService = {
    isConfigured: true,

    async issueAccessToken(user, org, membershipId, role) {
      const claims: Omit<InventarioJwtPayload, 'sub' | 'iss' | 'aud' | 'iat' | 'exp'> = {
        org: String(org._id),
        // Role is per-tenant and authoritative on the Membership
        // (ADR-0015 + ADR-0029). Single value, not an array.
        role: role,
        email: user.email,
        name: user.displayName,
      };
      // Include mid claim only when membershipId is provided (K5).
      // Omitting it keeps tokens compact for flows that don't use memberships yet.
      if (membershipId) {
        claims.mid = membershipId;
      }

      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject(String(user._id))
        .setIssuer('inventario')
        .setAudience('inventario-api')
        .setIssuedAt()
        .setExpirationTime(`${JWT_ACCESS_TOKEN_TTL_SECONDS}s`)
        .sign(privateKey);
    },

    async verifyAccessToken(token) {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, publicKey, {
          issuer: 'inventario',
          audience: 'inventario-api',
          algorithms: ['RS256'],
          clockTolerance: 30,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Token verification failed';
        fastify.log.warn({ errMsg: msg }, 'JWT verification failed');
        throw new UnauthorizedError(msg);
      }
      assertInventarioPayload(payload);
      return payload;
    },

    async issueMfaSessionToken(userId) {
      return new SignJWT({ purpose: 'mfa_challenge' })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject(userId)
        .setIssuer('inventario')
        .setAudience('inventario-mfa-challenge')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
    },

    async verifyMfaSessionToken(token) {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, publicKey, {
          issuer: 'inventario',
          audience: 'inventario-mfa-challenge',
          algorithms: ['RS256'],
          clockTolerance: 5,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'MFA session verification failed';
        throw new UnauthorizedError(msg);
      }
      if (typeof payload.sub !== 'string' || payload.sub.length === 0)
        throw new UnauthorizedError('MFA session token missing sub claim');
      if (payload['purpose'] !== 'mfa_challenge')
        throw new UnauthorizedError('MFA session token wrong purpose');
      return { sub: payload.sub };
    },

    async issueMfaSetupToken(userId) {
      return new SignJWT({ purpose: 'mfa_setup' })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject(userId)
        .setIssuer('inventario')
        .setAudience('inventario-mfa-setup')
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(privateKey);
    },

    async verifyMfaSetupToken(token) {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, publicKey, {
          issuer: 'inventario',
          audience: 'inventario-mfa-setup',
          algorithms: ['RS256'],
          clockTolerance: 5,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'MFA setup token verification failed';
        throw new UnauthorizedError(msg);
      }
      if (typeof payload.sub !== 'string' || payload.sub.length === 0)
        throw new UnauthorizedError('MFA setup token missing sub claim');
      if (payload['purpose'] !== 'mfa_setup')
        throw new UnauthorizedError('MFA setup token wrong purpose');
      return { sub: payload.sub };
    },

    async issueRefreshToken(userId, request) {
      return refreshTokens.create({
        userId,
        ttlDays: JWT_REFRESH_TOKEN_TTL_DAYS,
        userAgent: request?.headers['user-agent'] ?? null,
        ipAddress: request?.ip ?? null,
      });
    },

    async rotateRefreshToken(rawToken, request) {
      const doc = await refreshTokens.findByRawToken(rawToken);
      if (!doc) throw new UnauthorizedError('Refresh token not found');
      if (doc.revokedAt !== null) {
        await refreshTokens.revokeAllForUser(doc.userId);
        fastify.log.warn(
          { userId: doc.userId },
          'Refresh token reuse detected — revoked all sessions',
        );
        throw new UnauthorizedError('Refresh token has already been used');
      }
      if (doc.expiresAt < new Date()) throw new UnauthorizedError('Refresh token has expired');

      const newRawToken = await refreshTokens.rotate({
        oldRawToken: rawToken,
        userId: doc.userId,
        ttlDays: JWT_REFRESH_TOKEN_TTL_DAYS,
        userAgent: request?.headers['user-agent'] ?? null,
        ipAddress: request?.ip ?? null,
      });
      return { newRawToken, userId: doc.userId };
    },

    async revokeRefreshToken(rawToken) {
      await refreshTokens.revoke(rawToken);
    },

    async revokeAllForUser(userId) {
      return refreshTokens.revokeAllForUser(userId);
    },

    async issueWebauthnChallenge(userId, purpose) {
      // 32 random bytes as base64url challenge (WebAuthn spec minimum 16 bytes)
      const challengeBytes = crypto.getRandomValues(new Uint8Array(32));
      const challenge = Buffer.from(challengeBytes).toString('base64url');

      const audience = `inventario-webauthn-${purpose}`;
      const payload: Record<string, unknown> = { purpose, challenge };
      if (userId !== null) payload['userId'] = userId;

      const token = await new SignJWT(payload)
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer('inventario')
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);

      return { token, challenge };
    },

    async verifyWebauthnChallenge(token, purpose) {
      const audience = `inventario-webauthn-${purpose}`;
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, publicKey, {
          issuer: 'inventario',
          audience,
          algorithms: ['RS256'],
          clockTolerance: 5,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'WebAuthn challenge verification failed';
        throw new UnauthorizedError(msg);
      }
      const challenge = payload['challenge'];
      if (typeof challenge !== 'string' || challenge.length === 0) {
        throw new UnauthorizedError('WebAuthn challenge token missing challenge claim');
      }
      if (payload['purpose'] !== purpose) {
        throw new UnauthorizedError('WebAuthn challenge token wrong purpose');
      }
      const userId = typeof payload['userId'] === 'string' ? payload['userId'] : null;
      return { challenge, userId };
    },
  };

  fastify.decorate('inventarioJwt', service);
};

export default fp(inventarioJwtPlugin, {
  name: 'inventario-jwt',
  dependencies: ['config', 'mongo'],
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertInventarioPayload(
  payload: JWTPayload,
): asserts payload is JWTPayload & InventarioJwtPayload {
  if (typeof payload['sub'] !== 'string' || payload['sub'].length === 0)
    throw new UnauthorizedError('Token missing `sub` claim');
  if (typeof payload['org'] !== 'string' || payload['org'].length === 0)
    throw new UnauthorizedError('Token missing `org` claim');
  // ADR-0029: accept either the new single `role` claim or the legacy
  // `roles[]` array (backward compat — no forced re-login). The role is
  // re-resolved authoritatively from the DB membership anyway, so a missing
  // claim is not fatal; we only sanity-check the type when present.
  const hasRole = typeof payload['role'] === 'string';
  const hasLegacyRoles = Array.isArray(payload['roles']);
  if (!hasRole && !hasLegacyRoles) throw new UnauthorizedError('Token missing `role` claim');
  if (typeof payload['email'] !== 'string')
    throw new UnauthorizedError('Token missing `email` claim');
  // `mid` is optional — do not throw if missing (backward compat with pre-K5 tokens)
}

function notConfigured(): never {
  throw new Error(
    '[STUB_MODE] Inventario JWT service is not configured. Set JWT_PRIVATE_KEY and JWT_PUBLIC_KEY env vars.',
  );
}
