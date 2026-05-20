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
  MONGO_DB_NAME: z.string().min(1).default('sfz_asset_management'),

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
  ENABLE_SWAGGER: z
    .enum(['true', 'false'])
    .default('true')
    .transform((val) => val === 'true'),

  // ---------------------------------------------------------------------
  // OAuth providers (ADR-0013) — Google + Microsoft + Apple
  // ---------------------------------------------------------------------
  // All are optional during transition; required once MSAL is removed (K17).

  /** 32+ char HMAC secret for signing OAuth state params. */
  OAUTH_STATE_SECRET: z.string().min(32).optional(),
  /** Absolute URL for OAuth callbacks. E.g. https://api.inventario.sportup.sk/v1/auth/callback */
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
  // Email (ADR-0013) — nodemailer + SMTP
  // ---------------------------------------------------------------------
  // All optional — if not set, emails are logged to console (dev mode).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** From address shown to recipients. */
  EMAIL_FROM: z.string().default('Inventario <noreply@inventario.sportup.sk>'),

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
  // Auth — Microsoft Entra ID (slice #2)
  // ---------------------------------------------------------------------
  // ENTRA_TENANT_ID and ENTRA_API_CLIENT_ID are required in all environments.
  // Get them from Azure Portal → Entra ID → App registrations → SFZ API.
  //
  // ENTRA_JWKS_URI and ENTRA_ISSUER are auto-derived from ENTRA_TENANT_ID
  // and rarely need to be overridden. The override exists for unusual
  // tenant configurations (e.g. national cloud, sovereign Azure).
  ENTRA_TENANT_ID: z
    .string()
    .uuid('ENTRA_TENANT_ID must be a valid GUID (find it in Azure Portal → Entra ID → Overview).'),
  ENTRA_API_CLIENT_ID: z
    .string()
    .uuid(
      'ENTRA_API_CLIENT_ID must be a valid GUID (Application (client) ID from your API app registration).',
    ),
  ENTRA_ISSUER: z.string().url().optional(),
  ENTRA_JWKS_URI: z.string().url().optional(),

  // ---------------------------------------------------------------------
  // Test JWT — development/test only (slice #2c)
  // ---------------------------------------------------------------------
  // When set, the auth plugin will additionally accept JWTs signed by
  // this public key with issuer `urn:sfz-test:dev`. This enables vitest
  // integration tests to generate their own tokens without going through
  // the Entra ID device-code flow.
  //
  // In production this env var MUST be unset — the auth plugin refuses
  // to enable the test path if NODE_ENV === 'production'.
  //
  // Format: PEM-encoded public key (typically Ed25519, but RS256 also works).
  // The vitest setup generates an ephemeral keypair at test start and writes
  // the public half here, so no key material is ever committed to git.
  TEST_JWT_PUBLIC_KEY: z.string().optional(),
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
  /** Microsoft Entra ID v2.0 issuer URL — used to validate JWT `iss` claim. */
  ENTRA_ISSUER_RESOLVED: string;
  /** JWKS endpoint for fetching Entra ID signing keys. */
  ENTRA_JWKS_URI_RESOLVED: string;
  /** Accepted audiences for JWT `aud` claim (both raw GUID and api:// URI). */
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
  const issuer =
    env.ENTRA_ISSUER ?? `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/v2.0`;
  const jwksUri =
    env.ENTRA_JWKS_URI ??
    `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/discovery/v2.0/keys`;
  const acceptedAudiences = Object.freeze([
    env.ENTRA_API_CLIENT_ID,
    `api://${env.ENTRA_API_CLIENT_ID}`,
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
      entraTenantId: `${resolved.ENTRA_TENANT_ID.slice(0, 8)}…`, // truncated for logs
      entraIssuer: resolved.ENTRA_ISSUER_RESOLVED,
    },
    'Configuration loaded',
  );
};

export default fp(configPlugin, {
  name: 'config',
});
