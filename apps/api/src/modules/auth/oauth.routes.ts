// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * OAuth routes — K3 (Google + Microsoft) per ADR-0013.
 *
 * Endpoints:
 *   GET /v1/auth/login/:provider   → redirect to OAuth provider consent
 *   GET /v1/auth/callback/:provider → handle callback, provision user, set cookies
 *
 * Apple Sign-In (K4) uses a POST callback (`form_post` response mode) so it
 * is implemented separately.
 *
 * Provider support:
 *   K3: google, microsoft
 *   K4: apple (POST callback, separate routes file)
 *
 * Token flow post-callback:
 *   1. Exchange code → access token via Arctic
 *   2. Fetch provider user profile (Google userinfo / MS Graph)
 *   3. Find user by authProviders[].{provider+providerId}, or provision new one
 *   4a. If invitationToken in state → accept pending invite (K18.3)
 *   4b. If new user: attach to org (from pendingOrg in state) or require invite
 *   5. Issue Inventario JWT + refresh token
 *   6. Set httpOnly cookies (inv_access, inv_refresh)
 *   7. Redirect to frontend
 *
 * Cookie setup is handled here because redirect needs to happen in the same
 * response as the Set-Cookie headers. CORS credentials handling is in K8.
 */

import { AccountType, AuthProvider, MemberJoinPolicy, UserRole } from '@inventario/shared-types';
import { Google, MicrosoftEntraId } from 'arctic';
import fp from 'fastify-plugin';

import { UnauthorizedError } from '../../plugins/error-handler.js';

import {
  OAUTH_STATE_COOKIE,
  OAuthStateError,
  generateOAuthState,
  oauthStateCookieOptions,
  serializeOAuthState,
  verifyOAuthState,
} from './oauth-state.js';

import type { Organisation, User } from '@inventario/shared-types';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { Db, WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const oauthRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET,
    OAUTH_STATE_SECRET,
    OAUTH_REDIRECT_BASE_URL,
    FRONTEND_BASE_URL,
  } = fastify.config;

  // Skip registration if OAuth is not configured (backward compat during transition)
  if (!OAUTH_STATE_SECRET || !OAUTH_REDIRECT_BASE_URL) {
    fastify.log.info(
      'OAUTH_STATE_SECRET / OAUTH_REDIRECT_BASE_URL not set — OAuth routes skipped.',
    );
    return;
  }

  // Build provider instances (only if credentials are configured)
  const providers = buildProviders({
    google:
      GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
        ? { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET }
        : null,
    microsoft:
      MICROSOFT_CLIENT_ID && MICROSOFT_CLIENT_SECRET
        ? { clientId: MICROSOFT_CLIENT_ID, clientSecret: MICROSOFT_CLIENT_SECRET }
        : null,
    redirectBase: OAUTH_REDIRECT_BASE_URL,
  });

  // -------------------------------------------------------------------------
  // GET /v1/auth/login/:provider
  // -------------------------------------------------------------------------

  fastify.get<{
    Params: { provider: string };
    Querystring: {
      redirectAfter?: string;
      orgName?: string;
      contactEmail?: string;
      ico?: string;
      dpaAcceptedAt?: string;
      /** K18.3: invite token — when present, callback will accept the invite. */
      invitationToken?: string;
    };
  }>('/v1/auth/login/:provider', async (request, reply) => {
    const { provider } = request.params;

    if (provider !== 'google' && provider !== 'microsoft') {
      return reply.code(400).send({ error: `Unknown provider: ${provider}` });
    }

    const p = providers[provider];
    if (!p) {
      return reply.code(503).send({ error: `Provider ${provider} is not configured.` });
    }

    const { redirectAfter, orgName, contactEmail, ico, dpaAcceptedAt, invitationToken } =
      request.query;

    // Build state payload (carries PKCE verifier + metadata across redirect)
    const statePayload = generateOAuthState({
      provider,
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

    const authUrl = buildAuthorizationUrl(
      p,
      statePayload.state,
      statePayload.codeVerifier,
      provider,
    );

    // Store state in httpOnly cookie
    reply.setCookie(
      OAUTH_STATE_COOKIE,
      serializeOAuthState(statePayload, OAUTH_STATE_SECRET),
      oauthStateCookieOptions(),
    );

    return reply.redirect(authUrl.toString());
  });

  // -------------------------------------------------------------------------
  // GET /v1/auth/callback/:provider
  // -------------------------------------------------------------------------

  fastify.get<{
    Params: { provider: string };
    Querystring: { code?: string; state?: string; error?: string };
  }>('/v1/auth/callback/:provider', async (request, reply) => {
    const { provider } = request.params;
    const { code, state: returnedState, error: oauthError } = request.query;

    // Provider returned an error (user denied consent, etc.)
    if (oauthError) {
      fastify.log.warn({ provider, oauthError }, 'OAuth provider returned error');
      return reply.redirect(`${FRONTEND_BASE_URL}/login?error=oauth_denied`);
    }

    if (!code || !returnedState) {
      return reply.redirect(`${FRONTEND_BASE_URL}/login?error=oauth_invalid_callback`);
    }

    // Read and verify state cookie
    const stateCookie = request.cookies?.[OAUTH_STATE_COOKIE];
    if (!stateCookie) {
      return reply.redirect(`${FRONTEND_BASE_URL}/login?error=oauth_state_missing`);
    }

    let statePayload;
    try {
      statePayload = verifyOAuthState(stateCookie, OAUTH_STATE_SECRET);
    } catch (err) {
      const msg = err instanceof OAuthStateError ? err.message : 'State verification failed';
      fastify.log.warn({ provider, msg }, 'OAuth state verification failed');
      return reply.redirect(`${FRONTEND_BASE_URL}/login?error=oauth_state_invalid`);
    }

    // Clear the state cookie (one-time use)
    reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/v1/auth' });

    // CSRF check: state in cookie must match state returned by provider
    if (statePayload.state !== returnedState) {
      fastify.log.warn({ provider }, 'OAuth state mismatch — possible CSRF attempt');
      return reply.redirect(`${FRONTEND_BASE_URL}/login?error=oauth_state_mismatch`);
    }

    if (provider !== statePayload.provider) {
      return reply.redirect(`${FRONTEND_BASE_URL}/login?error=oauth_provider_mismatch`);
    }

    const p = providers[provider as 'google' | 'microsoft'];
    if (!p) {
      return reply.redirect(`${FRONTEND_BASE_URL}/login?error=oauth_not_configured`);
    }

    // Exchange code for tokens
    let providerUser: ProviderUserInfo;
    try {
      providerUser = await exchangeCodeAndGetUserInfo(
        p,
        provider as 'google' | 'microsoft',
        code,
        statePayload.codeVerifier,
      );
    } catch (err) {
      fastify.log.error({ err, provider }, 'OAuth token exchange failed');
      return reply.redirect(`${FRONTEND_BASE_URL}/login?error=oauth_token_exchange_failed`);
    }

    // Provision / find user
    try {
      const result = await provisionOrFindUser({
        db: fastify.mongo.db,
        provider: provider as 'google' | 'microsoft',
        providerUser,
        statePayload,
      });

      if (!result.success) {
        return reply.redirect(`${FRONTEND_BASE_URL}/login?error=${result.errorCode}`);
      }

      const { user, org, membershipId, isNew, wasInvite } = result;

      // Issue tokens — always include membershipId (K5 mid claim)
      const accessToken = await fastify.inventarioJwt.issueAccessToken(user, org, membershipId);
      const refreshToken = await fastify.inventarioJwt.issueRefreshToken(String(user._id), request);

      // Set cookies
      setAuthCookies(
        reply,
        accessToken,
        refreshToken,
        fastify.config.JWT_ACCESS_TOKEN_TTL_SECONDS,
        fastify.config.JWT_REFRESH_TOKEN_TTL_DAYS,
      );

      // Emit audit log for invite accept
      if (wasInvite) {
        const authProviderEnum =
          provider === 'google' ? AuthProvider.GOOGLE : AuthProvider.MICROSOFT;
        const now = new Date().toISOString();
        await fastify.mongo.db.collection('audit_logs').insertOne({
          action: 'USER_INVITATION_ACCEPTED',
          severity: 'INFO',
          actor: { userId: String(user._id), email: user.email },
          target: { entityType: 'User', entityId: String(user._id) },
          organisationId: String(org._id),
          metadata: {
            via: authProviderEnum === AuthProvider.GOOGLE ? 'oauth-google' : 'oauth-microsoft',
            membershipId,
          },
          createdAt: now,
        });
      }

      // Redirect
      let destination: string;
      if (wasInvite) {
        destination = '/dashboard?invited=accepted';
      } else if (isNew) {
        destination = '/onboarding';
      } else {
        destination = statePayload.redirectAfter ?? '/';
      }

      return reply.redirect(`${FRONTEND_BASE_URL}${destination}`);
    } catch (err) {
      fastify.log.error({ err, provider }, 'User provisioning failed during OAuth callback');
      return reply.redirect(`${FRONTEND_BASE_URL}/login?error=provisioning_failed`);
    }
  });

  // -------------------------------------------------------------------------
  // POST /v1/auth/logout (also here for completeness)
  // -------------------------------------------------------------------------

  fastify.post('/v1/auth/logout', async (request, reply) => {
    const refreshToken = request.cookies?.['inv_refresh'];
    if (refreshToken) {
      await fastify.inventarioJwt.revokeRefreshToken(refreshToken);
    }
    reply.clearCookie('inv_access', { path: '/' });
    reply.clearCookie('inv_refresh', { path: '/v1/auth/refresh' });
    return reply.code(204).send();
  });

  // -------------------------------------------------------------------------
  // POST /v1/auth/refresh
  // -------------------------------------------------------------------------

  fastify.post('/v1/auth/refresh', async (request, reply) => {
    const rawRefresh = request.cookies?.['inv_refresh'];
    if (!rawRefresh) {
      throw new UnauthorizedError('No refresh token');
    }

    const { newRawToken, userId } = await fastify.inventarioJwt.rotateRefreshToken(
      rawRefresh,
      request,
    );

    // Load user + active membership + org from DB
    const usersCol = fastify.mongo.db.collection<User>('users');
    const orgsCol = fastify.mongo.db.collection<Organisation>('organisations');
    const membershipsCol = fastify.mongo.db.collection('memberships');

    const { ObjectId } = await import('mongodb');
    const user = (await usersCol.findOne({
      _id: new ObjectId(userId),
      deletedAt: null,
    } as never)) as WithId<User> | null;
    if (!user) throw new UnauthorizedError('User not found');

    // Find default membership to get active org (K9 — users no longer carry organisationId)
    const defaultMembership = await membershipsCol.findOne({
      userId,
      isDefault: true,
      status: 'ACTIVE',
      deletedAt: null,
    });
    if (!defaultMembership) throw new UnauthorizedError('No active membership found');

    const org = (await orgsCol.findOne({
      _id: new ObjectId(defaultMembership['organisationId'] as string) as never,
      deletedAt: null,
    })) as WithId<Organisation> | null;
    if (!org) throw new UnauthorizedError('Organisation not found');

    const newAccessToken = await fastify.inventarioJwt.issueAccessToken(
      user,
      org,
      String(defaultMembership['_id']),
    );
    setAuthCookies(
      reply,
      newAccessToken,
      newRawToken,
      fastify.config.JWT_ACCESS_TOKEN_TTL_SECONDS,
      fastify.config.JWT_REFRESH_TOKEN_TTL_DAYS,
    );

    return reply.code(204).send();
  });
};

export default fp(oauthRoutesPlugin, {
  name: 'oauth-routes',
  dependencies: ['config', 'mongo', 'inventario-jwt'],
});

// ---------------------------------------------------------------------------
// Provider construction
// ---------------------------------------------------------------------------

interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

type ProviderMap = {
  google: Google | null;
  microsoft: MicrosoftEntraId | null;
};

function buildProviders(opts: {
  google: ProviderCredentials | null;
  microsoft: ProviderCredentials | null;
  redirectBase: string;
}): ProviderMap {
  return {
    google: opts.google
      ? new Google(opts.google.clientId, opts.google.clientSecret, `${opts.redirectBase}/google`)
      : null,
    microsoft: opts.microsoft
      ? new MicrosoftEntraId(
          'organizations', // multi-tenant: accepts any Entra ID / Microsoft account
          opts.microsoft.clientId,
          opts.microsoft.clientSecret,
          `${opts.redirectBase}/microsoft`,
        )
      : null,
  };
}

// ---------------------------------------------------------------------------
// Authorization URL builder
// ---------------------------------------------------------------------------

function buildAuthorizationUrl(
  provider: Google | MicrosoftEntraId,
  state: string,
  codeVerifier: string,
  providerName: string,
): URL {
  // Arctic v3: createAuthorizationURL(state, codeVerifier, scopes[])
  const scopes =
    providerName === 'google'
      ? ['openid', 'profile', 'email']
      : ['openid', 'profile', 'email', 'offline_access'];
  return provider.createAuthorizationURL(state, codeVerifier, scopes);
}

// ---------------------------------------------------------------------------
// Token exchange + user info
// ---------------------------------------------------------------------------

export interface ProviderUserInfo {
  providerId: string; // Google sub / Microsoft id
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  displayName: string;
}

async function exchangeCodeAndGetUserInfo(
  provider: Google | MicrosoftEntraId,
  providerName: 'google' | 'microsoft',
  code: string,
  codeVerifier: string,
): Promise<ProviderUserInfo> {
  const tokens = await provider.validateAuthorizationCode(code, codeVerifier);
  const accessToken = tokens.accessToken();

  if (providerName === 'google') {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Google userinfo failed: ${res.status}`);
    const data = (await res.json()) as {
      sub: string;
      email?: string;
      email_verified?: boolean;
      given_name?: string;
      family_name?: string;
      name?: string;
    };
    if (!data.email) throw new Error('Google did not return email — enable email scope');
    return {
      providerId: data.sub,
      email: data.email.toLowerCase(),
      emailVerified: data.email_verified ?? false,
      firstName: data.given_name ?? data.name?.split(' ')[0] ?? data.email.split('@')[0] ?? 'user',
      lastName: data.family_name ?? data.name?.split(' ').slice(1).join(' ') ?? '',
      displayName: data.name ?? data.email,
    };
  } else {
    // Microsoft Graph
    const res = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`MS Graph /me failed: ${res.status}`);
    const data = (await res.json()) as {
      id: string;
      mail?: string;
      userPrincipalName?: string;
      givenName?: string;
      surname?: string;
      displayName?: string;
    };
    const email = (data.mail ?? data.userPrincipalName ?? '').toLowerCase();
    if (!email) throw new Error('Microsoft did not return email');
    return {
      providerId: data.id,
      email,
      emailVerified: true, // Microsoft Entra IDs have verified emails
      firstName: data.givenName ?? email.split('@')[0] ?? 'user',
      lastName: data.surname ?? '',
      displayName: data.displayName ?? email,
    };
  }
}

// ---------------------------------------------------------------------------
// User provisioning
// ---------------------------------------------------------------------------

type ProvisionResult =
  | {
      success: true;
      user: WithId<User>;
      org: WithId<Organisation>;
      membershipId: string;
      isNew: boolean;
      wasInvite: boolean;
    }
  | { success: false; errorCode: string };

async function provisionOrFindUser(args: {
  db: Db;
  provider: 'google' | 'microsoft';
  providerUser: ProviderUserInfo;
  statePayload: ReturnType<typeof verifyOAuthState>;
}): Promise<ProvisionResult> {
  const { db, provider, providerUser, statePayload } = args;
  const authProviderEnum = provider === 'google' ? AuthProvider.GOOGLE : AuthProvider.MICROSOFT;

  const usersCol = db.collection<User>('users');
  const orgsCol = db.collection<Organisation>('organisations');
  const membershipsCol = db.collection('memberships');

  // Find existing user by provider ID
  const existingUser = (await usersCol.findOne({
    authProviders: {
      $elemMatch: { provider: authProviderEnum, providerId: providerUser.providerId },
    },
    deletedAt: null,
  })) as WithId<User> | null;

  if (existingUser) {
    // Existing user — find their default membership to get the active org
    const defaultMembership = await membershipsCol.findOne({
      userId: String(existingUser._id),
      isDefault: true,
      status: 'ACTIVE',
      deletedAt: null,
    });

    if (!defaultMembership) return { success: false, errorCode: 'membership_not_found' };

    const { ObjectId } = await import('mongodb');
    const org = (await orgsCol.findOne({
      _id: new ObjectId(defaultMembership['organisationId'] as string) as never,
      deletedAt: null,
    })) as WithId<Organisation> | null;
    if (!org) return { success: false, errorCode: 'org_not_found' };
    if (org.status !== 'ACTIVE') return { success: false, errorCode: 'org_inactive' };

    // Check allowedAuthProviders
    const allowedProviders: string[] = org.allowedAuthProviders ?? [];
    if (allowedProviders.length > 0 && !allowedProviders.includes(authProviderEnum)) {
      return { success: false, errorCode: 'provider_not_allowed' };
    }

    // Touch lastLoginAt
    await usersCol.updateOne(
      { _id: existingUser._id },
      { $set: { lastLoginAt: new Date().toISOString() } },
    );

    return {
      success: true,
      user: existingUser,
      org,
      membershipId: String(defaultMembership['_id']),
      isNew: false,
      wasInvite: false,
    };
  }

  // -------------------------------------------------------------------------
  // K18.3: Invite-accept via OAuth
  // When invitationToken is present, accept the pending invite instead of
  // creating a new user or requiring a pendingOrg registration.
  // -------------------------------------------------------------------------
  if (statePayload.invitationToken) {
    return await acceptInviteViaOAuth({
      db,
      invitationToken: statePayload.invitationToken,
      authProviderEnum,
      providerUser,
    });
  }

  // New user — must have pendingOrg (self-serve registration)
  if (!statePayload.pendingOrg) {
    return { success: false, errorCode: 'invite_required' };
  }

  // Self-serve registration: create new org + first ADMIN user
  const { name: orgName, contactEmail, dpaAcceptedAt } = statePayload.pendingOrg;
  const now = new Date().toISOString();
  const slug = slugify(orgName);

  // Check slug uniqueness
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
    primaryContactEmail: contactEmail.toLowerCase(),
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
    registeredBy: null, // will update after user creation
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

  // Insert user as ADMIN
  const userInsert = await usersCol.insertOne({
    organisationId: orgId.toString(),
    email: providerUser.email,
    firstName: providerUser.firstName,
    lastName: providerUser.lastName,
    displayName: providerUser.displayName,
    accountType: AccountType.ENTRA_ID,
    entraOid: null,
    authProviders: [
      {
        provider: authProviderEnum,
        providerId: providerUser.providerId,
        email: providerUser.email,
        linkedAt: now,
      },
    ],
    emailVerified: providerUser.emailVerified,
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

  // Update org.registeredBy
  await orgsCol.updateOne(
    { _id: orgId },
    { $set: { registeredBy: userId.toString(), updatedAt: now } },
  );

  const newUser = (await usersCol.findOne({ _id: userId } as never)) as WithId<User>;
  const newOrg = (await orgsCol.findOne({ _id: orgId } as never)) as WithId<Organisation>;

  // Create default Membership for the new ADMIN user (K9 pattern)
  const { ObjectId: ObjId2 } = await import('mongodb');
  const membershipNow = new Date().toISOString();
  const membershipInsert = await db.collection('memberships').insertOne({
    userId: userId.toString(),
    organisationId: orgId.toString(),
    roles: [UserRole.ADMIN],
    organizationalUnit: null,
    teams: [],
    status: 'ACTIVE',
    isDefault: true,
    invitedBy: 'SYSTEM',
    invitedAt: membershipNow,
    acceptedAt: membershipNow,
    mustChangePassword: false,
    lastAccessedAt: membershipNow,
    notifications: { email: true, push: false },
    createdAt: membershipNow,
    updatedAt: membershipNow,
    createdBy: userId.toString(),
    updatedBy: userId.toString(),
    deletedAt: null,
    deletedBy: null,
  });
  void ObjId2; // suppress unused import warning

  return {
    success: true,
    user: newUser,
    org: newOrg,
    membershipId: String(membershipInsert.insertedId),
    isNew: true,
    wasInvite: false,
  };
}

async function acceptInviteViaOAuth(args: {
  db: Db;
  invitationToken: string;
  authProviderEnum: AuthProvider;
  providerUser: ProviderUserInfo;
}): Promise<ProvisionResult> {
  const { db, invitationToken, authProviderEnum, providerUser } = args;
  const usersCol = db.collection<User>('users');
  const orgsCol = db.collection<Organisation>('organisations');
  const membershipsCol = db.collection('memberships');
  const invitationsCol = db.collection('invitations');
  const { ObjectId } = await import('mongodb');
  const now = new Date().toISOString();

  // ----- Try new invitations collection first (K13) -----
  const newInv = await invitationsCol.findOne({
    token: invitationToken,
    status: 'PENDING',
    deletedAt: null,
  });

  if (newInv) {
    // Check expiry
    if (new Date(newInv['expiresAt'] as string) < new Date()) {
      return { success: false, errorCode: 'invite_expired' };
    }

    const invEmail = (newInv['email'] as string).toLowerCase();
    if (invEmail !== providerUser.email.toLowerCase()) {
      return { success: false, errorCode: 'invite_email_mismatch' };
    }

    const org = (await orgsCol.findOne({
      _id: new ObjectId(newInv['organisationId'] as string) as never,
      deletedAt: null,
    })) as WithId<Organisation> | null;
    if (!org) return { success: false, errorCode: 'org_not_found' };
    if (org.status !== 'ACTIVE') return { success: false, errorCode: 'org_inactive' };

    const invitedUserId = newInv['invitedUserId'] as string | null;

    let user: WithId<User>;

    if (invitedUserId) {
      // K13: Cross-tenant — existing user joins new org
      const existingUser = (await usersCol.findOne({
        _id: new ObjectId(invitedUserId) as never,
        deletedAt: null,
      })) as WithId<User> | null;
      if (!existingUser) return { success: false, errorCode: 'user_not_found' };

      // Link OAuth provider if not already linked
      const alreadyLinked = (
        (existingUser.authProviders ?? []) as Array<{ provider: string; providerId: string }>
      ).some((p) => p.provider === authProviderEnum && p.providerId === providerUser.providerId);

      if (!alreadyLinked) {
        await usersCol.updateOne(
          { _id: existingUser._id },
          {
            $push: {
              authProviders: {
                provider: authProviderEnum,
                providerId: providerUser.providerId,
                email: providerUser.email,
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
      // New-user invite via OAuth — create User
      const userInsert = await usersCol.insertOne({
        email: invEmail,
        firstName: newInv['firstName'] ?? providerUser.firstName,
        lastName: newInv['lastName'] ?? providerUser.lastName,
        displayName: providerUser.displayName,
        accountType: AccountType.ENTRA_ID,
        entraOid: null,
        authProviders: [
          {
            provider: authProviderEnum,
            providerId: providerUser.providerId,
            email: providerUser.email,
            linkedAt: now,
          },
        ],
        emailVerified: providerUser.emailVerified,
        emailVerificationToken: null,
        emailVerificationExpiresAt: null,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
        passwordHash: null,
        roles: newInv['roles'],
        isActive: true,
        lastLoginAt: now,
        mfaEnabled: false,
        mfaSecret: null,
        mfaRecoveryCodes: [],
        mfaEnabledAt: null,
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

    // Create Membership in target org
    const membershipInsert = await membershipsCol.insertOne({
      userId: String(user._id),
      organisationId: newInv['organisationId'],
      roles: newInv['roles'],
      organizationalUnit: null,
      teams: [],
      status: 'ACTIVE',
      isDefault: invitedUserId ? false : true,
      invitedBy: newInv['invitedBy'],
      invitedAt: newInv['createdAt'],
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

    // Mark invitation ACCEPTED
    await invitationsCol.updateOne(
      { _id: newInv['_id'] },
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
      isNew: !invitedUserId,
      wasInvite: true,
    };
  }

  // ----- Legacy ghost-user fallback (pre-K10 invitations) -----
  const pendingUser = (await usersCol.findOne({
    emailVerificationToken: invitationToken,
    passwordHash: null,
    emailVerified: false,
    deletedAt: null,
  } as never)) as WithId<User> | null;

  if (!pendingUser) {
    return { success: false, errorCode: 'invite_not_found' };
  }

  if (new Date(pendingUser.emailVerificationExpiresAt ?? 0) < new Date()) {
    return { success: false, errorCode: 'invite_expired' };
  }

  if (pendingUser.email.toLowerCase() !== providerUser.email.toLowerCase()) {
    return { success: false, errorCode: 'invite_email_mismatch' };
  }

  const org = (await orgsCol.findOne({
    _id: new ObjectId(pendingUser.organisationId as string) as never,
    deletedAt: null,
  })) as WithId<Organisation> | null;

  if (!org) return { success: false, errorCode: 'org_not_found' };
  if (org.status !== 'ACTIVE') return { success: false, errorCode: 'org_inactive' };

  await usersCol.updateOne(
    { _id: pendingUser._id },
    {
      $set: {
        accountType: AccountType.ENTRA_ID,
        authProviders: [
          {
            provider: authProviderEnum,
            providerId: providerUser.providerId,
            email: providerUser.email,
            linkedAt: now,
          },
        ],
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpiresAt: null,
        ...(pendingUser.firstName ? {} : { firstName: providerUser.firstName }),
        ...(pendingUser.lastName ? {} : { lastName: providerUser.lastName }),
        displayName:
          pendingUser.firstName && pendingUser.lastName
            ? `${pendingUser.firstName} ${pendingUser.lastName}`
            : providerUser.displayName,
        lastLoginAt: now,
        updatedAt: now,
        updatedBy: String(pendingUser._id),
      } as Partial<User>,
    },
  );

  const activatedUser = (await usersCol.findOne({ _id: pendingUser._id } as never)) as WithId<User>;
  return {
    success: true,
    user: activatedUser,
    org,
    membershipId: '',
    isNew: false,
    wasInvite: true,
  };
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

function setAuthCookies(
  reply: FastifyReply,
  accessToken: string,
  refreshToken: string,
  accessTtlSeconds: number,
  refreshTtlDays: number,
): void {
  const isProd = process.env['NODE_ENV'] === 'production';

  reply.setCookie('inv_access', accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    ...(isProd && { domain: '.inventario.estate' }),
    maxAge: accessTtlSeconds,
  });

  reply.setCookie('inv_refresh', refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/v1/auth/refresh',
    ...(isProd && { domain: '.inventario.estate' }),
    maxAge: refreshTtlDays * 24 * 60 * 60,
  });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // strip diacritics
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'org'
  );
}
