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
  roles: string[];
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
   */
  issueAccessToken(
    user: WithId<User>,
    org: WithId<Organisation>,
    membershipId?: string,
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
    fastify.log.info(
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
    };
    fastify.decorate('inventarioJwt', stub);
    return;
  }

  let privateKey: KeyLike;
  let publicKey: KeyLike;
  try {
    privateKey = await importPKCS8(JWT_PRIVATE_KEY, 'RS256');
    publicKey = await importSPKI(JWT_PUBLIC_KEY, 'RS256');
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

    async issueAccessToken(user, org, membershipId) {
      const claims: Omit<InventarioJwtPayload, 'sub' | 'iss' | 'aud' | 'iat' | 'exp'> = {
        org: String(org._id),
        roles: user.roles,
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
  if (!Array.isArray(payload['roles'])) throw new UnauthorizedError('Token missing `roles` claim');
  if (typeof payload['email'] !== 'string')
    throw new UnauthorizedError('Token missing `email` claim');
  // `mid` is optional — do not throw if missing (backward compat with pre-K5 tokens)
}

function notConfigured(): never {
  throw new Error(
    'Inventario JWT service is not configured. Set JWT_PRIVATE_KEY and JWT_PUBLIC_KEY env vars.',
  );
}
