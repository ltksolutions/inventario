// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Apple Sign-In routes — ADR-0030 D1.
 *
 * Apple uses a POST callback with `response_mode=form_post`, which is
 * incompatible with the GET callback used by Google and Microsoft.
 * This plugin handles Apple-specific endpoints separately.
 *
 * Endpoints:
 *   GET  /v1/auth/login/apple           → redirect to Apple consent
 *   POST /v1/auth/callback/apple        → handle form_post callback
 *
 * Apple quirks vs Google/Microsoft:
 *   1. response_mode=form_post — callback is a POST with body, not GET with query params.
 *   2. Client Secret is a short-lived JWT signed with an ES256 private key (.p8).
 *      Arctic's Apple provider generates this internally from TEAM_ID + KEY_ID + PRIVATE_KEY.
 *   3. Apple only returns user name on the FIRST login. Subsequent logins omit it.
 *      We persist name from first login; fall back to email prefix on later logins.
 *   4. No PKCE — Apple uses state parameter for CSRF only.
 *   5. id_token contains the user's sub (stable identifier) and email.
 *      We decode id_token to get user info (no separate userinfo endpoint).
 *
 * Required env vars (set in Vercel + .env.local once Apple Developer account is approved):
 *   APPLE_CLIENT_ID   — Services ID (e.g. sk.inventario.estate.signin)
 *   APPLE_TEAM_ID     — 10-char Apple Developer Team ID
 *   APPLE_KEY_ID      — Key ID from Apple Developer → Keys
 *   APPLE_PRIVATE_KEY — PEM content of the .p8 key file (include header/footer)
 */

import { AccountType, AuthProvider, MemberJoinPolicy, UserRole } from '@inventario/shared-types';
import { Apple } from 'arctic';
import fp from 'fastify-plugin';

import { setAuthCookies } from './cookie-helpers.js';
import {
  OAUTH_STATE_COOKIE,
  OAuthStateError,
  generateOAuthState,
  oauthStateCookieOptions,
  serializeOAuthState,
  verifyOAuthState,
} from './oauth-state.js';

import type { Organisation, User } from '@inventario/shared-types';
import type { FastifyPluginAsync } from 'fastify';
import type { Db, WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Apple id_token payload (decoded, not verified here — Arctic verifies sig)
// ---------------------------------------------------------------------------

interface AppleIdTokenPayload {
  sub: string; // stable user identifier
  email?: string;
  email_verified?: string | boolean;
  is_private_email?: string | boolean;
  iat: number;
  exp: number;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const appleAuthRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const {
    APPLE_CLIENT_ID,
    APPLE_TEAM_ID,
    APPLE_KEY_ID,
    APPLE_PRIVATE_KEY,
    OAUTH_STATE_SECRET,
    OAUTH_REDIRECT_BASE_URL,
    FRONTEND_BASE_URL,
  } = fastify.config;

  // Skip if Apple credentials are not configured
  if (!APPLE_CLIENT_ID || !APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY) {
    fastify.log.info(
      'APPLE_CLIENT_ID / APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY not set — Apple Sign-In routes skipped.',
    );

    // Register stub routes so the frontend gets a clear 503 (not 404)
    fastify.get('/v1/auth/login/apple', async (_req, reply) => {
      return reply.code(503).send({ error: 'Apple Sign-In is not configured on this server.' });
    });
    fastify.post('/v1/auth/callback/apple', async (_req, reply) => {
      return reply.code(503).send({ error: 'Apple Sign-In is not configured on this server.' });
    });
    return;
  }

  if (!OAUTH_STATE_SECRET || !OAUTH_REDIRECT_BASE_URL) {
    fastify.log.warn(
      'OAUTH_STATE_SECRET / OAUTH_REDIRECT_BASE_URL not set — Apple Sign-In routes skipped.',
    );
    return;
  }

  const appleCallbackUrl = `${OAUTH_REDIRECT_BASE_URL}/apple`;

  // Apple's Arctic provider expects the private key as Uint8Array (raw PKCS8 bytes).
  // APPLE_PRIVATE_KEY is a PEM string (from .p8 file); strip header/footer/newlines
  // and decode base64 to get the raw DER bytes.
  const applePrivateKeyBytes = pemToUint8Array(APPLE_PRIVATE_KEY);
  const apple = new Apple(
    APPLE_CLIENT_ID,
    APPLE_TEAM_ID,
    APPLE_KEY_ID,
    applePrivateKeyBytes,
    appleCallbackUrl,
  );

  // -------------------------------------------------------------------------
  // GET /v1/auth/login/apple
  // Initiates Apple Sign-In. Accepts the same query params as other providers
  // (orgName, contactEmail, ico, dpaAcceptedAt, invitationToken, redirectAfter).
  // -------------------------------------------------------------------------

  fastify.get<{
    Querystring: {
      redirectAfter?: string;
      orgName?: string;
      contactEmail?: string;
      ico?: string;
      dpaAcceptedAt?: string;
      invitationToken?: string;
    };
  }>('/v1/auth/login/apple', async (request, reply) => {
    const { redirectAfter, orgName, contactEmail, ico, dpaAcceptedAt, invitationToken } =
      request.query;

    const statePayload = generateOAuthState({
      provider: 'apple',
      ...(redirectAfter !== undefined && { redirectAfter }),
      ...(invitationToken !== undefined && { invitationToken }),
      ...(orgName && contactEmail && dpaAcceptedAt
        ? {
            pendingOrg: {
              name: orgName,
              contactEmail,
              ...(ico !== undefined && { ico }),
              dpaAcceptedAt,
            },
          }
        : {}),
    });

    // Apple: request name + email scopes
    const authUrl = apple.createAuthorizationURL(statePayload.state, ['name', 'email']);

    reply.setCookie(
      OAUTH_STATE_COOKIE,
      serializeOAuthState(statePayload, OAUTH_STATE_SECRET),
      oauthStateCookieOptions(),
    );

    return reply.redirect(authUrl.toString());
  });

  // -------------------------------------------------------------------------
  // POST /v1/auth/callback/apple
  //
  // Apple sends a form_post with:
  //   code       — authorization code
  //   state      — matches what we sent
  //   id_token   — JWT with sub + email (always present)
  //   user       — JSON string with name (ONLY on first login)
  //   error      — present if user denied
  // -------------------------------------------------------------------------

  fastify.post<{
    Body: {
      code?: string;
      state?: string;
      id_token?: string;
      user?: string; // JSON string: { name: { firstName, lastName } }
      error?: string;
    };
  }>('/v1/auth/callback/apple', async (request, reply) => {
    const {
      code,
      state: returnedState,
      id_token,
      user: userJson,
      error: appleError,
    } = request.body ?? {};

    if (appleError) {
      fastify.log.warn({ appleError }, 'Apple Sign-In: provider returned error');
      return reply.redirect(`${FRONTEND_BASE_URL}/login?error=oauth_denied`);
    }

    if (!code || !returnedState || !id_token) {
      return reply.redirect(`${FRONTEND_BASE_URL}/login?error=oauth_invalid_callback`);
    }

    // Verify state cookie
    const stateCookie = request.cookies?.[OAUTH_STATE_COOKIE];
    if (!stateCookie) {
      return reply.redirect(`${FRONTEND_BASE_URL}/login?error=oauth_state_missing`);
    }

    let statePayload;
    try {
      statePayload = verifyOAuthState(stateCookie, OAUTH_STATE_SECRET);
    } catch (err) {
      const msg = err instanceof OAuthStateError ? err.message : 'State verification failed';
      fastify.log.warn({ msg }, 'Apple callback: state verification failed');
      return reply.redirect(`${FRONTEND_BASE_URL}/login?error=oauth_state_invalid`);
    }

    reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/v1/auth' });

    if (statePayload.state !== returnedState) {
      return reply.redirect(`${FRONTEND_BASE_URL}/login?error=oauth_state_mismatch`);
    }

    // Exchange code for tokens (validates code with Apple, even though we
    // read id_token directly from the form_post body per Apple's design).
    try {
      await apple.validateAuthorizationCode(code);
    } catch (err) {
      fastify.log.error({ err }, 'Apple: token exchange failed');
      return reply.redirect(`${FRONTEND_BASE_URL}/login?error=oauth_token_exchange_failed`);
    }

    // Decode id_token — Apple puts user info here (no userinfo endpoint)
    let idTokenPayload: AppleIdTokenPayload;
    try {
      // id_token is a JWT; Arctic has already validated the signature.
      // We just need to decode the payload (middle part).
      const payloadB64 = id_token.split('.')[1];
      if (!payloadB64) throw new Error('Missing id_token payload');
      idTokenPayload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf-8'),
      ) as AppleIdTokenPayload;
    } catch (err) {
      fastify.log.error({ err }, 'Apple: failed to decode id_token');
      return reply.redirect(`${FRONTEND_BASE_URL}/login?error=apple_token_decode_failed`);
    }

    const appleUserId = idTokenPayload.sub;
    const email = (idTokenPayload.email ?? '').toLowerCase();

    if (!appleUserId || !email) {
      fastify.log.warn({ idTokenPayload }, 'Apple: missing sub or email in id_token');
      return reply.redirect(`${FRONTEND_BASE_URL}/login?error=apple_missing_user_info`);
    }

    // Parse optional user name (only sent on first Apple login)
    let firstName = '';
    let lastName = '';
    if (userJson) {
      try {
        const parsed = JSON.parse(userJson) as {
          name?: { firstName?: string; lastName?: string };
        };
        firstName = parsed.name?.firstName ?? '';
        lastName = parsed.name?.lastName ?? '';
      } catch {
        fastify.log.warn({ userJson }, 'Apple: failed to parse user JSON');
      }
    }

    // Fallback name if Apple did not send it (repeat logins)
    if (!firstName) {
      firstName = email.split('@')[0] ?? 'User';
    }

    // Provision / find user
    try {
      const result = await provisionOrFindAppleUser({
        fastify,
        appleUserId,
        email,
        firstName,
        lastName,
        statePayload,
        idToken: id_token,
      });

      if (!result.success) {
        return reply.redirect(`${FRONTEND_BASE_URL}/login?error=${result.errorCode}`);
      }

      const { user, org, membershipId, role, isNew, wasInvite } = result;

      const accessToken = await fastify.inventarioJwt.issueAccessToken(
        user,
        org,
        membershipId,
        role,
      );
      const refreshToken = await fastify.inventarioJwt.issueRefreshToken(String(user._id), request);

      setAuthCookies(
        reply,
        accessToken,
        refreshToken,
        fastify.config.JWT_ACCESS_TOKEN_TTL_SECONDS,
        fastify.config.JWT_REFRESH_TOKEN_TTL_DAYS,
      );

      if (wasInvite) {
        const now = new Date().toISOString();
        await fastify.mongo.db.collection('audit_logs').insertOne({
          action: 'USER_INVITATION_ACCEPTED',
          severity: 'INFO',
          actor: { userId: String(user._id), email: user.email },
          target: { entityType: 'User', entityId: String(user._id) },
          organisationId: String(org._id),
          metadata: { via: 'oauth-apple', membershipId },
          createdAt: now,
        });
      }

      const destination = wasInvite
        ? '/dashboard?invited=accepted'
        : isNew
          ? '/onboarding'
          : (statePayload.redirectAfter ?? '/');

      return reply.redirect(`${FRONTEND_BASE_URL}${destination}`);
    } catch (err) {
      fastify.log.error({ err }, 'Apple: user provisioning failed');
      return reply.redirect(`${FRONTEND_BASE_URL}/login?error=provisioning_failed`);
    }
  });
};

export default fp(appleAuthRoutesPlugin, {
  name: 'apple-auth-routes',
  dependencies: ['config', 'mongo', 'inventario-jwt'],
});

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

type ProvisionResult =
  | {
      success: true;
      user: WithId<User>;
      org: WithId<Organisation>;
      membershipId: string;
      role: string;
      isNew: boolean;
      wasInvite: boolean;
    }
  | { success: false; errorCode: string };

async function provisionOrFindAppleUser(args: {
  fastify: Parameters<FastifyPluginAsync>[0];
  appleUserId: string;
  email: string;
  firstName: string;
  lastName: string;
  statePayload: ReturnType<typeof verifyOAuthState>;
  idToken: string;
}): Promise<ProvisionResult> {
  const { fastify, appleUserId, email, firstName, lastName, statePayload } = args;
  const db = fastify.mongo.db;
  const { ObjectId } = await import('mongodb');

  const usersCol = db.collection<User>('users');
  const orgsCol = db.collection<Organisation>('organisations');
  const membershipsCol = db.collection('memberships');
  const now = new Date().toISOString();

  // Find existing user by Apple sub
  const existingUser = (await usersCol.findOne({
    authProviders: {
      $elemMatch: { provider: AuthProvider.APPLE, providerId: appleUserId },
    },
    deletedAt: null,
  })) as WithId<User> | null;

  if (existingUser) {
    // Existing Apple user — update name if Apple sends it again (unlikely but safe)
    const updates: Record<string, unknown> = { lastLoginAt: now, updatedAt: now };
    if (firstName && !existingUser.firstName) updates['firstName'] = firstName;
    if (lastName && !existingUser.lastName) updates['lastName'] = lastName;
    if (firstName && !existingUser.displayName) {
      updates['displayName'] = lastName ? `${firstName} ${lastName}` : firstName;
    }
    await usersCol.updateOne({ _id: existingUser._id }, { $set: updates });

    const defaultMembership = await membershipsCol.findOne({
      userId: String(existingUser._id),
      isDefault: true,
      status: 'ACTIVE',
      deletedAt: null,
    });
    if (!defaultMembership) return { success: false, errorCode: 'membership_not_found' };

    const org = (await orgsCol.findOne({
      _id: new ObjectId(defaultMembership['organisationId'] as string) as never,
      deletedAt: null,
    })) as WithId<Organisation> | null;
    if (!org) return { success: false, errorCode: 'org_not_found' };
    if (org.status !== 'ACTIVE') return { success: false, errorCode: 'org_inactive' };

    const allowedProviders: string[] = org.allowedAuthProviders ?? [];
    if (allowedProviders.length > 0 && !allowedProviders.includes(AuthProvider.APPLE)) {
      return { success: false, errorCode: 'provider_not_allowed' };
    }

    return {
      success: true,
      user: existingUser,
      org,
      membershipId: String(defaultMembership['_id']),
      role: (defaultMembership['role'] as string) ?? 'EMPLOYEE',
      isNew: false,
      wasInvite: false,
    };
  }

  // -----------------------------------------------------------------------
  // Invite-accept via Apple
  // -----------------------------------------------------------------------
  if (statePayload.invitationToken) {
    return acceptAppleInvite({
      db,
      invitationToken: statePayload.invitationToken,
      appleUserId,
      email,
      firstName,
      lastName,
      now,
    });
  }

  // -----------------------------------------------------------------------
  // Self-serve registration (pendingOrg required)
  // -----------------------------------------------------------------------
  if (!statePayload.pendingOrg) {
    return { success: false, errorCode: 'invite_required' };
  }

  const { name: orgName, contactEmail, ico, dpaAcceptedAt } = statePayload.pendingOrg;
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
    primaryContactEmail: contactEmail.toLowerCase(),
    brandKit: null,
    billing: ico
      ? {
          legalName: orgName,
          ico,
          dic: null,
          isVatPayer: false,
          icDph: null,
          businessRegistration: null,
          iban: null,
          billingEmail: null,
          registeredAddress: null,
          mailingAddress: null,
        }
      : null,
    settings: {},
    appBaseUrl: null,
    publicAssetLookup: false,
    foundContactInfo: null,
    inventoryNumberFormat: null,
    protocolSettings: null,
    labelPrinting: null,
    // ADR-0031: per-tenant OAuth credentials
    oauthCredentials: null,
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
  const displayName = lastName ? `${firstName} ${lastName}` : firstName;

  const userInsert = await usersCol.insertOne({
    organisationId: orgId.toString(),
    email,
    firstName,
    lastName,
    displayName,
    accountType: AccountType.LOCAL,
    entraOid: null,
    authProviders: [
      { provider: AuthProvider.APPLE, providerId: appleUserId, email, linkedAt: now },
    ],
    emailVerified: true, // Apple has already verified the email
    emailVerificationToken: null,
    emailVerificationExpiresAt: null,
    passwordResetToken: null,
    passwordResetExpiresAt: null,
    passwordHash: null,
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
    { $set: { registeredBy: userId.toString(), dpaAcceptedBy: userId.toString(), updatedAt: now } },
  );

  const membershipInsert = await membershipsCol.insertOne({
    userId: userId.toString(),
    organisationId: orgId.toString(),
    role: UserRole.ADMIN,
    organizationalUnit: null,
    teams: [],
    status: 'ACTIVE',
    isDefault: true,
    invitedBy: 'SYSTEM',
    invitedAt: now,
    acceptedAt: now,
    mustChangePassword: false,
    lastAccessedAt: now,
    notifications: { email: true, push: false },
    createdAt: now,
    updatedAt: now,
    createdBy: userId.toString(),
    updatedBy: userId.toString(),
    deletedAt: null,
    deletedBy: null,
  });

  const newUser = (await usersCol.findOne({ _id: userId } as never)) as WithId<User>;
  const newOrg = (await orgsCol.findOne({ _id: orgId } as never)) as WithId<Organisation>;

  return {
    success: true,
    user: newUser,
    org: newOrg,
    membershipId: String(membershipInsert.insertedId),
    role: UserRole.ADMIN,
    isNew: true,
    wasInvite: false,
  };
}

// ---------------------------------------------------------------------------
// Invite-accept via Apple
// ---------------------------------------------------------------------------

async function acceptAppleInvite(args: {
  db: Db;
  invitationToken: string;
  appleUserId: string;
  email: string;
  firstName: string;
  lastName: string;
  now: string;
}): Promise<ProvisionResult> {
  const { invitationToken, appleUserId, email, firstName, lastName, now } = args;
  const db = args.db;
  const { ObjectId } = await import('mongodb');

  const usersCol = db.collection<User>('users');
  const orgsCol = db.collection<Organisation>('organisations');
  const membershipsCol = db.collection('memberships');
  const invitationsCol = db.collection('invitations');

  const inv = await invitationsCol.findOne({
    token: invitationToken,
    status: 'PENDING',
    deletedAt: null,
  });
  if (!inv) return { success: false, errorCode: 'invite_not_found' };
  if (new Date(inv['expiresAt'] as string) < new Date())
    return { success: false, errorCode: 'invite_expired' };

  const invEmail = (inv['email'] as string).toLowerCase();
  if (invEmail !== email) return { success: false, errorCode: 'invite_email_mismatch' };

  const org = (await orgsCol.findOne({
    _id: new ObjectId(inv['organisationId'] as string) as never,
    deletedAt: null,
  })) as WithId<Organisation> | null;
  if (!org) return { success: false, errorCode: 'org_not_found' };
  if (org.status !== 'ACTIVE') return { success: false, errorCode: 'org_inactive' };

  const invitedUserId = inv['invitedUserId'] as string | null;
  let user: WithId<User>;

  if (invitedUserId) {
    // Cross-tenant: existing user joins new org
    const existingUser = (await usersCol.findOne({
      _id: new ObjectId(invitedUserId) as never,
      deletedAt: null,
    })) as WithId<User> | null;
    if (!existingUser) return { success: false, errorCode: 'user_not_found' };

    const alreadyLinked = (
      (existingUser.authProviders ?? []) as Array<{ provider: string; providerId: string }>
    ).some((p) => p.provider === AuthProvider.APPLE && p.providerId === appleUserId);

    if (!alreadyLinked) {
      await usersCol.updateOne(
        { _id: existingUser._id },
        {
          $push: {
            authProviders: {
              provider: AuthProvider.APPLE,
              providerId: appleUserId,
              email,
              linkedAt: now,
            },
          } as never,
          $set: { lastLoginAt: now, updatedAt: now },
        },
      );
    } else {
      await usersCol.updateOne(
        { _id: existingUser._id },
        { $set: { lastLoginAt: now, updatedAt: now } },
      );
    }
    user = (await usersCol.findOne({ _id: existingUser._id } as never)) as WithId<User>;
  } else {
    // New user via Apple invite
    const displayName = lastName ? `${firstName} ${lastName}` : firstName;
    const userInsert = await usersCol.insertOne({
      email: invEmail,
      firstName: (inv['firstName'] as string | null) ?? firstName,
      lastName: (inv['lastName'] as string | null) ?? lastName,
      displayName,
      accountType: AccountType.LOCAL,
      entraOid: null,
      authProviders: [
        { provider: AuthProvider.APPLE, providerId: appleUserId, email, linkedAt: now },
      ],
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpiresAt: null,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
      passwordHash: null,
      roles: inv['roles'],
      isActive: true,
      lastLoginAt: now,
      preferences: { language: 'sk', timezone: 'Europe/Bratislava' },
      createdAt: now,
      updatedAt: now,
      createdBy: 'SYSTEM',
      updatedBy: 'SYSTEM',
      deletedAt: null,
      deletedBy: null,
    } as never);
    user = (await usersCol.findOne({ _id: userInsert.insertedId } as never)) as WithId<User>;
  }

  const membershipInsert = await membershipsCol.insertOne({
    userId: String(user._id),
    organisationId: inv['organisationId'],
    role: inv['role'],
    organizationalUnit: null,
    teams: [],
    status: 'ACTIVE',
    isDefault: invitedUserId ? false : true,
    invitedBy: inv['invitedBy'],
    invitedAt: inv['createdAt'],
    acceptedAt: now,
    mustChangePassword: false,
    lastAccessedAt: now,
    notifications: { email: true, push: false },
    createdAt: now,
    updatedAt: now,
    createdBy: String(user._id),
    updatedBy: String(user._id),
    deletedAt: null,
    deletedBy: null,
  });

  await invitationsCol.updateOne(
    { _id: inv['_id'] },
    {
      $set: {
        status: 'ACCEPTED',
        acceptedAt: now,
        membershipId: String(membershipInsert.insertedId),
        updatedAt: now,
      },
    },
  );

  return {
    success: true,
    user,
    org,
    membershipId: String(membershipInsert.insertedId),
    role: (inv['role'] as string) ?? 'EMPLOYEE',
    isNew: !invitedUserId,
    wasInvite: true,
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Convert a PEM-encoded private key string to Uint8Array (raw DER bytes).
 * Apple's Arctic provider expects pkcs8PrivateKey as Uint8Array.
 * The .p8 file from Apple Developer contains a PEM-formatted EC key.
 */
function pemToUint8Array(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----BEGIN.*?-----/g, '')
    .replace(/-----END.*?-----/g, '')
    .replace(/\s/g, '');
  return Uint8Array.from(Buffer.from(base64, 'base64'));
}

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
