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

import assetsRoutes from './modules/assets/assets.routes.js';
import auditPlugin from './modules/audit/audit.plugin.js';
import categoriesRoutes from './modules/categories/categories.routes.js';
import healthRoutes from './modules/health/health.routes.js';
import loanRequestsRoutes from './modules/loans/loan-requests.routes.js';
import loansRoutes from './modules/loans/loans.routes.js';
import locationsRoutes from './modules/locations/locations.routes.js';
import organisationsRoutes from './modules/organisations/organisations.routes.js';
import usersRoutes from './modules/users/users.routes.js';
import authPlugin from './plugins/auth.js';
import configPlugin from './plugins/config.js';
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
    // Credentials NOT allowed with origin '*' (browser security rule).
    // Only enable credentials when using a specific allowlist.
    credentials: app.config.CORS_ORIGINS !== '*',
  });

  await app.register(fastifyRateLimit, {
    max: 100, // 100 requests
    timeWindow: '1 minute',
  });

  // --- Infrastructure ------------------------------------------------------
  await app.register(mongoPlugin);
  await app.register(auditPlugin);
  await app.register(authPlugin);
  await app.register(inventarioJwtPlugin);

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
  await app.register(categoriesRoutes);
  await app.register(locationsRoutes);
  await app.register(loanRequestsRoutes);
  await app.register(loansRoutes);

  // --- Root redirect to /docs ----------------------------------------------
  app.get('/', async (_request, reply) => {
    if (app.config.ENABLE_SWAGGER) {
      return reply.redirect('/docs');
    }
    return { name: '@sfz/api', version: '0.1.0', status: 'ok' };
  });

  return app;
}
