// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { describe, expect, it } from 'vitest';

import { encryptClientSecret } from '../../src/lib/oauth-crypto.js';
import { resolveProviderCredentials } from '../../src/modules/auth/oauth-provider-resolver.js';

import type { ResolvedConfig } from '../../src/plugins/config.js';
import type { OrgOAuthCredentials, Organisation } from '@inventario/shared-types';
import type { WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_KEY = 'a'.repeat(64); // 32 bytes

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    NODE_ENV: 'test',
    PORT: 3000,
    LOG_LEVEL: 'silent',
    MONGO_URI: 'mongodb://localhost:27017',
    MONGO_DB_NAME: 'test',
    CORS_ORIGINS: ['http://localhost:3001'],
    ENABLE_SWAGGER: false,
    FRONTEND_BASE_URL: 'http://localhost:3001',
    EMAIL_PROVIDER: 'stub',
    EMAIL_FROM_ADDRESS: 'noreply@test.inventario',
    EMAIL_FROM_NAME: 'Inventario Test',
    JWT_ACCESS_TOKEN_TTL_SECONDS: 900,
    JWT_REFRESH_TOKEN_TTL_DAYS: 30,
    WEBAUTHN_EXPECTED_ORIGINS: [],
    ENTRA_ISSUER_RESOLVED: 'https://login.microsoftonline.com/test/v2.0',
    ENTRA_JWKS_URI_RESOLVED: 'https://login.microsoftonline.com/test/discovery/v2.0/keys',
    ENTRA_ACCEPTED_AUDIENCES: Object.freeze(['test-audience'] as const),
    ...overrides,
  } as ResolvedConfig;
}

function makeOrg(oauthCredentials: OrgOAuthCredentials | null = null): WithId<Organisation> {
  return {
    _id: 'test-org-id' as unknown as Organisation['_id'],
    displayName: 'Test Org',
    slug: 'test-org',
    entraTenantId: null,
    customDomain: null,
    status: 'ACTIVE' as const,
    plan: 'FREE' as const,
    primaryContactEmail: null,
    brandKit: null,
    billing: null,
    settings: {},
    appBaseUrl: null,
    publicAssetLookup: false,
    foundContactInfo: null,
    inventoryNumberFormat: null,
    protocolSettings: null,
    labelPrinting: null,
    allowedAuthProviders: [
      'GOOGLE',
      'APPLE',
      'MICROSOFT',
      'EMAIL',
    ] as Organisation['allowedAuthProviders'],
    memberJoinPolicy: 'INVITE_ONLY' as const,
    autoJoinDomains: [],
    registeredBy: null,
    registrationMethod: 'SELF_SERVE' as const,
    onboardingCompletedAt: null,
    dpaAcceptedAt: null,
    dpaAcceptedBy: null,
    oauthCredentials,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'SYSTEM',
    updatedBy: 'SYSTEM',
    deletedAt: null,
    deletedBy: null,
  } as unknown as WithId<Organisation>;
}

// ---------------------------------------------------------------------------
// resolveProviderCredentials
// ---------------------------------------------------------------------------

describe('resolveProviderCredentials', () => {
  describe('platform fallback (no tenant credentials)', () => {
    it('returns null when provider not configured in env', () => {
      const config = makeConfig({
        MICROSOFT_CLIENT_ID: undefined,
        MICROSOFT_CLIENT_SECRET: undefined,
      });
      const result = resolveProviderCredentials(null, 'microsoft', config, TEST_KEY);
      expect(result).toBeNull();
    });

    it('returns platform credentials when env vars set', () => {
      const config = makeConfig({
        MICROSOFT_CLIENT_ID: 'platform-client-id',
        MICROSOFT_CLIENT_SECRET: 'platform-client-secret',
      });
      const result = resolveProviderCredentials(null, 'microsoft', config, TEST_KEY);
      expect(result).not.toBeNull();
      expect(result?.source).toBe('platform');
      expect(result?.clientId).toBe('platform-client-id');
      expect(result?.clientSecret).toBe('platform-client-secret');
    });

    it('returns platform Google credentials', () => {
      const config = makeConfig({
        GOOGLE_CLIENT_ID: 'google-id',
        GOOGLE_CLIENT_SECRET: 'google-secret',
      });
      const result = resolveProviderCredentials(null, 'google', config, TEST_KEY);
      expect(result?.source).toBe('platform');
      expect(result?.clientId).toBe('google-id');
    });
  });

  describe('tenant credentials (per-tenant app)', () => {
    it('returns tenant credentials when org has them', () => {
      const plaintext = 'tenant-client-secret';
      const encrypted = encryptClientSecret(plaintext, TEST_KEY);
      const org = makeOrg({
        microsoft: {
          clientId: 'tenant-client-id',
          clientSecretEncrypted: encrypted,
          tenantMode: 'organizations',
          configuredAt: new Date().toISOString(),
          configuredBy: null,
        },
        google: null,
      });
      const config = makeConfig({
        MICROSOFT_CLIENT_ID: 'platform-client-id',
        MICROSOFT_CLIENT_SECRET: 'platform-client-secret',
      });
      const result = resolveProviderCredentials(org, 'microsoft', config, TEST_KEY);
      expect(result?.source).toBe('tenant');
      expect(result?.clientId).toBe('tenant-client-id');
      expect(result?.clientSecret).toBe(plaintext);
    });

    it('falls back to platform when tenant secret decryption fails (wrong key)', () => {
      const encrypted = encryptClientSecret('secret', TEST_KEY);
      const org = makeOrg({
        microsoft: {
          clientId: 'tenant-client-id',
          clientSecretEncrypted: encrypted,
          tenantMode: null,
          configuredAt: new Date().toISOString(),
          configuredBy: null,
        },
        google: null,
      });
      const config = makeConfig({
        MICROSOFT_CLIENT_ID: 'platform-id',
        MICROSOFT_CLIENT_SECRET: 'platform-secret',
      });
      const wrongKey = 'b'.repeat(64);
      const result = resolveProviderCredentials(org, 'microsoft', config, wrongKey);
      // Decryption failed → falls back to platform
      expect(result?.source).toBe('platform');
    });

    it('falls back to platform when org has no microsoft slot', () => {
      const org = makeOrg({ microsoft: null, google: null });
      const config = makeConfig({
        MICROSOFT_CLIENT_ID: 'platform-id',
        MICROSOFT_CLIENT_SECRET: 'platform-secret',
      });
      const result = resolveProviderCredentials(org, 'microsoft', config, TEST_KEY);
      expect(result?.source).toBe('platform');
    });

    it('falls back to platform when keyHex is undefined', () => {
      const encrypted = encryptClientSecret('secret', TEST_KEY);
      const org = makeOrg({
        microsoft: {
          clientId: 'tenant-id',
          clientSecretEncrypted: encrypted,
          tenantMode: null,
          configuredAt: new Date().toISOString(),
          configuredBy: null,
        },
        google: null,
      });
      const config = makeConfig({
        MICROSOFT_CLIENT_ID: 'platform-id',
        MICROSOFT_CLIENT_SECRET: 'platform-secret',
      });
      const result = resolveProviderCredentials(org, 'microsoft', config, undefined);
      expect(result?.source).toBe('platform');
    });

    it('returns null when tenant decrypt fails AND no platform fallback', () => {
      const encrypted = encryptClientSecret('secret', TEST_KEY);
      const org = makeOrg({
        microsoft: {
          clientId: 'tenant-id',
          clientSecretEncrypted: encrypted,
          tenantMode: null,
          configuredAt: new Date().toISOString(),
          configuredBy: null,
        },
        google: null,
      });
      const config = makeConfig({
        MICROSOFT_CLIENT_ID: undefined,
        MICROSOFT_CLIENT_SECRET: undefined,
      });
      const wrongKey = 'b'.repeat(64);
      const result = resolveProviderCredentials(org, 'microsoft', config, wrongKey);
      expect(result).toBeNull();
    });
  });
});
