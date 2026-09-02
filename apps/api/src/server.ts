// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

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

import { createBootTimer } from './lib/boot-timing.js';
import indexRegistryPlugin from './lib/ensure-indexes.js';
import { checkPendingMigrations } from './migrations/runner.js';
import assetConditionsRoutes from './modules/asset-conditions/asset-conditions.routes.js';
import assetsRoutes from './modules/assets/assets.routes.js';
import publicAssetsRoutes from './modules/assets/public-assets.routes.js';
import attachmentsRoutes from './modules/attachments/attachments.routes.js';
import auditPlugin from './modules/audit/audit.plugin.js';
import auditRoutes from './modules/audit/audit.routes.js';
import appleAuthRoutes from './modules/auth/apple-auth.routes.js';
import authSessionRoutes from './modules/auth/auth-session.routes.js';
import emailAuthRoutes from './modules/auth/email-auth.routes.js';
import linkProviderRoutes from './modules/auth/link-provider.routes.js';
import mfaRoutes from './modules/auth/mfa/mfa.routes.js';
import oauthRoutes from './modules/auth/oauth.routes.js';
import passkeysRoutes from './modules/auth/passkeys/passkeys.routes.js';
import registrationRoutes from './modules/auth/registration.routes.js';
import categoriesRoutes from './modules/categories/categories.routes.js';
import dashboardRoutes from './modules/dashboard/dashboard.routes.js';
import healthRoutes from './modules/health/health.routes.js';
import invitationsRoutes from './modules/invitations/invitations.routes.js';
import labelsRoutes from './modules/labels/labels.routes.js';
import loanRequestsRoutes from './modules/loans/loan-requests.routes.js';
import loansRoutes from './modules/loans/loans.routes.js';
import locationsRoutes from './modules/locations/locations.routes.js';
import membershipsRoutes from './modules/memberships/memberships.routes.js';
import { createDynamicCorsOrigin } from './modules/organisations/dynamic-cors.js';
import organisationsRoutes from './modules/organisations/organisations.routes.js';
import publicLoginContextRoutes from './modules/organisations/public-login-context.routes.js';
import publicOrganisationLogoRoutes from './modules/organisations/public-organisation-logo.routes.js';
import protocolsRoutes from './modules/protocols/protocols.routes.js';
import stockRoutes from './modules/stock/stock.routes.js';
import indexesRoutes from './modules/system/indexes.routes.js';
import migrationsRoutes from './modules/system/migrations.routes.js';
import retentionRoutes from './modules/system/retention.routes.js';
import storageSystemRoutes from './modules/system/storage.routes.js';
import usersRoutes from './modules/users/users.routes.js';
import authPlugin from './plugins/auth.js';
import configPlugin from './plugins/config.js';
import emailPlugin from './plugins/email.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import inventarioJwtPlugin from './plugins/inventario-jwt.js';
import mongoPlugin from './plugins/mongo.js';
import storagePlugin from './plugins/storage.js';
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

  // Rozpad cold startu na fázy — bez merania sa dá len hádať, kde tých
  // niekoľko sekúnd vzniká. Súhrn ide do logu raz za cold start.
  const bootTimer = createBootTimer();

  // --- Foundation plugins (order matters!) ---------------------------------
  await app.register(configPlugin);
  await app.register(errorHandlerPlugin);

  bootTimer.mark('foundation');

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

  // Dynamický CORS (ADR-0035 F4) — statický zoznam z CORS_ORIGINS/`'*'`
  // sa kontroluje ako doteraz; Origin, ktorý tam nie je, sa navyše overí
  // proti `Organisation.customDomain` v DB (vlastná doména tenanta pre
  // prihlásenie). Bezpečnostné pravidlá a rezervné riziká sú zdokumentované
  // v `modules/organisations/dynamic-cors.ts`.
  const dynamicCorsOrigin = createDynamicCorsOrigin(app);
  await app.register(fastifyCors, {
    origin: async (origin: string | undefined) => {
      if (app.config.CORS_ORIGINS === '*') return true;
      if (!origin) return true;
      if (app.config.CORS_ORIGINS.includes(origin)) return true;
      return dynamicCorsOrigin(origin);
    },
    credentials: app.config.CORS_ORIGINS !== '*',
  });

  await app.register(fastifyCookie);

  // Multipart parser — registrovaný RAZ globálne. @fastify/multipart sa
  // pripája na koreňový scope, takže viacnásobná registrácia v rôznych
  // route plugin-och padá na FST_ERR_CTP_ALREADY_PRESENT. fileSize je
  // tvrdý strop parsera; jednotlivé handlery (napr. logo 512 KB) si
  // menšie limity vynucujú kontrolou bufferu.
  //
  // 4 MB, nie 20: Vercel má strop 4,5 MB na telo requestu AJ odpovede
  // a request nad limit zahodí s 413 FUNCTION_PAYLOAD_TOO_LARGE ešte
  // predtým, než sa dostane k funkcii. Overené na produkcii 2026-09-01:
  // 6 MB → 413, 1 KB → 401 (teda náš auth). Kým bol strop 20 MB, súbory
  // nad 4,5 MB padali na platforme a používateľ nedostal našu hlášku,
  // ale hrubú 413. Zvyšok do 4,5 MB je rezerva na multipart obálku
  // a hlavičky. Cesta k väčším súborom je priamy upload do úložiska
  // tenanta mimo funkcie — ADR-0037.
  await app.register(import('@fastify/multipart'), {
    limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  });

  await app.register(fastifyRateLimit, {
    max: 100, // 100 requests
    timeWindow: '1 minute',
    // In test mode skip all rate limiting — tests hit the same endpoints
    // many times from 127.0.0.1 and would otherwise get 429s.
    ...(process.env['NODE_ENV'] === 'test' && { skip: () => true }),
  });

  bootTimer.mark('security');

  // --- Infrastructure ------------------------------------------------------
  await app.register(mongoPlugin);
  await app.register(indexRegistryPlugin);
  bootTimer.mark('mongo');

  // --- Database migrations -------------------------------------------------
  // Migrations run at DEPLOY TIME now, not on cold start — see
  // POST /v1/system/migrations/run (modules/system/migrations.routes.ts),
  // triggered automatically by .github/workflows/migrate-on-deploy.yml
  // right after a successful production deploy.
  //
  // Cold start only runs a passive check: ONE query to see whether
  // anything is still pending, and a warning log if so. It never executes
  // a migration itself. This replaces the previous behavior (running the
  // full idempotent-but-sequential check on every cold start, which added
  // ~1s+ per cold start as the migration count grew).
  //
  // Skipped in EXPORT_ONLY mode (schema export uses an ephemeral in-memory
  // DB) and in tests (each test file manages its own clean DB).
  if (process.env['EXPORT_ONLY'] !== 'true' && process.env['NODE_ENV'] !== 'test') {
    await checkPendingMigrations(app.mongo.db, app.log);
  }
  bootTimer.mark('migrationsCheck');
  await app.register(auditPlugin);
  await app.register(emailPlugin);
  await app.register(storagePlugin);
  await app.register(inventarioJwtPlugin);
  await app.register(authPlugin);
  await app.register(oauthRoutes);
  await app.register(appleAuthRoutes);
  await app.register(authSessionRoutes);
  await app.register(emailAuthRoutes);
  await app.register(registrationRoutes);
  await app.register(linkProviderRoutes);
  await app.register(mfaRoutes);
  await app.register(passkeysRoutes);

  bootTimer.mark('authPlugins');

  // --- API documentation ---------------------------------------------------
  await app.register(swaggerPlugin);
  bootTimer.mark('swagger');

  // --- Domain routes -------------------------------------------------------
  await app.register(healthRoutes);
  // OrganisationsRoutes must come before usersRoutes so the
  // organisationsService decorator is available to the auth middleware
  // when loadCurrentUser resolves the tenant from the JWT tid claim.
  await app.register(organisationsRoutes);
  await app.register(publicLoginContextRoutes);
  await app.register(publicOrganisationLogoRoutes);
  await app.register(usersRoutes);
  await app.register(assetsRoutes);
  await app.register(auditRoutes);
  await app.register(attachmentsRoutes);
  await app.register(publicAssetsRoutes);
  await app.register(assetConditionsRoutes);
  await app.register(categoriesRoutes);
  await app.register(locationsRoutes);
  await app.register(loanRequestsRoutes);
  await app.register(loansRoutes);
  await app.register(protocolsRoutes);
  await app.register(dashboardRoutes);
  await app.register(labelsRoutes);
  await app.register(invitationsRoutes);
  await app.register(membershipsRoutes);
  await app.register(stockRoutes);
  await app.register(migrationsRoutes);
  await app.register(indexesRoutes);
  await app.register(retentionRoutes);
  await app.register(storageSystemRoutes);

  bootTimer.mark('domainRoutes');

  // --- Root redirect to /docs ----------------------------------------------
  app.get(
    '/',
    {
      schema: {
        tags: ['Health'],
        summary: 'Koreň API — presmerovanie na /docs, inak identifikácia služby',
        description:
          'So zapnutým Swaggerom presmeruje na /docs. V produkcii (Swagger vypnutý) ' +
          'vracia názov a verziu služby — slúži ako najlacnejší liveness signál.',
        // Zámerne verejný endpoint — viď health.routes.ts.
        security: [],
      },
    },
    async (_request, reply) => {
      if (app.config.ENABLE_SWAGGER) {
        return reply.redirect('/docs');
      }
      return { name: '@inventario/api', version: '0.1.0', status: 'ok' };
    },
  );

  bootTimer.summary(app.log);

  return app;
}
