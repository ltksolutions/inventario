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

import { convertToOpenApi31 } from '../lib/openapi-3-1.js';

import type { SwaggerTransform, SwaggerTransformObject } from '@fastify/swagger';
import type { FastifyPluginAsync } from 'fastify';

// ---------------------------------------------------------------------------
// operationId
// ---------------------------------------------------------------------------

/**
 * Odvodí `operationId` z HTTP metódy a cesty.
 *
 * Redocly lint (`operation-operationId`) ho vyžaduje a generátory klientov
 * z neho robia názvy funkcií. Ručne ho písať do 87 rout by znamenalo 87
 * miest, kde sa dá spraviť preklep alebo duplicita — a pri každej novej
 * route by sa naň dalo zabudnúť. Odvodenie z cesty je deterministické a
 * nové routy ho dostanú samé.
 *
 * Route si môže `operationId` nastaviť aj sama v `schema` — tá hodnota má
 * prednosť (viď `withOperationId` nižšie), takže sémantickejší názov sa dá
 * kedykoľvek doplniť bez zásahu do tejto funkcie.
 *
 *   GET  /v1/assets              → getV1Assets
 *   GET  /v1/assets/{id}         → getV1AssetsById
 *   POST /v1/users/{id}/return-items → postV1UsersByIdReturnItems
 */
export function buildOperationId(method: string, url: string): string {
  const words: string[] = [];

  for (const segment of url.split('/').filter(Boolean)) {
    // Transform dostáva cestu vo Fastify tvare (`:id`), nie v OpenAPI
    // tvare (`{id}`) — podporené oboje, nech je funkcia použiteľná aj
    // nad hotovým OpenAPI dokumentom.
    const param = segment.startsWith(':')
      ? segment.slice(1)
      : segment.startsWith('{') && segment.endsWith('}')
        ? segment.slice(1, -1)
        : null;

    if (param !== null) {
      words.push('by', ...param.split(/[-_]/));
    } else {
      words.push(...segment.split(/[-_.]/));
    }
  }

  const suffix = words
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');

  return method.toLowerCase() + suffix;
}

/**
 * Obal nad `jsonSchemaTransform`, ktorý dopĺňa `operationId`. Ak si ho
 * route nastavila v `schema`, ostáva nedotknutý.
 *
 * `jsonSchemaTransform` sám dostáva len `{ schema, url }` — metóda je v
 * `route`, ktorú posiela @fastify/swagger.
 */
const withOperationId: SwaggerTransform = ({ schema, url, route }) => {
  const result = jsonSchemaTransform({ schema, url });
  const method = Array.isArray(route.method) ? route.method[0] : route.method;

  if (typeof method !== 'string') return result;

  const operationId = buildOperationId(method, result.url);
  const transformed = result.schema as Record<string, unknown> | undefined;

  // Časť rout je registrovaná bez `schema` (napr. invitations,
  // memberships) — v OpenAPI dokumente sú, takže operationId potrebujú
  // tiež, len im ho nemá kam zapísať. Vytvoríme minimálnu schému.
  if (transformed === undefined) {
    return { schema: { operationId }, url: result.url };
  }

  if (transformed['operationId'] === undefined) {
    transformed['operationId'] = operationId;
  }

  return result;
};

/**
 * Posledný krok pred vyrenderovaním dokumentu: `nullable: true` → 3.1 tvar.
 *
 * Beží nad celým dokumentom, takže platí rovnako pre `openapi.json`,
 * `/docs` aj pre YAML v `docs/api/`. Zod → JSON Schema konverzia zatiaľ
 * generuje 3.0 tvar; detaily v `lib/openapi-3-1.ts`.
 */
const toOpenApi31: SwaggerTransformObject = (documentObject) => {
  const doc =
    'openapiObject' in documentObject ? documentObject.openapiObject : documentObject.swaggerObject;

  return convertToOpenApi31(doc);
};

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
    // Zod → JSON Schema (fastify-type-provider-zod) a navrch doplnenie
    // operationId, ak si ho route nenastavila sama.
    transform: withOperationId,
    transformObject: toOpenApi31,
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
