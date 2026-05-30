/**
 * Server factory — builds a Fastify instance without starting the listener.
 *
 * Split from index.ts to enable:
 *   1. Test usage: `await buildServer(); await app.inject({ method: 'GET', url: '/health' })`
 *   2. Vercel handler reuse: build once at module scope, reuse across invocations
 *   3. Local dev: index.ts calls this then `listen()`
 *
 * Plugin registration order matters (Fastify uses topological sort):
 *   1. config — env validation (everything depends on this)
 *   2. error-handler — catches errors from later plugins
 *   3. CORS, helmet, rate-limit — security middleware
 *   4. mongo — DB connection
 *   5. swagger — OpenAPI generation
 *   6. routes — domain modules
 */

import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { fastify, type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { runPendingMigrations } from './migrations/runner.js';
import assetConditionsRoutes from './modules/asset-conditions/asset-conditions.routes.js';
import assetTypesRoutes from './modules/asset-types/asset-types.routes.js';
import assetsRoutes from './modules/assets/assets.routes.js';
import auditPlugin from './modules/audit/audit.plugin.js';
import authSessionRoutes from './modules/auth/auth-session.routes.js';
import emailAuthRoutes from './modules/auth/email-auth.routes.js';
import mfaRoutes from './modules/auth/mfa/mfa.routes.js';
import oauthRoutes from './modules/auth/oauth.routes.js';
import passkeysRoutes from './modules/auth/passkeys/passkeys.routes.js';
import registrationRoutes from './modules/auth/registration.routes.js';
import categoriesRoutes from './modules/categories/categories.routes.js';
import healthRoutes from './modules/health/health.routes.js';
import invitationsRoutes from './modules/invitations/invitations.routes.js';
import loanRequestsRoutes from './modules/loans/loan-requests.routes.js';
import loansRoutes from './modules/loans/loans.routes.js';
import locationsRoutes from './modules/locations/locations.routes.js';
import membershipsRoutes from './modules/memberships/memberships.routes.js';
import organisationsRoutes from './modules/organisations/organisations.routes.js';
import stockRoutes from './modules/stock/stock.routes.js';
import usersRoutes from './modules/users/users.routes.js';
import authPlugin from './plugins/auth.js';
import configPlugin from './plugins/config.js';
import emailPlugin from './plugins/email.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import inventarioJwtPlugin from './plugins/inventario-jwt.js';
import mongoPlugin from './plugins/mongo.js';
import swaggerPlugin from './plugins/swagger.js';

// Suppress unused import warning — jsonSchemaTransform is re-exported
// in swagger.ts but TypeScript's verbatimModuleSyntax wants explicit use.
void jsonSchemaTransform;

export async function buildServer(
  options: { pluginTimeout?: number } = {},
): Promise<FastifyInstance> {
  const isProd = process.env['NODE_ENV'] === 'production';

  const app = fastify({
    logger: isProd
      ? {
          level: process.env['LOG_LEVEL'] ?? 'info',
        }
      : {
          level: process.env['LOG_LEVEL'] ?? 'debug',
          transport: {
            target: 'pino-pretty',
            options: {
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          },
        },
    // Generate request IDs for tracing
    genReqId: (req) => {
      // Use Vercel's request ID if present, else generate one
      const vercelId = req.headers['x-vercel-id'];
      if (typeof vercelId === 'string') return vercelId;
      return crypto.randomUUID();
    },
    // Trust X-Forwarded-* headers (Vercel sets these)
    trustProxy: true,
    // Plugin load timeout. Defaults to Fastify's 10s, which is fine for
    // production (warm Atlas pool). Tests override to 30s because each
    // test file rebuilds the app and pays the full Atlas TLS handshake
    // cost on a cold module-level cache.
    ...(options.pluginTimeout !== undefined && { pluginTimeout: options.pluginTimeout }),
  }).withTypeProvider<ZodTypeProvider>();

  // Hook Zod into Fastify's validation pipeline
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // --- Foundation plugins (order matters!) ---------------------------------
  await app.register(configPlugin);
  await app.register(errorHandlerPlugin);

  // --- Security middleware -------------------------------------------------
  await app.register(
    fastifyHelmet,
    app.config.ENABLE_SWAGGER
      ? {
          // Allow Swagger UI to load its own inline assets
          contentSecurityPolicy: false,
        }
      : {},
  );

  await app.register(fastifyCors, {
    origin: app.config.CORS_ORIGINS,
    credentials: app.config.CORS_ORIGINS !== '*',
  });

  await app.register(fastifyCookie);

  await app.register(fastifyRateLimit, {
    max: 100, // 100 requests
    timeWindow: '1 minute',
    // In test mode skip all rate limiting — tests hit the same endpoints
    // many times from 127.0.0.1 and would otherwise get 429s.
    ...(process.env['NODE_ENV'] === 'test' && { skip: () => true }),
  });

  // --- Infrastructure ------------------------------------------------------
  await app.register(mongoPlugin);

  // --- Database migrations -------------------------------------------------
  // Run pending migrations once the DB connection is available. Skipped in
  // EXPORT_ONLY mode (schema export uses an ephemeral in-memory DB) and in
  // tests (each test file manages its own clean DB; seeding defaults would
  // pollute fixtures). The runner is idempotent — it checks `migrations`
  // collection for a `completedAt` record per key and skips already-done
  // migrations, so re-running on every cold start is just one extra query.
  //
  // NOTE (scaling): on serverless this runs at request-time on cold start.
  // For higher traffic / many tenants, move migrations to a dedicated
  // deploy-time step to avoid running the check on each cold start and to
  // remove any chance of concurrent cold starts racing (mitigated today by
  // the unique index on `migrations.key`).
  if (process.env['EXPORT_ONLY'] !== 'true' && process.env['NODE_ENV'] !== 'test') {
    await runPendingMigrations(app.mongo.db, app.log);
  }
  await app.register(auditPlugin);
  await app.register(emailPlugin);
  await app.register(inventarioJwtPlugin);
  await app.register(authPlugin);
  await app.register(oauthRoutes);
  await app.register(authSessionRoutes);
  await app.register(emailAuthRoutes);
  await app.register(registrationRoutes);
  await app.register(mfaRoutes);
  await app.register(passkeysRoutes);

  // --- API documentation ---------------------------------------------------
  await app.register(swaggerPlugin);

  // --- Domain routes -------------------------------------------------------
  await app.register(healthRoutes);
  // OrganisationsRoutes must come before usersRoutes so the
  // organisationsService decorator is available to the auth middleware
  // when loadCurrentUser resolves the tenant from the JWT tid claim.
  await app.register(organisationsRoutes);
  await app.register(usersRoutes);
  await app.register(assetsRoutes);
  await app.register(assetConditionsRoutes);
  await app.register(assetTypesRoutes);
  await app.register(categoriesRoutes);
  await app.register(locationsRoutes);
  await app.register(loanRequestsRoutes);
  await app.register(loansRoutes);
  await app.register(invitationsRoutes);
  await app.register(membershipsRoutes);
  await app.register(stockRoutes);

  // --- Root redirect to /docs ----------------------------------------------
  app.get('/', async (_request, reply) => {
    if (app.config.ENABLE_SWAGGER) {
      return reply.redirect('/docs');
    }
    return { name: '@sfz/api', version: '0.1.0', status: 'ok' };
  });

  return app;
}
