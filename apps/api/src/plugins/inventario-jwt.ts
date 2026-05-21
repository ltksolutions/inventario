// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Inventario JWT plugin — ADR-0013.
 *
 * Issues and verifies Inventario's own RS256-signed access tokens.
 * Replaces the Entra ID JWKS path for clients using the new auth flow.
 *
 * What this plugin provides:
 *   app.inventarioJwt.issueAccessToken(user, org)  → signed JWT string
 *   app.inventarioJwt.verifyAccessToken(token)     → InventarioJwtPayload
 *   app.inventarioJwt.issueRefreshToken(...)       → raw opaque token
 *   app.inventarioJwt.rotateRefreshToken(...)      → new raw token
 *   app.inventarioJwt.revokeRefreshToken(raw)      → void
 *   app.inventarioJwt.revokeAllForUser(userId)     → count
 *
 * Cookie transport:
 *   The route handlers (K8) set httpOnly cookies. This plugin only deals
 *   with token creation and verification — it has no opinion on transport.
 *
 * Key material:
 *   JWT_PRIVATE_KEY and JWT_PUBLIC_KEY are PEM-encoded RS256 keys loaded
 *   from environment variables. If not set, the plugin skips initialization
 *   and all methods throw "JWT keys not configured". This allows the
 *   existing MSAL auth path (auth.ts) to continue working during the
 *   transition period (until K17 cutover).
 *
 * Refresh tokens:
 *   See refresh-tokens.repository.ts. Raw tokens are 256-bit random hex
 *   strings; only SHA-256 hashes are stored in MongoDB.
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
  sub: string; // user _id
  org: string; // organisationId
  roles: string[];
  email: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Service interface decorated onto Fastify
// ---------------------------------------------------------------------------

export interface InventarioJwtService {
  /**
   * Sign and return an access token for a user. Short-lived (15 min default).
   */
  issueAccessToken(user: WithId<User>, org: WithId<Organisation>): Promise<string>;

  /**
   * Verify an Inventario access token. Returns the payload on success.
   * Throws UnauthorizedError on invalid/expired tokens.
   */
  verifyAccessToken(token: string): Promise<InventarioJwtPayload>;

  /**
   * Issue a short-lived MFA challenge session token (Slice #7).
   *
   * Used in the login flow when a user has MFA enabled: after password
   * verification succeeds, we issue this token instead of access cookies.
   * The frontend submits it back together with the TOTP code to
   * `POST /v1/auth/mfa/challenge`, which exchanges it for normal
   * access+refresh cookies.
   *
   * Audience is `inventario-mfa-challenge` (distinct from access
   * tokens' `inventario-api`), so a stolen MFA token cannot be used
   * as a session cookie. TTL is 5 minutes.
   */
  issueMfaSessionToken(userId: string): Promise<string>;

  /**
   * Verify an MFA challenge session token. Returns the `sub` (userId)
   * on success. Throws `UnauthorizedError` on invalid / expired tokens.
   */
  verifyMfaSessionToken(token: string): Promise<{ sub: string }>;

  /**
   * Create a new refresh token for a user and persist its hash.
   * Returns the raw token to be set as an httpOnly cookie.
   */
  issueRefreshToken(userId: string, request?: FastifyRequest): Promise<string>;

  /**
   * Validate a raw refresh token and rotate it: revoke old, issue new.
   * Returns the new raw token to replace the cookie.
   * Throws UnauthorizedError if token is expired, revoked, or unknown.
   */
  rotateRefreshToken(
    rawToken: string,
    request?: FastifyRequest,
  ): Promise<{ newRawToken: string; userId: string }>;

  /**
   * Revoke a single refresh token (logout).
   */
  revokeRefreshToken(rawToken: string): Promise<void>;

  /**
   * Revoke all refresh tokens for a user (password change, security event).
   * Returns count of revoked tokens.
   */
  revokeAllForUser(userId: string): Promise<number>;

  /** Whether the JWT service is fully configured (keys present). */
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

  // If keys are not configured, register a stub service that fails loudly.
  // This lets the existing MSAL auth path continue working during the
  // transition period (Slice #6a → K17 cutover).
  if (!JWT_PRIVATE_KEY || !JWT_PUBLIC_KEY) {
    fastify.log.info(
      'JWT_PRIVATE_KEY / JWT_PUBLIC_KEY not set — Inventario JWT service is in stub mode. ' +
        'Set both env vars to enable the new auth flow (ADR-0013).',
    );

    const stub: InventarioJwtService = {
      isConfigured: false,
      issueAccessToken: notConfigured,
      verifyAccessToken: notConfigured,
      issueMfaSessionToken: notConfigured,
      verifyMfaSessionToken: notConfigured,
      issueRefreshToken: notConfigured,
      rotateRefreshToken: notConfigured,
      revokeRefreshToken: notConfigured,
      revokeAllForUser: notConfigured,
    };
    fastify.decorate('inventarioJwt', stub);
    return;
  }

  // Import key material once at plugin init time.
  // `importPKCS8` → private key for signing.
  // `importSPKI`  → public key for verification.
  let privateKey: KeyLike;
  let publicKey: KeyLike;
  try {
    privateKey = await importPKCS8(JWT_PRIVATE_KEY, 'RS256');
    publicKey = await importSPKI(JWT_PUBLIC_KEY, 'RS256');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to import JWT key material: ${msg}. Check JWT_PRIVATE_KEY / JWT_PUBLIC_KEY format (PEM PKCS8/SPKI).`,
    );
  }

  // Refresh token repository — shares the MongoDB connection from the mongo plugin.
  const refreshTokens = new RefreshTokensRepository(fastify.mongo.db);
  await refreshTokens.ensureIndexes();

  fastify.log.info(
    { ttlSeconds: JWT_ACCESS_TOKEN_TTL_SECONDS, refreshTtlDays: JWT_REFRESH_TOKEN_TTL_DAYS },
    'Inventario JWT service initialized',
  );

  // -------------------------------------------------------------------------
  // Service implementation
  // -------------------------------------------------------------------------

  const service: InventarioJwtService = {
    isConfigured: true,

    async issueAccessToken(user, org) {
      return new SignJWT({
        org: String(org._id),
        roles: user.roles,
        email: user.email,
        name: user.displayName,
      } satisfies Omit<InventarioJwtPayload, 'sub' | 'iss' | 'aud' | 'iat' | 'exp'>)
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
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new UnauthorizedError('MFA session token missing sub claim');
      }
      if (payload['purpose'] !== 'mfa_challenge') {
        throw new UnauthorizedError('MFA session token wrong purpose');
      }
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

      if (!doc) {
        throw new UnauthorizedError('Refresh token not found');
      }
      if (doc.revokedAt !== null) {
        // Possible replay attack — token was already rotated or revoked.
        // Revoke all tokens for this user as a safety measure.
        await refreshTokens.revokeAllForUser(doc.userId);
        fastify.log.warn(
          { userId: doc.userId },
          'Refresh token reuse detected — revoked all sessions for user',
        );
        throw new UnauthorizedError('Refresh token has already been used');
      }
      if (doc.expiresAt < new Date()) {
        throw new UnauthorizedError('Refresh token has expired');
      }

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
  if (typeof payload['sub'] !== 'string' || payload['sub'].length === 0) {
    throw new UnauthorizedError('Token missing `sub` claim');
  }
  if (typeof payload['org'] !== 'string' || payload['org'].length === 0) {
    throw new UnauthorizedError('Token missing `org` claim');
  }
  if (!Array.isArray(payload['roles'])) {
    throw new UnauthorizedError('Token missing `roles` claim');
  }
  if (typeof payload['email'] !== 'string') {
    throw new UnauthorizedError('Token missing `email` claim');
  }
}

function notConfigured(): never {
  throw new Error(
    'Inventario JWT service is not configured. Set JWT_PRIVATE_KEY and JWT_PUBLIC_KEY env vars.',
  );
}
