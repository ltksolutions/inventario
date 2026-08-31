// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Config plugin — validates environment variables at startup using Zod.
 *
 * Why: catching a missing/malformed env var at boot is much better than
 * crashing mid-request in production. If validation fails, the server
 * refuses to start and prints a clear error.
 *
 * Usage:
 *   const config = fastify.config; // typed access to all env vars
 *   const mongoUri = config.MONGO_URI;
 */

import fp from 'fastify-plugin';
import { z } from 'zod';

import type { FastifyPluginAsync } from 'fastify';

// ---------------------------------------------------------------------------
// Schema definition
// ---------------------------------------------------------------------------

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

  // MongoDB
  MONGO_URI: z
    .string()
    .min(1, 'MONGO_URI is required')
    .refine(
      (val) => val.startsWith('mongodb://') || val.startsWith('mongodb+srv://'),
      'MONGO_URI must start with mongodb:// or mongodb+srv://',
    ),
  MONGO_DB_NAME: z.string().min(1).default('inventario'),

  // CORS
  // Accepts either:
  //   - '*' (wildcard, allow all origins) — for early dev only, NEVER in real prod
  //   - comma-separated list of origins: 'https://app.sfz.sk,https://staging.sfz.sk'
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3001')
    .transform((val) => {
      const trimmed = val.trim();
      if (trimmed === '*') return '*' as const;
      return trimmed
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }),

  // Feature flags
  //
  // ENABLE_SWAGGER: default je odvodený od NODE_ENV — v produkcii vypnuté.
  // Dôvod je cold start: @fastify/swagger zbiera schémy VŠETKÝCH rout pri
  // boote a generuje z nich OpenAPI dokument, čo je práca navyše pri každom
  // studenom štarte serverless inštancie (lokálne namerané ~45 ms, na
  // Verceli viac). Verejné `/docs` na produkčnom API nikto nepotrebuje —
  // dokumentácia sa generuje do repa a beží na inventario-docs.
  // Explicitné ENABLE_SWAGGER=true naďalej zapne Swagger aj v produkcii
  // (napr. na dočasné ladenie). EXPORT_ONLY je výnimka — export OpenAPI
  // schémy Swagger potrebuje bez ohľadu na NODE_ENV.
  ENABLE_SWAGGER: z
    .enum(['true', 'false'])
    .default(
      process.env['NODE_ENV'] === 'production' && process.env['EXPORT_ONLY'] !== 'true'
        ? 'false'
        : 'true',
    )
    .transform((val) => val === 'true'),

  // ---------------------------------------------------------------------
  // OAuth providers (ADR-0013) — Google + Microsoft + Apple
  // ---------------------------------------------------------------------
  // All are optional during transition; required once MSAL is removed (K17).

  /** 32+ char HMAC secret for signing OAuth state params. */
  OAUTH_STATE_SECRET: z.string().min(32).optional(),
  /** Absolute URL for OAuth callbacks. E.g. https://api.inventario.estate/v1/auth/callback */
  OAUTH_REDIRECT_BASE_URL: z.string().url().optional(),

  // Google
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Microsoft (uses existing Entra app registration, extended for public consumers)
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),

  // Apple (K4)
  APPLE_CLIENT_ID: z.string().optional(), // Services ID (com.sportup.inventario)
  APPLE_TEAM_ID: z.string().optional(), // Apple Developer Team ID
  APPLE_KEY_ID: z.string().optional(), // Key ID from Apple Developer
  APPLE_PRIVATE_KEY: z.string().optional(), // PEM private key (.p8 file content)

  // Frontend base URL — used for post-OAuth redirects
  FRONTEND_BASE_URL: z.string().url().default('http://localhost:3001'),

  // ---------------------------------------------------------------------
  // Email — provider-agnostic (Slice #6c K17.5)
  // ---------------------------------------------------------------------
  //
  // EMAIL_PROVIDER selects the transport for all system emails:
  //   - 'ecomail' → Ecomail.cz transactional API (production default)
  //   - 'resend'  → Resend.com API
  //   - 'stub'    → log to console (dev/test default)
  //
  // When provider is 'ecomail', ECOMAIL_API_KEY is required.
  // When provider is 'resend',  RESEND_API_KEY  is required.
  // The plugin validates this at boot.
  EMAIL_PROVIDER: z.enum(['ecomail', 'resend', 'stub']).default('stub'),
  /** From address shown to recipients. E.g. noreply@inventario.estate */
  EMAIL_FROM_ADDRESS: z.string().email().default('noreply@inventario.estate'),
  /** From display name. E.g. "Inventario" */
  EMAIL_FROM_NAME: z.string().min(1).default('Inventario'),
  /** Optional reply-to address. */
  EMAIL_REPLY_TO: z.string().email().optional(),

  // Ecomail.cz transactional API
  // Get your key: Manage your account → For developers → Copy API Key
  ECOMAIL_API_KEY: z.string().min(1).optional(),

  // Resend.com API key. Format: re_xxxxx
  RESEND_API_KEY: z.string().startsWith('re_', 'RESEND_API_KEY must start with re_').optional(),

  // ---------------------------------------------------------------------
  // TOTP MFA (Slice #7)
  // ---------------------------------------------------------------------
  //
  // 32-byte (64 hex chars) symmetric key for AES-256-GCM encryption of
  // user TOTP secrets at rest. Generate with:
  //   openssl rand -hex 32
  // In tests: the test setup generates an ephemeral key. In production:
  // set this env var to a stable 64-hex-char string. NEVER commit it.
  //
  // If unset, MFA endpoints fail at boot (mfa.routes.ts checks).
  MFA_SECRET_ENCRYPTION_KEY: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, 'MFA_SECRET_ENCRYPTION_KEY must be 64 hex chars (32 bytes)')
    .optional(),

  // ---------------------------------------------------------------------
  // OAuth client secret encryption (ADR-0031)
  // ---------------------------------------------------------------------
  //
  // 32-byte (64 hex chars) symmetric key for AES-256-GCM encryption of
  // per-tenant OAuth client secrets at rest. Separate from
  // MFA_SECRET_ENCRYPTION_KEY (principle of least privilege).
  // Generate with: openssl rand -hex 32
  // If unset, saving per-tenant OAuth credentials returns 503; the
  // platform env fallback (MICROSOFT_CLIENT_ID etc.) still works.
  OAUTH_SECRET_ENCRYPTION_KEY: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, 'OAUTH_SECRET_ENCRYPTION_KEY must be 64 hex chars (32 bytes)')
    .optional(),

  // ---------------------------------------------------------------------
  // WebAuthn / Passkeys (ADR-0016, Slice #8)
  // ---------------------------------------------------------------------
  //
  // WEBAUTHN_RP_ID     — Relying Party ID. Must match the effective domain
  //                      of the origin. Default: 'inventario.estate' (prod).
  //                      Override to 'localhost' in local dev via .env.local.
  // WEBAUTHN_RP_NAME   — Human-readable name shown in browser passkey prompt.
  // WEBAUTHN_EXPECTED_ORIGINS — Comma-separated list of allowed origins.
  //                      Must include the scheme + host (no trailing slash).
  //                      E.g. 'https://app.inventario.estate,http://localhost:3001'
  //
  // If unset, passkey endpoints register 503 stubs (same pattern as MFA).
  WEBAUTHN_RP_ID: z.string().min(1).optional(),
  WEBAUTHN_RP_NAME: z.string().min(1).optional(),
  WEBAUTHN_EXPECTED_ORIGINS: z
    .string()
    .optional()
    .transform((val) =>
      val
        ? val
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    ),

  // ---------------------------------------------------------------------
  // JWT — Inventario JWT (ADR-0013)
  // ---------------------------------------------------------------------
  // RS256 key pair for signing/verifying Inventario access tokens.
  // PEM-encoded strings. Generate with:
  //   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out private.pem
  //   openssl rsa -in private.pem -pubout -out public.pem
  // In production: set these env vars to the key file contents.
  // In tests: the test setup generates an ephemeral key pair.
  // Optional during Slice #6a — required after MSAL cutover in K17.
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  /** Access token lifetime in seconds. Default 900 (15 minutes). */
  JWT_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().positive().default(900),
  /** Refresh token lifetime in days. Default 30 days. */
  JWT_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().positive().default(30),

  // ---------------------------------------------------------------------
  // Auth — Microsoft Entra ID (legacy, kept for backward compat with
  // existing .env.local files; removed from auth flow in Slice #6c K17)
  // ---------------------------------------------------------------------
  // These vars are no longer used by the auth plugin but may still be
  // present in developer .env.local files. Keeping them optional so
  // existing environments don't break at startup.
  ENTRA_TENANT_ID: z.string().uuid().optional(),
  ENTRA_API_CLIENT_ID: z.string().uuid().optional(),
  ENTRA_ISSUER: z.string().url().optional(),
  ENTRA_JWKS_URI: z.string().url().optional(),

  // Test JWT — no longer used (removed in Slice #6c K17)
  TEST_JWT_PUBLIC_KEY: z.string().optional(),

  // ---------------------------------------------------------------------
  // Vercel Cron — retention job (GDPR čl. 5 ods. 1 písm. e)
  // ---------------------------------------------------------------------
  //
  // Secret shared between Vercel cron scheduler and the API endpoint.
  // Vercel auto-sets CRON_SECRET in production deployments; for local
  // dev / manual triggers set it in .env.local. Min 32 chars.
  // If unset, the cron endpoint returns 503 (disabled).
  //
  // Generate: openssl rand -hex 32
  CRON_SECRET: z.string().min(32).optional(),

  // ---------------------------------------------------------------------
  // Migrations — deploy-time trigger (POST /v1/system/migrations/run)
  // ---------------------------------------------------------------------
  //
  // Secret shared between the GitHub Actions post-deploy workflow
  // (.github/workflows/migrate-on-deploy.yml) and this API. Separate from
  // CRON_SECRET on purpose — different trigger (GitHub Actions, not
  // Vercel cron), different rotation/audit trail. Min 32 chars.
  // If unset, the endpoint returns 503 (disabled) and migrations must be
  // run manually or will only be flagged via the cold-start warning log.
  //
  // Generate: openssl rand -hex 32
  MIGRATIONS_SECRET: z.string().min(32).optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Fully resolved configuration — combines validated env vars with values
 * derived from them (e.g. Entra ID issuer URL is built from tenant ID).
 *
 * Use this type when injecting config into services; use `AppConfig` only
 * if you specifically need the env-var-only shape.
 */
export interface ResolvedConfig extends AppConfig {
  // Entra derived fields kept for backward compatibility but unused
  // in the auth flow after Slice #6c K17.
  ENTRA_ISSUER_RESOLVED: string;
  ENTRA_JWKS_URI_RESOLVED: string;
  ENTRA_ACCEPTED_AUDIENCES: readonly string[];
}

// ---------------------------------------------------------------------------
// Fastify decoration — adds `fastify.config` to the instance
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyInstance {
    config: ResolvedConfig;
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const configPlugin: FastifyPluginAsync = async (fastify) => {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    throw new Error('Environment validation failed. Check .env.local against .env.example.');
  }

  const env = parsed.data;

  // -----------------------------------------------------------------------
  // Derive Entra ID endpoints from tenant ID (with override support).
  // -----------------------------------------------------------------------
  //
  // Issuer for v2.0 tokens follows the format:
  //   https://login.microsoftonline.com/<tenant-id>/v2.0
  //
  // JWKS endpoint:
  //   https://login.microsoftonline.com/<tenant-id>/discovery/v2.0/keys
  //
  // The audience in a JWT can appear either as the raw client ID GUID
  // or as the Application ID URI (api://<client-id>). We accept both.
  const tenantId = env.ENTRA_TENANT_ID ?? 'not-configured';
  const issuer = env.ENTRA_ISSUER ?? `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const jwksUri =
    env.ENTRA_JWKS_URI ?? `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
  const acceptedAudiences = Object.freeze([
    env.ENTRA_API_CLIENT_ID ?? 'not-configured',
    `api://${env.ENTRA_API_CLIENT_ID ?? 'not-configured'}`,
  ] as const);

  const resolved: ResolvedConfig = {
    ...env,
    ENTRA_ISSUER_RESOLVED: issuer,
    ENTRA_JWKS_URI_RESOLVED: jwksUri,
    ENTRA_ACCEPTED_AUDIENCES: acceptedAudiences,
  };

  fastify.decorate('config', resolved);
  fastify.log.info(
    {
      nodeEnv: resolved.NODE_ENV,
      port: resolved.PORT,
      mongoDb: resolved.MONGO_DB_NAME,
      corsOrigins: resolved.CORS_ORIGINS,
      swaggerEnabled: resolved.ENABLE_SWAGGER,
      entraTenantId: resolved.ENTRA_TENANT_ID
        ? `${resolved.ENTRA_TENANT_ID.slice(0, 8)}…`
        : 'not-set',
      entraIssuer: resolved.ENTRA_ISSUER_RESOLVED,
    },
    'Configuration loaded',
  );
};

export default fp(configPlugin, {
  name: 'config',
});
