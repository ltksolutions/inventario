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
import fp from 'fastify-plugin';

import { selectAutoJoinOrg } from '../../lib/auto-join.js';
import { seedTenantDefaults } from '../../lib/seed-tenant-defaults.js';
import { UnauthorizedError } from '../../plugins/error-handler.js';

import { setAuthCookies } from './cookie-helpers.js';
import { createLinkToken } from './link-provider.routes.js';
import { type OAuthProviderName, resolveArcticProvider } from './oauth-provider-resolver.js';
import {
  OAUTH_STATE_COOKIE,
  OAuthStateError,
  generateOAuthState,
  oauthStateCookieOptions,
  serializeOAuthState,
  verifyOAuthState,
} from './oauth-state.js';

import type { Organisation, User } from '@inventario/shared-types';
import type { Google, MicrosoftEntraId } from 'arctic';
import type { FastifyPluginAsync } from 'fastify';
import type { Db, WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const oauthRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const { OAUTH_STATE_SECRET, OAUTH_REDIRECT_BASE_URL, FRONTEND_BASE_URL } = fastify.config;

  // -------------------------------------------------------------------------
  // POST /v1/auth/logout + POST /v1/auth/refresh
  // These are registered regardless of OAuth config.
  // -------------------------------------------------------------------------
  registerRefreshRoute(fastify);

  // Skip registration if OAuth is not configured (backward compat during transition)
  if (!OAUTH_STATE_SECRET || !OAUTH_REDIRECT_BASE_URL) {
    fastify.log.info(
      'OAUTH_STATE_SECRET / OAUTH_REDIRECT_BASE_URL not set — OAuth routes skipped.',
    );
    return;
  }

  // -------------------------------------------------------------------------
  // GET /v1/auth/login/:provider
  //
  // ADR-0031 E3: provider credentials resolved per-request from org (if slug
  // hint provided via ?org=<slug>) or platform env fallback.
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
      /** ADR-0031 E4: tenant slug hint for per-tenant app resolution. */
      org?: string;
    };
  }>('/v1/auth/login/:provider', async (request, reply) => {
    const { provider } = request.params;

    if (provider !== 'google' && provider !== 'microsoft') {
      return reply.code(400).send({ error: `Unknown provider: ${provider}` });
    }

    const {
      redirectAfter,
      orgName,
      contactEmail,
      ico,
      dpaAcceptedAt,
      invitationToken,
      org: orgSlug,
    } = request.query;

    // Resolve org for per-tenant credentials (ADR-0031 E3)
    let orgDoc: WithId<Organisation> | null = null;
    if (orgSlug) {
      orgDoc = (await fastify.mongo.db
        .collection<Organisation>('organisations')
        .findOne({ slug: orgSlug, deletedAt: null })) as WithId<Organisation> | null;
    }

    const resolved = resolveArcticProvider(
      orgDoc,
      provider as OAuthProviderName,
      fastify.config,
      fastify.config.OAUTH_SECRET_ENCRYPTION_KEY,
      OAUTH_REDIRECT_BASE_URL,
    );

    if (!resolved) {
      return reply.code(503).send({ error: `Provider ${provider} is not configured.` });
    }

    // Build state payload (carries PKCE verifier + metadata across redirect)
    const statePayload = generateOAuthState({
      provider: provider as OAuthProviderName,
      ...(redirectAfter !== undefined && { redirectAfter }),
      ...(invitationToken !== undefined && { invitationToken }),
      ...(orgSlug !== undefined && { orgSlug }),
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
      resolved.provider,
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
  //
  // ADR-0031 E3: rebuild provider from statePayload.orgSlug to guarantee
  // the same credentials as login redirect (critical for token exchange).
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

    // ADR-0031 E3: rebuild provider from orgSlug in state (same credentials as login)
    let orgDoc: WithId<Organisation> | null = null;
    if (statePayload.orgSlug) {
      orgDoc = (await fastify.mongo.db
        .collection<Organisation>('organisations')
        .findOne({ slug: statePayload.orgSlug, deletedAt: null })) as WithId<Organisation> | null;
    }

    const resolved = resolveArcticProvider(
      orgDoc,
      provider as OAuthProviderName,
      fastify.config,
      fastify.config.OAUTH_SECRET_ENCRYPTION_KEY,
      OAUTH_REDIRECT_BASE_URL,
    );

    if (!resolved) {
      return reply.redirect(`${FRONTEND_BASE_URL}/login?error=oauth_not_configured`);
    }

    // Exchange code for tokens
    let providerUser: ProviderUserInfo;
    try {
      providerUser = await exchangeCodeAndGetUserInfo(
        resolved.provider,
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
        const code = result.errorCode;

        // Password path: /link-account?token=<t>&hint=<masked>
        if (code.startsWith('link_required&')) {
          return reply.redirect(
            `${FRONTEND_BASE_URL}/link-account?${code.slice('link_required&'.length)}`,
          );
        }

        // Magic-link path: send email then redirect /link-account?method=email&hint=<masked>
        if (code.startsWith('link_required_magic&')) {
          const params = new URLSearchParams(code.slice('link_required_magic&'.length));
          const userId = params.get('userId') ?? '';
          const linkProvider = params.get('provider') as AuthProvider;
          const linkProviderId = params.get('providerId') ?? '';
          const linkProviderEmail = decodeURIComponent(params.get('providerEmail') ?? '');
          const hint = params.get('hint') ?? '';

          // Create magic-link token and send email (best-effort)
          try {
            const { createLinkToken: clt } = await import('./link-provider.routes.js');
            const linkResult = await clt(fastify.mongo.db, {
              userId,
              newProvider: linkProvider,
              newProviderId: linkProviderId,
              newProviderEmail: linkProviderEmail,
              hasPassword: false,
            });

            const apiBase = OAUTH_REDIRECT_BASE_URL.replace(/\/v1\/auth\/callback.*$/, '');
            const verifyUrl = `${apiBase}/v1/auth/link-provider/verify?token=${linkResult.token}`;

            await fastify.emailService.sendLinkProviderEmail(
              linkProviderEmail,
              verifyUrl,
              provider,
            );
          } catch (emailErr) {
            fastify.log.error(
              { err: emailErr },
              'Failed to send magic-link email for account linking',
            );
          }

          return reply.redirect(
            `${FRONTEND_BASE_URL}/link-account?method=email&hint=${encodeURIComponent(hint)}`,
          );
        }

        return reply.redirect(`${FRONTEND_BASE_URL}/login?error=${result.errorCode}`);
      }

      const { user, org, membershipId, role, isNew, wasInvite } = result;

      // Issue tokens — always include membershipId (K5 mid claim) and the
      // per-tenant role from the resolved membership (ADR-0015 + ADR-0029).
      const accessToken = await fastify.inventarioJwt.issueAccessToken(
        user,
        org,
        membershipId,
        role,
      );
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

  // logout + refresh are registered via registerRefreshRoute() above the guard
};

export default fp(oauthRoutesPlugin, {
  name: 'oauth-routes',
  dependencies: ['config', 'mongo', 'inventario-jwt'],
});

// ---------------------------------------------------------------------------
// Refresh + Logout — always registered, regardless of OAuth config
// ---------------------------------------------------------------------------

function registerRefreshRoute(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.post('/v1/auth/logout', async (request, reply) => {
    const refreshToken = request.cookies?.['inv_refresh'];
    if (refreshToken) {
      await fastify.inventarioJwt.revokeRefreshToken(refreshToken);
    }
    const cookieDomain = process.env['COOKIE_DOMAIN'];
    const isProd = Boolean(cookieDomain);
    const baseOpts = {
      httpOnly: true,
      secure: isProd,
      sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    };
    reply.clearCookie('inv_access', { ...baseOpts, path: '/' });
    reply.clearCookie('inv_refresh', { ...baseOpts, path: '/v1/auth/refresh' });
    return reply.code(204).send();
  });

  fastify.post('/v1/auth/refresh', async (request, reply) => {
    const rawRefresh = request.cookies?.['inv_refresh'];
    if (!rawRefresh) {
      throw new UnauthorizedError('No refresh token');
    }

    const { newRawToken, userId } = await fastify.inventarioJwt.rotateRefreshToken(
      rawRefresh,
      request,
    );

    const { ObjectId } = await import('mongodb');
    const usersCol = fastify.mongo.db.collection<User>('users');
    const orgsCol = fastify.mongo.db.collection<Organisation>('organisations');
    const membershipsCol = fastify.mongo.db.collection('memberships');

    const user = (await usersCol.findOne({
      _id: new ObjectId(userId),
      deletedAt: null,
    } as never)) as WithId<User> | null;
    if (!user) throw new UnauthorizedError('User not found');

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
      (defaultMembership['role'] as string) ?? 'EMPLOYEE',
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
      : // Microsoft: User.Read is required so the post-exchange call to
        // Graph /me succeeds even when the app registration lacks the
        // delegated permission (Graph returns 403 otherwise). Requesting
        // it as a scope lets Microsoft grant it at consent time.
        ['openid', 'profile', 'email', 'offline_access', 'User.Read'];
  const url = provider.createAuthorizationURL(state, codeVerifier, scopes);

  // Vynútiť výber účtu. Bez tohto Microsoft/Google pri aktívnom SSO ticho
  // prihlásia už prihlásený účet z iného tabu/služby — používateľ tak môže
  // skončiť prihlásený nesprávnym (napr. cudzím tenant) účtom a callback
  // zlyhá na entra_tenant_mismatch / invite_required. `select_account`
  // zaručí, že sa vždy zobrazí výber účtu. (Zámerne bez domain_hint, aby
  // sme neobmedzovali iné domény/organizácie.)
  url.searchParams.set('prompt', 'select_account');

  return url;
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
  /** Microsoft Entra tenant ID from id_token `tid` claim. Null for Google/Apple. */
  entraTid: string | null;
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
      entraTid: null,
    };
  } else {
    // Microsoft: read tid from id_token claim (NOT from Graph /me — Graph does not
    // reliably return tid). Arctic's validateAuthorizationCode returns tokens with
    // idToken() available when openid scope is requested.
    //
    // ADR-0030 D2: tid is used for per-tenant Entra domain restriction.
    // We decode without re-verifying signature (Arctic already verified it).
    let entraTid: string | null = null;
    try {
      const idTokenPayload = decodeJwtPayload(tokens.idToken());
      entraTid = (idTokenPayload['tid'] as string | undefined) ?? null;
    } catch {
      // Non-fatal: idToken not present or tid missing — domain restriction won't apply
    }

    // Microsoft Graph — for user profile info
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
      entraTid,
    };
  }
}

/**
 * Decode a JWT payload without verifying the signature.
 * Used to extract `tid` from Microsoft id_token after Arctic has already
 * validated the signature during token exchange.
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length < 2 || !parts[1]) throw new Error('Invalid JWT structure');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as Record<
    string,
    unknown
  >;
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
      role: string;
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

    if (!defaultMembership) {
      // Bez členstva: skús auto-join podľa firemnej domény, inak odmietni.
      const autoJoin = await attemptDomainAutoJoin({
        db,
        provider,
        authProviderEnum,
        providerUser,
      });
      if (autoJoin) return autoJoin;
      return { success: false, errorCode: 'membership_not_found' };
    }

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

    // ADR-0030 D2: entraTenantId restriction for Microsoft logins.
    // If the org has entraTenantId set, the Microsoft id_token tid must match.
    // This restricts existing-user logins to the org's Entra directory.
    if (
      provider === 'microsoft' &&
      org.entraTenantId &&
      providerUser.entraTid &&
      providerUser.entraTid !== org.entraTenantId
    ) {
      return { success: false, errorCode: 'entra_tenant_mismatch' };
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
      role: (defaultMembership['role'] as string) ?? 'EMPLOYEE',
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

  // -------------------------------------------------------------------------
  // Account Linking — email-based fallback
  //
  // No providerId match, no invitationToken, no pendingOrg. Before giving up
  // with invite_required, check if a user with the same email already exists.
  // If so, issue a short-lived link_token so the user can prove ownership of
  // the existing account (password or magic-link) without needing an invite.
  //
  // Security: we only do this when providerUser.emailVerified is true.
  // Microsoft Entra always returns emailVerified=true. For Google we gate on
  // the email_verified claim. This prevents account takeover via unverified
  // provider emails.
  // -------------------------------------------------------------------------
  if (!statePayload.pendingOrg && providerUser.emailVerified) {
    const emailMatch = (await usersCol.findOne({
      email: providerUser.email,
      deletedAt: null,
    })) as WithId<User> | null;

    if (emailMatch) {
      const hasPassword = Boolean(emailMatch.passwordHash);
      const linkResult = await createLinkToken(db, {
        userId: String(emailMatch._id),
        newProvider: authProviderEnum,
        newProviderId: providerUser.providerId,
        newProviderEmail: providerUser.email,
        hasPassword,
      });

      if (hasPassword) {
        // Password path: redirect frontend to /link-account with token
        return {
          success: false,
          errorCode: `link_required&token=${linkResult.token}&hint=${encodeURIComponent(linkResult.maskedEmail)}`,
        };
      } else {
        // Magic-link path: send email, redirect frontend to /link-account?method=email
        // Email sending is best-effort — we pass fastify via closure trick
        // (fastify is captured in the outer provisionOrFindUser scope via args)
        // We signal magic_link via a special errorCode and the caller sends the email.
        return {
          success: false,
          errorCode: `link_required_magic&hint=${encodeURIComponent(linkResult.maskedEmail)}&userId=${String(emailMatch._id)}&provider=${authProviderEnum}&providerId=${providerUser.providerId}&providerEmail=${encodeURIComponent(providerUser.email)}`,
        };
      }
    }
  }

  // Auto-join podľa firemnej domény (DOMAIN_RESTRICTED). Beží AŽ po
  // invite/link vetvách — pozvánka aj prepojenie existujúceho účtu majú
  // prednosť. Ak doména sedí práve jednej org, založí používateľa +
  // ACTIVE členstvo (EMPLOYEE) a prihlási ho bez pozvánky.
  const autoJoin = await attemptDomainAutoJoin({ db, provider, authProviderEnum, providerUser });
  if (autoJoin) return autoJoin;

  // New user — must have pendingOrg (self-serve registration)
  if (!statePayload.pendingOrg) {
    return { success: false, errorCode: 'invite_required' };
  }

  // Self-serve registration: create new org + first ADMIN user
  const { name: orgName, contactEmail, ico, dpaAcceptedAt } = statePayload.pendingOrg;
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
    // ADR-0021: QR polia — tenant nakonfiguruje po onboardingu
    appBaseUrl: null,
    publicAssetLookup: false,
    foundContactInfo: null,
    inventoryNumberFormat: null,
    // ADR-0022: preberacie protokoly — default A4, tenant zmení cez Settings
    protocolSettings: null,
    // ADR-0027: tlač QR štítkov — default PDF_SHEET, tenant zmení cez Settings
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
    role: UserRole.ADMIN,
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

  // Seed default číselníky (typy, stavy, kategórie) — best-effort
  try {
    await seedTenantDefaults(db, orgId.toString(), userId.toString());
  } catch (seedErr) {
    // Non-fatal — tenant môže číselníky vytvoriť manuálne
    void seedErr;
  }

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

/**
 * Auto-join podľa firemnej domény (memberJoinPolicy = DOMAIN_RESTRICTED).
 *
 * Volá sa pre prihlasujúceho sa používateľa BEZ pozvánky. Ak jeho e-mailová
 * doména patrí práve jednej ACTIVE org s politikou DOMAIN_RESTRICTED (a pri
 * Microsofte sedí Entra `tid`), založí/dolinkuje používateľa a vytvorí mu
 * ACTIVE členstvo s rolou EMPLOYEE. Inak vráti `null` (volajúci pokračuje
 * štandardným zamietnutím — invite_required / membership_not_found).
 *
 * Výber org je v čistej funkcii `selectAutoJoinOrg` (unit-testovaná).
 */
export async function attemptDomainAutoJoin(args: {
  db: Db;
  provider: 'google' | 'microsoft';
  authProviderEnum: AuthProvider;
  providerUser: ProviderUserInfo;
}): Promise<ProvisionResult | null> {
  const { db, provider, authProviderEnum, providerUser } = args;

  // Auto-join len pri overenom e-maile (Microsoft vždy; Google podľa claimu).
  if (!providerUser.emailVerified) return null;
  const domain = providerUser.email.split('@')[1]?.toLowerCase() ?? '';
  if (!domain) return null;

  const usersCol = db.collection<User>('users');
  const orgsCol = db.collection<Organisation>('organisations');
  const membershipsCol = db.collection('memberships');
  const now = new Date().toISOString();

  // Kandidáti = orgy, ktoré majú túto doménu v autoJoinDomains. Politiku,
  // stav a tenant rieši čistá funkcia.
  const candidates = (await orgsCol
    .find({ autoJoinDomains: domain, deletedAt: null })
    .toArray()) as WithId<Organisation>[];

  const selection = selectAutoJoinOrg(candidates, domain, provider, providerUser.entraTid);
  if (selection.kind !== 'ok') return null;
  const org = selection.org;
  const orgId = String(org._id);

  // Nájsť existujúceho používateľa podľa e-mailu (môže existovať globálne).
  let user = (await usersCol.findOne({
    email: providerUser.email,
    deletedAt: null,
  })) as WithId<User> | null;

  const isNewUser = !user;

  if (user) {
    // Globálne deaktivovaný účet — auto-join nepovolíme.
    if (user.isActive === false) return null;

    // Ak už má ACTIVE členstvo v tejto org, vráť ho (nezakladaj duplicitné).
    const existing = await membershipsCol.findOne({
      userId: String(user._id),
      organisationId: orgId,
      status: 'ACTIVE',
      deletedAt: null,
    });
    if (existing) {
      await usersCol.updateOne({ _id: user._id }, { $set: { lastLoginAt: now, updatedAt: now } });
      return {
        success: true,
        user,
        org,
        membershipId: String(existing['_id']),
        role: (existing['role'] as string) ?? UserRole.EMPLOYEE,
        isNew: false,
        wasInvite: false,
      };
    }

    // Dolinkovať OAuth provider, ak ešte nie je naviazaný.
    const alreadyLinked = (
      (user.authProviders ?? []) as Array<{ provider: string; providerId: string }>
    ).some((p) => p.provider === authProviderEnum && p.providerId === providerUser.providerId);
    if (!alreadyLinked) {
      await usersCol.updateOne(
        { _id: user._id },
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
      await usersCol.updateOne({ _id: user._id }, { $set: { lastLoginAt: now, updatedAt: now } });
    }
    user = (await usersCol.findOne({ _id: user._id } as never)) as WithId<User>;
  } else {
    // Nový používateľ — založiť (rovnaký tvar ako pri invite-accept cez OAuth).
    const userInsert = await usersCol.insertOne({
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
      roles: [UserRole.EMPLOYEE],
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

  // isDefault, ak používateľ nemá iné default ACTIVE členstvo.
  const hasDefault = await membershipsCol.findOne({
    userId: String(user._id),
    isDefault: true,
    status: 'ACTIVE',
    deletedAt: null,
  });

  const membershipInsert = await membershipsCol.insertOne({
    userId: String(user._id),
    organisationId: orgId,
    role: UserRole.EMPLOYEE,
    organizationalUnit: null,
    teams: [],
    status: 'ACTIVE',
    isDefault: !hasDefault,
    invitedBy: null,
    invitedAt: null,
    acceptedAt: now,
    mustChangePassword: false,
    lastAccessedAt: now,
    notifications: { email: true, push: false },
    createdAt: now,
    updatedAt: now,
    createdBy: 'SYSTEM',
    updatedBy: String(user._id),
    deletedAt: null,
    deletedBy: null,
  });

  return {
    success: true,
    user,
    org,
    membershipId: String(membershipInsert.insertedId),
    role: UserRole.EMPLOYEE,
    isNew: isNewUser,
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

    // ADR-0030 D2: entraTenantId restriction at invite-accept.
    // If org has entraTenantId set and user logs in via Microsoft, tid must match.
    if (
      authProviderEnum === AuthProvider.MICROSOFT &&
      org.entraTenantId &&
      providerUser.entraTid &&
      providerUser.entraTid !== org.entraTenantId
    ) {
      return { success: false, errorCode: 'entra_tenant_mismatch' };
    }

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
      role: newInv['role'],
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
      role: (newInv['role'] as string) ?? 'EMPLOYEE',
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
    role: 'EMPLOYEE',
    isNew: false,
    wasInvite: true,
  };
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
