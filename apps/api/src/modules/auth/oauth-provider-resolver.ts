// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Per-request OAuth provider credential resolution (ADR-0031 E3).
 *
 * Replaces the boot-time `buildProviders()` map with a per-request
 * resolver that checks the tenant's own credentials first, then falls
 * back to platform env vars.
 *
 * Resolution order:
 *   1. org.oauthCredentials?.[provider] — tenant's own Azure/Google App
 *      (clientSecret decrypted with OAUTH_SECRET_ENCRYPTION_KEY)
 *   2. Platform env vars (MICROSOFT_CLIENT_ID / GOOGLE_CLIENT_ID …)
 *   3. null — provider unavailable → caller returns 503
 *
 * Arctic provider instances are cheap to construct (no network calls at
 * build time), so building per-request is fine on serverless. This also
 * eliminates the warm-cache reliability concern on Vercel.
 */

import { Google, MicrosoftEntraId } from 'arctic';

import { decryptClientSecret } from '../../lib/oauth-crypto.js';

import type { ResolvedConfig } from '../../plugins/config.js';
import type { OrgOAuthCredentials, Organisation } from '@inventario/shared-types';
import type { WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OAuthProviderName = 'google' | 'microsoft';

export interface ResolvedCredentials {
  clientId: string;
  clientSecret: string;
  /** 'tenant' = from org DB; 'platform' = from env vars */
  source: 'tenant' | 'platform';
  /**
   * For Microsoft: the Entra audience / tenant mode.
   * 'organizations' (default) | 'common' | specific tenant UUID.
   */
  tenantMode: string;
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve OAuth credentials for the given provider and org.
 *
 * @param org       The Organisation document (may be null for new-org registration)
 * @param provider  'google' | 'microsoft'
 * @param config    Fastify resolved config (contains platform env vars)
 * @param keyHex    OAUTH_SECRET_ENCRYPTION_KEY (64 hex chars)
 * @returns         Resolved credentials or null if provider unavailable
 */
export function resolveProviderCredentials(
  org: WithId<Organisation> | null,
  provider: OAuthProviderName,
  config: ResolvedConfig,
  keyHex: string | undefined,
): ResolvedCredentials | null {
  // ----- 1. Tenant-specific credentials (per-tenant app) -----
  if (org && keyHex) {
    const tenantCreds = getTenantCredentials(org.oauthCredentials ?? null, provider, keyHex);
    if (tenantCreds) return tenantCreds;
  }

  // ----- 2. Platform env fallback -----
  return getPlatformCredentials(provider, config);
}

// ---------------------------------------------------------------------------
// Arctic provider factory
// ---------------------------------------------------------------------------

/**
 * Build an Arctic OAuth provider instance from resolved credentials.
 * Returns null if credentials are unavailable.
 */
export function buildArcticProvider(
  credentials: ResolvedCredentials,
  provider: OAuthProviderName,
  redirectBase: string,
): Google | MicrosoftEntraId | null {
  if (provider === 'google') {
    return new Google(credentials.clientId, credentials.clientSecret, `${redirectBase}/google`);
  }

  if (provider === 'microsoft') {
    return new MicrosoftEntraId(
      // tenantMode: 'organizations' | 'common' | specific UUID
      credentials.tenantMode || 'organizations',
      credentials.clientId,
      credentials.clientSecret,
      `${redirectBase}/microsoft`,
    );
  }

  return null;
}

/**
 * Convenience: resolve credentials AND build Arctic provider in one call.
 * Returns null if the provider is unavailable.
 */
export function resolveArcticProvider(
  org: WithId<Organisation> | null,
  provider: OAuthProviderName,
  config: ResolvedConfig,
  keyHex: string | undefined,
  redirectBase: string,
): { provider: Google | MicrosoftEntraId; credentials: ResolvedCredentials } | null {
  const credentials = resolveProviderCredentials(org, provider, config, keyHex);
  if (!credentials) return null;

  const arcticProvider = buildArcticProvider(credentials, provider, redirectBase);
  if (!arcticProvider) return null;

  return { provider: arcticProvider, credentials };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function getTenantCredentials(
  oauthCredentials: OrgOAuthCredentials | null,
  provider: OAuthProviderName,
  keyHex: string,
): ResolvedCredentials | null {
  const slot = oauthCredentials?.[provider];
  if (!slot?.clientId || !slot.clientSecretEncrypted) return null;

  let clientSecret: string;
  try {
    clientSecret = decryptClientSecret(slot.clientSecretEncrypted, keyHex);
  } catch {
    // Decryption failure (wrong key or tampered data) — fall through to platform
    return null;
  }

  return {
    clientId: slot.clientId,
    clientSecret,
    source: 'tenant',
    tenantMode: slot.tenantMode ?? 'organizations',
  };
}

function getPlatformCredentials(
  provider: OAuthProviderName,
  config: ResolvedConfig,
): ResolvedCredentials | null {
  if (provider === 'google') {
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) return null;
    return {
      clientId: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
      source: 'platform',
      tenantMode: 'organizations', // unused for Google
    };
  }

  if (provider === 'microsoft') {
    if (!config.MICROSOFT_CLIENT_ID || !config.MICROSOFT_CLIENT_SECRET) return null;
    return {
      clientId: config.MICROSOFT_CLIENT_ID,
      clientSecret: config.MICROSOFT_CLIENT_SECRET,
      source: 'platform',
      tenantMode: 'organizations',
    };
  }

  return null;
}
