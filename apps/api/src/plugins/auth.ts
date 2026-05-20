/**
 * Auth plugin — Microsoft Entra ID JWT verification.
 *
 * Provides a `requireAuth` preHandler that:
 *   1. Extracts the `Authorization: Bearer <token>` header
 *   2. Decodes the JWT header to find the signing key ID (`kid`)
 *   3. Fetches the public key from Microsoft's JWKS endpoint (cached via get-jwks)
 *   4. Verifies the JWT signature
 *   5. Validates `iss`, `aud`, `ver`, and `scp` claims
 *   6. Attaches a typed `request.entraClaims` for downstream handlers
 *
 * What we DO NOT do here:
 *   - JIT user provisioning (that's in users.service.ts — separation of concerns)
 *   - Authorization / RBAC (slice #2b — for now, "authenticated == allowed")
 *   - Refresh token handling (browser/SPA's job, not API's)
 *
 * Security notes:
 *   - We accept tokens with `aud` matching either the raw client ID GUID
 *     or `api://<client-id>` (both forms appear in v2.0 tokens depending
 *     on how the client requested the scope).
 *   - We require `ver === '2.0'` to reject legacy v1 tokens, which have
 *     different claim semantics.
 *   - We require the `access_as_user` scope to be present, ensuring the
 *     token was issued for THIS API (not, say, Microsoft Graph).
 *   - The JWKS cache TTL is 10 minutes; Microsoft rotates keys infrequently
 *     so this is a good balance between freshness and JWKS endpoint load.
 */

import fp from 'fastify-plugin';
import buildGetJwks from 'get-jwks';
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  importSPKI,
  jwtVerify,
  type JWK,
  type JWTPayload,
  type KeyLike,
} from 'jose';
import { ObjectId } from 'mongodb';

import { ForbiddenError, UnauthorizedError } from './error-handler.js';

import type { InventarioJwtPayload } from './inventario-jwt.js';
import type { Organisation, User, UserRole } from '@inventario/shared-types';
import type { FastifyPluginAsync, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Claim shape
// ---------------------------------------------------------------------------

/**
 * Subset of Entra ID v2.0 token claims that we rely on for authentication
 * and JIT provisioning. Microsoft includes many more (idp, ipaddr, etc.)
 * but we deliberately ignore them to keep the surface small.
 *
 * See: https://learn.microsoft.com/azure/active-directory/develop/access-token-claims-reference
 */
export interface EntraClaims {
  /** Object ID — stable, unique per user across the tenant. PRIMARY KEY for our users collection. */
  oid: string;
  /** Tenant ID — always equals our ENTRA_TENANT_ID after validation. */
  tid: string;
  /** Subject — opaque per-app user identifier; we prefer `oid` over this. */
  sub: string;
  /** Token version — always '2.0' (we reject v1). */
  ver: '2.0';
  /** Space-separated scopes; we require it to contain `access_as_user`. */
  scp: string;
  /** User's email address (only if the `email` optional claim is configured). */
  email?: string;
  /** User's User Principal Name (login name in the tenant). */
  preferred_username?: string;
  /** Display name from the directory. */
  name?: string;
  /** Given name (first name). */
  given_name?: string;
  /** Family name (surname). */
  family_name?: string;
  /** Issued-at timestamp (Unix epoch seconds). */
  iat: number;
  /** Expiration timestamp (Unix epoch seconds). */
  exp: number;
}

// ---------------------------------------------------------------------------
// Fastify request decoration
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Validated Entra ID claims for the current request.
     *
     * Only populated on routes protected by `requireAuth`. Accessing this
     * on an unprotected route throws (so downstream handlers don't have
     * to defensively check for `undefined`).
     */
    entraClaims: EntraClaims;

    /**
     * Tenant Organisation document for the current request, resolved
     * from the JWT `tid` claim by `loadCurrentUser`.
     *
     * Only populated on routes that include `loadCurrentUser` in the
     * preHandler chain. JIT-provisioned during the first authenticated
     * request from a new Entra tenant.
     *
     * SUSPENDED and ARCHIVED tenants are rejected with 401 before this
     * field is set, so handlers can assume the tenant is ACTIVE.
     */
    organisation: WithId<Organisation>;

    /**
     * Convenience accessor: the current tenant's `_id` as a string.
     *
     * Mirrors `request.organisation._id` but matches the type used
     * everywhere else (services, repositories, schemas) where
     * organisationId is a 24-hex string rather than a Mongo ObjectId.
     */
    organisationId: string;

    /**
     * Current user document from the `users` collection.
     *
     * Only populated on routes that include `loadCurrentUser` in the
     * preHandler chain (which itself requires `requireAuth` to have run
     * first). The user has been verified as active; deactivated users
     * are rejected with 401 before this field is set.
     *
     * Roles in this object are the authoritative source — JWT roles are
     * NOT used for authorization because role changes need to take effect
     * immediately, not wait for token refresh (~1 hour).
     */
    currentUser: WithId<User>;

    /**
     * Validated Inventario JWT claims for cookie-authenticated requests
     * (Slice #6b+). Set by `requireAuth` when the `inv_access` httpOnly
     * cookie is present. Mutually exclusive with `entraClaims` on any
     * given request — a request is either cookie-authenticated or
     * Bearer-authenticated, never both.
     *
     * Only populated on routes protected by `requireAuth`.
     */
    inventarioClaims?: InventarioJwtPayload;
  }

  interface FastifyInstance {
    /**
     * Pre-handler that enforces a valid Entra ID JWT.
     *
     * Usage in a route:
     *   app.get('/v1/me', { preHandler: app.requireAuth }, async (req) => {
     *     const oid = req.entraClaims.oid;
     *     // ...
     *   });
     */
    requireAuth: (request: FastifyRequest) => Promise<void>;

    /**
     * Pre-handler that loads `request.currentUser` from the database,
     * via JIT-provisioning if needed.
     *
     * Depends on `requireAuth` having run first (uses `request.entraClaims.oid`).
     * Rejects deactivated users (`isActive: false`) with 401.
     *
     * Usage:
     *   app.post('/v1/assets', {
     *     preHandler: [app.requireAuth, app.loadCurrentUser],
     *   }, async (req) => {
     *     const userId = req.currentUser._id;
     *     // ...
     *   });
     */
    loadCurrentUser: (request: FastifyRequest) => Promise<void>;

    /**
     * Factory: creates a pre-handler that requires the current user to have
     * at least one of the listed roles. Throws 403 otherwise.
     *
     * Depends on `loadCurrentUser` having run first (uses `request.currentUser`).
     *
     * Usage:
     *   app.post('/v1/assets', {
     *     preHandler: [
     *       app.requireAuth,
     *       app.loadCurrentUser,
     *       app.requireRole(['ASSET_MANAGER', 'ADMIN']),
     *     ],
     *   }, async (req) => { ... });
     *
     * The role list is OR-semantics (any-of). For AND-semantics across
     * multiple roles, chain multiple `requireRole` calls.
     */
    requireRole: (allowed: readonly UserRole[]) => preHandlerAsyncHookHandler;
  }
}

// ---------------------------------------------------------------------------
// Helper: type guard for Entra claims
// ---------------------------------------------------------------------------

/**
 * Narrows a `JWTPayload` (loose shape from jose) into our `EntraClaims`
 * interface, throwing if any required claim is missing or malformed.
 *
 * `jose` validates `iss`/`aud`/`exp` for us (we pass those options to
 * `jwtVerify`), so here we only check claims we use ourselves.
 */
function assertEntraClaims(payload: JWTPayload): asserts payload is JWTPayload & EntraClaims {
  if (typeof payload['oid'] !== 'string' || payload['oid'].length === 0) {
    throw new UnauthorizedError('Token missing required `oid` claim');
  }
  if (typeof payload['tid'] !== 'string') {
    throw new UnauthorizedError('Token missing required `tid` claim');
  }
  if (typeof payload['sub'] !== 'string') {
    throw new UnauthorizedError('Token missing required `sub` claim');
  }
  if (payload['ver'] !== '2.0') {
    throw new UnauthorizedError(
      `Unsupported token version: ${String(payload['ver'])} (expected '2.0')`,
    );
  }
  if (typeof payload['scp'] !== 'string') {
    throw new UnauthorizedError('Token missing required `scp` claim (delegated permissions)');
  }
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
    throw new UnauthorizedError('Token missing required timestamps (`iat`/`exp`)');
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const authPlugin: FastifyPluginAsync = async (fastify) => {
  const {
    NODE_ENV,
    ENTRA_TENANT_ID,
    ENTRA_ISSUER_RESOLVED,
    ENTRA_ACCEPTED_AUDIENCES,
    TEST_JWT_PUBLIC_KEY,
  } = fastify.config;

  // -------------------------------------------------------------------------
  // Test JWT support (slice #2c)
  // -------------------------------------------------------------------------
  //
  // When `TEST_JWT_PUBLIC_KEY` is set, the plugin ALSO accepts tokens whose
  // `iss` claim is `urn:sfz-test:dev`, verifying them against that public
  // key instead of Microsoft's JWKS. This lets vitest integration tests
  // mint their own tokens without going through the Entra device-code flow.
  //
  // Defense in depth: refuse to enable this in production, even if someone
  // accidentally sets the env var.
  const TEST_JWT_ISSUER = 'urn:sfz-test:dev';
  let testPublicKey: KeyLike | null = null;

  if (TEST_JWT_PUBLIC_KEY) {
    if (NODE_ENV === 'production') {
      throw new Error(
        'TEST_JWT_PUBLIC_KEY is set but NODE_ENV is "production". ' +
          'The test JWT verification path must never be enabled in production. ' +
          'Unset TEST_JWT_PUBLIC_KEY from the production environment.',
      );
    }

    testPublicKey = await importSPKI(TEST_JWT_PUBLIC_KEY, 'RS256');
    fastify.log.info(
      { issuer: TEST_JWT_ISSUER, nodeEnv: NODE_ENV },
      'Test JWT verification enabled (development/test only)',
    );
  }

  // -------------------------------------------------------------------------
  // JWKS fetcher — caches signing keys for 10 minutes, handles rotation.
  // -------------------------------------------------------------------------
  //
  // Microsoft Entra ID does NOT publish JWKS at the standard OIDC location
  // (<issuer>/.well-known/jwks.json). Instead, the JWKS lives at:
  //   https://login.microsoftonline.com/<tenant>/discovery/v2.0/keys
  //
  // To discover this, get-jwks must use the OIDC metadata document:
  //   https://login.microsoftonline.com/<tenant>/v2.0/.well-known/openid-configuration
  // which returns a `jwks_uri` field pointing to the discovery endpoint.
  //
  // Setting `providerDiscovery: true` makes get-jwks follow the OIDC
  // discovery flow instead of guessing the default `.well-known/jwks.json`
  // path. Without this, lookups silently fail with "Unexpected end of JSON
  // input" because Microsoft returns an empty/different response at the
  // unspecified default path.
  //
  // `issuersWhitelist` is defense in depth: get-jwks refuses to fetch JWKS
  // for any issuer not on this list, so even a malformed token pointing
  // elsewhere cannot make us reach out to attacker-controlled hosts.
  const getJwks = buildGetJwks({
    max: 5, // max distinct keys to cache
    ttl: 10 * 60 * 1000, // 10 minutes
    providerDiscovery: true,
    issuersWhitelist: [ENTRA_ISSUER_RESOLVED],
  });

  /**
   * Verifies a JWT signature + standard claims, returns the parsed payload.
   *
   * Throws `UnauthorizedError` for any verification failure. Never throws
   * a generic 500 — auth failures are always client errors.
   *
   * Two verification paths:
   *   1. Test path (only if TEST_JWT_PUBLIC_KEY is configured): tokens
   *      with iss=`urn:sfz-test:dev` are verified against the test public
   *      key. Used by vitest integration tests.
   *   2. Entra path (default): real Microsoft Entra ID tokens verified
   *      against Microsoft's JWKS.
   *
   * The path is selected by the unverified `iss` header claim. Test tokens
   * cannot impersonate Entra tokens (they have a different issuer) and
   * vice versa. The signing keys are completely separate.
   */
  async function verifyToken(token: string): Promise<EntraClaims> {
    // ----- Step 1: peek at unverified header to find the key ID -----
    //
    // We need to know which signing key to fetch BEFORE verifying. The header
    // is unauthenticated at this point (an attacker could forge it), but we
    // only use it as a lookup key into Microsoft's JWKS — the actual signature
    // check below ensures the token was signed by Microsoft.
    let header: { kid?: string; alg?: string };
    try {
      header = decodeProtectedHeader(token);
    } catch {
      throw new UnauthorizedError('Malformed JWT (cannot decode header)');
    }

    if (!header.kid) {
      throw new UnauthorizedError('Token missing `kid` in header');
    }
    if (header.alg !== 'RS256') {
      // Entra ID uses RS256 exclusively. Reject anything else to prevent
      // algorithm confusion attacks (e.g. an attacker submitting `alg=none`).
      throw new UnauthorizedError(`Unsupported signing algorithm: ${String(header.alg)}`);
    }

    // ----- Step 2: peek at unverified payload to choose verification path -----
    //
    // We decode the payload (still unverified) just to read the `iss` claim.
    // Based on that we either route to the test path or the Entra path.
    // The actual signature verification happens AFTER this routing, so a
    // forged `iss` doesn't grant anything — it just selects which key to
    // verify against, and verification will fail if the signature doesn't
    // match that key.
    let unverifiedPayload: { iss?: unknown };
    try {
      const payloadBase64 = token.split('.')[1];
      if (!payloadBase64) throw new Error('Token has no payload segment');
      // Node's Buffer base64url decoder accepts unpadded input directly
      // (the standard form for JWT payloads). No manual padding needed.
      const json = Buffer.from(payloadBase64, 'base64url').toString('utf-8');
      unverifiedPayload = JSON.parse(json) as { iss?: unknown };
    } catch {
      throw new UnauthorizedError('Malformed JWT (cannot decode payload)');
    }

    if (testPublicKey && unverifiedPayload.iss === TEST_JWT_ISSUER) {
      return verifyTestToken(token);
    }

    return verifyEntraToken(token, header.kid);
  }

  /**
   * Verifies a token signed by the test private key (vitest integration tests).
   * Only callable when `testPublicKey` is set.
   */
  async function verifyTestToken(token: string): Promise<EntraClaims> {
    if (!testPublicKey) {
      // Should be unreachable — verifyToken checks this before routing here.
      throw new UnauthorizedError('Test JWT verification is not enabled');
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, testPublicKey, {
        issuer: TEST_JWT_ISSUER,
        audience: Array.from(ENTRA_ACCEPTED_AUDIENCES),
        algorithms: ['RS256'],
        clockTolerance: 30,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown verification error';
      fastify.log.warn({ err: message }, 'Test JWT verification failed');
      throw new UnauthorizedError(`Token verification failed: ${message}`);
    }

    assertEntraClaims(payload);

    // Test tokens skip the tenant-match check (they use a synthetic tenant ID).
    // The scope check still applies — tests must explicitly include `access_as_user`.
    const scopes = payload.scp.split(' ');
    if (!scopes.includes('access_as_user')) {
      throw new UnauthorizedError('Test token lacks required scope `access_as_user`.');
    }

    return payload;
  }

  /**
   * Verifies a real Microsoft Entra ID token against the cached JWKS.
   * The original (pre-#2c) verification logic, now in its own function.
   */
  async function verifyEntraToken(token: string, kid: string): Promise<EntraClaims> {
    // ----- Fetch the matching public key from JWKS -----
    //
    // get-jwks indexes by (domain, alg, kid). `domain` here means the
    // token's `iss` claim — get-jwks will fetch the OpenID discovery
    // document from that issuer and pull the JWKS URI from it.
    let publicJwk: Awaited<ReturnType<typeof getJwks.getJwk>>;
    try {
      publicJwk = await getJwks.getJwk({
        domain: ENTRA_ISSUER_RESOLVED,
        alg: 'RS256',
        kid,
      });
    } catch (err) {
      fastify.log.warn({ err, kid }, 'JWKS lookup failed');
      throw new UnauthorizedError('Token signing key not found in JWKS');
    }

    // ----- Verify signature + standard claims via jose -----
    //
    // We build a local key set from the single fetched JWK because jose's
    // `createRemoteJWKSet` would do its own caching and we want get-jwks
    // to be the single source of truth for caching behavior.
    //
    // The cast is necessary because get-jwks's `JWK` type is a loose record
    // (`{ [key: string]: any }`), but jose requires the strict JWK shape
    // with `kty` always present. In practice Microsoft's JWKS always
    // includes `kty` (and all other required fields); the cast just bridges
    // the two type systems.
    const keySet = createLocalJWKSet({ keys: [publicJwk as unknown as JWK] });

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, keySet, {
        issuer: ENTRA_ISSUER_RESOLVED,
        audience: Array.from(ENTRA_ACCEPTED_AUDIENCES),
        algorithms: ['RS256'],
        // jose checks exp automatically; clockTolerance covers small drift.
        clockTolerance: 30, // seconds
      }));
    } catch (err) {
      // jose throws specific error classes (JWTExpired, JWTClaimValidationFailed, ...)
      // but we collapse them to a single 401. The message is safe to surface
      // because it doesn't leak which check failed first.
      const message = err instanceof Error ? err.message : 'Unknown verification error';
      fastify.log.warn({ err: message }, 'JWT verification failed');
      throw new UnauthorizedError(`Token verification failed: ${message}`);
    }

    // ----- Validate custom claims -----
    assertEntraClaims(payload);

    if (payload.tid !== ENTRA_TENANT_ID) {
      // Defense in depth: the issuer URL already encodes the tenant ID, but
      // checking `tid` explicitly catches misconfigurations and makes the
      // intent clear in code review.
      throw new UnauthorizedError('Token issued for a different tenant');
    }

    // The `scp` claim is a space-separated list of delegated permissions.
    // We require `access_as_user` (defined in the API app registration).
    const scopes = payload.scp.split(' ');
    if (!scopes.includes('access_as_user')) {
      throw new UnauthorizedError(
        'Token lacks required scope `access_as_user`. ' +
          'Ensure your client requests `api://<api-client-id>/access_as_user`.',
      );
    }

    return payload;
  }

  // -------------------------------------------------------------------------
  // requireAuth preHandler
  // -------------------------------------------------------------------------
  fastify.decorate('requireAuth', async (request: FastifyRequest) => {
    // --- Inventario JWT cookie path (Slice #6b+) ---
    //
    // The `inv_access` cookie is httpOnly — browser JS cannot read it,
    // it is sent automatically on every same-origin request when the
    // client uses `credentials: 'include'` (set in the web api-client).
    //
    // If the cookie is present we ONLY try the Inventario JWT path and
    // return early. Cookie clients never send a Bearer header, so
    // falling through would yield a misleading "Missing Authorization
    // header" error for an expired cookie instead of a clean 401.
    const invCookie = request.cookies?.['inv_access'];
    if (invCookie) {
      // verifyAccessToken throws UnauthorizedError on invalid / expired
      // token — error-handler maps that to 401 so the client knows to
      // refresh via POST /v1/auth/refresh.
      const claims = await fastify.inventarioJwt.verifyAccessToken(invCookie);
      request.inventarioClaims = claims;
      request.log.debug({ sub: claims.sub, org: claims.org }, 'Inventario JWT verified (cookie)');
      return;
    }

    // --- Bearer token path (Entra ID or test JWT) ---
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedError('Missing Authorization header');
    }

    // Header format: "Bearer <token>". Match case-insensitively per RFC 6750.
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!match || !match[1]) {
      throw new UnauthorizedError('Authorization header must be "Bearer <token>"');
    }

    const token = match[1].trim();
    const claims = await verifyToken(token);

    request.entraClaims = claims;
    request.log.debug({ oid: claims.oid, sub: claims.sub }, 'JWT verified');
  });

  // -------------------------------------------------------------------------
  // loadCurrentUser preHandler
  // -------------------------------------------------------------------------
  //
  // Resolves the request's tenant + user from the verified JWT claims.
  // Must run AFTER requireAuth (depends on request.entraClaims).
  //
  // The order matters:
  //   1. Resolve the tenant from JWT `tid` (JIT-provision a new
  //      Organisation row on first contact for an unknown Entra tenant).
  //   2. Refuse to load users for SUSPENDED or ARCHIVED tenants.
  //   3. Resolve the user from JWT `oid`, passing the resolved tenant
  //      so first-time users are bound to the right Organisation
  //      (replacing the PENDING_TENANT_ID placeholder from Blok 1-2).
  //   4. Refuse to load deactivated users.
  //
  // Lazy lookup of fastify.usersService / fastify.organisationsService:
  // this plugin is registered BEFORE the users + organisations routes
  // plugins (which decorate those services onto the instance). At
  // registration time the decorators do not exist; at request time they do.
  fastify.decorate('loadCurrentUser', async (request: FastifyRequest) => {
    if (!request.entraClaims && !request.inventarioClaims) {
      // Programmer error: route forgot to chain requireAuth before this.
      throw new Error(
        'loadCurrentUser called without prior requireAuth — fix the preHandler chain.',
      );
    }

    // --- Inventario JWT path (Slice #6b+) ---
    //
    // Token already verified by `requireAuth` — just load the full
    // documents from MongoDB by the IDs in the JWT payload. No JIT
    // provisioning here; cookie auth only works for already-registered
    // users. New-user onboarding goes through registration / OAuth flows.
    if (request.inventarioClaims) {
      const payload = request.inventarioClaims;

      const orgDoc = await fastify.mongo.db
        .collection('organisations')
        .findOne({ _id: new ObjectId(payload.org), deletedAt: null });

      if (!orgDoc) throw new UnauthorizedError('Tenant unavailable.');
      const orgStatus = orgDoc['status'] as string;
      if (orgStatus !== 'ACTIVE')
        throw new UnauthorizedError(`Tenant is ${orgStatus.toLowerCase()}.`);

      request.organisation = orgDoc as unknown as WithId<Organisation>;
      request.organisationId = String(orgDoc._id);

      const userDoc = await fastify.mongo.db
        .collection('users')
        .findOne({ _id: new ObjectId(payload.sub), deletedAt: null });

      if (!userDoc) throw new UnauthorizedError('User not found.');
      if (!(userDoc['isActive'] as boolean))
        throw new UnauthorizedError('User account is deactivated');

      request.currentUser = userDoc as unknown as WithId<User>;
      request.log.debug(
        { userId: payload.sub, roles: payload.roles, organisationId: request.organisationId },
        'Current user + tenant loaded (Inventario JWT)',
      );
      return;
    }

    // ----- Step 1: resolve tenant from JWT `tid` claim (Entra path) -----
    const claims = request.entraClaims!;
    const organisation = await fastify.organisationsService.findOrProvisionByEntraTenantId({
      entraTenantId: claims.tid,
      displayNameHint: claims.name ?? null,
    });

    if (!organisation) {
      // Tenant exists but is soft-deleted. Reject with 401 — the tenant
      // is no longer permitted to use the platform, regardless of how
      // valid the user's individual token is.
      throw new UnauthorizedError('Tenant unavailable.');
    }

    if (organisation.status !== 'ACTIVE') {
      // SUSPENDED or ARCHIVED. The tenant has been frozen by a platform
      // admin; users cannot log in until status is restored.
      throw new UnauthorizedError(`Tenant is ${organisation.status.toLowerCase()}.`);
    }

    request.organisation = organisation;
    request.organisationId = String(organisation._id);

    // ----- Step 2: resolve user, JIT-provisioning if needed -----
    const user = await fastify.usersService.findOrProvision(claims, organisation);

    if (!user.isActive) {
      // Deactivated users still have valid Entra tokens (we cannot revoke
      // those), so we enforce activeness ourselves. 401 (not 403) because
      // their identity is no longer recognized as a valid session.
      throw new UnauthorizedError('User account is deactivated');
    }

    request.currentUser = user;
    request.log.debug(
      {
        userId: String(user._id),
        roles: user.roles,
        organisationId: request.organisationId,
        organisationSlug: organisation.slug,
      },
      'Current user + tenant loaded',
    );
  });

  // -------------------------------------------------------------------------
  // requireRole factory
  // -------------------------------------------------------------------------
  //
  // Returns a preHandler that checks `request.currentUser.roles` against the
  // allowed list. OR-semantics: any role in the list grants access.
  //
  // Must run AFTER loadCurrentUser (depends on request.currentUser).
  fastify.decorate('requireRole', (allowed: readonly UserRole[]) => {
    if (allowed.length === 0) {
      // Programmer error caught at plugin-load time, not request time.
      throw new Error('requireRole called with empty role list — would deny everyone.');
    }

    const allowedSet = new Set(allowed);

    const handler: preHandlerAsyncHookHandler = async (request) => {
      if (!request.currentUser) {
        throw new Error(
          'requireRole called without prior loadCurrentUser — fix the preHandler chain.',
        );
      }

      const userRoles = request.currentUser.roles;
      const hasAnyAllowedRole = userRoles.some((role) => allowedSet.has(role));

      if (!hasAnyAllowedRole) {
        request.log.warn(
          {
            userId: String(request.currentUser._id),
            userRoles,
            requiredRoles: Array.from(allowedSet),
            path: request.url,
          },
          'RBAC: insufficient role',
        );
        throw new ForbiddenError(`Action requires one of: ${Array.from(allowedSet).join(', ')}`);
      }
    };

    return handler;
  });
};

export default fp(authPlugin, {
  name: 'auth',
  dependencies: ['config', 'error-handler'],
});
