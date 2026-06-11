// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Swagger / OpenAPI plugin — generates OpenAPI 3.1 spec from Fastify route
 * schemas and exposes interactive Swagger UI at /docs.
 *
 * How it works:
 *   - @fastify/swagger collects route schemas at startup
 *   - fastify-type-provider-zod (registered in server.ts) converts Zod
 *     schemas to JSON Schema as routes are defined
 *   - @fastify/swagger-ui serves the interactive UI
 *
 * In production, set ENABLE_SWAGGER=false to skip this plugin entirely.
 */

import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

import type { FastifyPluginAsync } from 'fastify';

const swaggerPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.config.ENABLE_SWAGGER) {
    fastify.log.info('Swagger UI disabled via ENABLE_SWAGGER=false');
    return;
  }

  await fastify.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Inventario API',
        description:
          'REST API for Inventario — a multi-tenant, white-label asset management platform ' +
          'for sports federations, municipalities, schools, and clubs. Open-source under EUPL-1.2.',
        version: '0.1.0',
        contact: {
          name: 'Inventario · LTK Solutions',
          url: 'https://inventario.sportup.sk',
          email: 'inventario@sportup.sk',
        },
        license: {
          name: 'EUPL-1.2',
          url: 'https://joinup.ec.europa.eu/collection/eupl/eupl-text-eupl-12',
        },
      },
      servers: [
        { url: `http://localhost:${fastify.config.PORT}`, description: 'Local dev' },
        {
          url: 'https://api.inventario.sportup.sk',
          description: 'Production (planned Q3 2026)',
        },
      ],
      tags: [
        { name: 'Health', description: 'Liveness and readiness probes' },
        {
          name: 'Organisations',
          description:
            'Tenant lifecycle management. Each Organisation is a tenant boundary; ' +
            'all other resources are scoped to exactly one Organisation.',
        },
        {
          name: 'Users',
          description:
            'User accounts and current-user lookup. JIT-provisioned on first login via ' +
            'Microsoft Entra ID. Tenant-scoped per Organisation.',
        },
        {
          name: 'Assets',
          description: 'Physical asset inventory — devices, equipment, vehicles, supplies.',
        },
        {
          name: 'Categories',
          description:
            'Hierarchical asset categorisation per tenant. Slugs are unique within an Organisation.',
        },
        {
          name: 'Locations',
          description:
            'Hierarchical physical location tree per tenant. Slugs are unique within an Organisation.',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description:
              'Microsoft Entra ID access token (v2.0). Multi-tenant: the JWT `tid` claim ' +
              'resolves the Organisation; the `oid` claim resolves the User. ' +
              'See apps/api/README.md for the device code flow.',
          },
        },
      },
      externalDocs: {
        description: 'Inventario documentation',
        url: 'https://docs.inventario.sportup.sk',
      },
    },
    transform: jsonSchemaTransform,
  });

  await fastify.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      tryItOutEnabled: true,
    },
    staticCSP: true,
  });

  fastify.log.info('Swagger UI available at /docs');
};

export default fp(swaggerPlugin, {
  name: 'swagger',
  dependencies: ['config'],
});
