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

import {
  collectErrorCodes,
  ERROR_RESPONSE_COMPONENT_NAME,
  ERROR_RESPONSE_JSON_SCHEMA,
  ERROR_RESPONSE_REF,
} from '../lib/error-response.js';
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

// ---------------------------------------------------------------------------
// Spoločné chybové odpovede
// ---------------------------------------------------------------------------

/**
 * Popisy chybových kódov v dokumentácii. Text je jediné miesto, kde sa
 * hovorí, ODKIAĽ kód pochádza — telo je pre všetky rovnaké
 * (`#/components/schemas/ErrorResponse`).
 */
const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'Vstup nesplnil schému (`params`, `querystring` alebo `body`). Telo obsahuje `issues` s konkrétnymi poľami.',
  401: 'Chýbajúca alebo neplatná autentifikácia — `inv_access` cookie nie je prítomná, expirovala, alebo tenant/používateľ nie je použiteľný.',
  403: 'Autentifikovaný, ale bez oprávnenia — nedostatočná rola v organizácii, pozastavené členstvo, alebo obmedzené spracovanie (GDPR čl. 18).',
  404: 'Zdroj s daným identifikátorom neexistuje alebo nepatrí do tejto organizácie.',
  429: 'Prekročený rate limit (globálne 100 požiadaviek/min na IP, na niektorých endpointoch nižší).',
};

/**
 * Ktoré chybové kódy má operácia dokumentovať.
 *
 * Prečo sa to odvodzuje a nepíše do 97 rout: 401 a 403 nevznikajú v tele
 * routy, ale v `preHandler` reťazci (`requireAuth`, `loadCurrentUser`,
 * `requireRole`) — tie hooky si zoznam kódov nesú sami (viď
 * `lib/error-response.ts`), takže odvodenie je presné a nová route ho
 * dostane automaticky. 400 vzniká validáciou vstupu, teda vždy, keď má
 * route schému vstupu. 404 dostane route s parametrom v ceste — bez
 * identifikátora nie je čo nenájsť.
 *
 * Doplnenie beží v `transform`, čo je krok generovania dokumentu. NEMENÍ
 * to runtime serializáciu: serializér routy je skompilovaný pri
 * registrácii z jej vlastnej `response` schémy, dávno pred týmto kódom.
 */
export function deriveErrorCodes(input: {
  url: string;
  preHandler?: unknown;
  hasInputSchema: boolean;
  hasSecurity: boolean;
}): number[] {
  const codes = new Set<number>(collectErrorCodes(input.preHandler));

  // Globálny rate limit (`@fastify/rate-limit`, 100/min/IP v `server.ts`)
  // platí pre každú route vrátane `/health`. Telo 429 posiela plugin a má
  // rovnaký tvar `{ statusCode, error, message }`.
  codes.add(429);

  // Časť rout (invitations, memberships, accept-invitation) volá
  // `requireAuth`/`loadCurrentUser` až v tele handlera, nie cez
  // `preHandler` — značky z hookov ich teda nezachytia. Deklarované
  // `security` je pre ne rovnako spoľahlivý signál: autentifikácia môže
  // padnúť na 401 a `loadCurrentUser` na 403 (GDPR čl. 18, pozastavené
  // členstvo).
  if (input.hasSecurity) {
    codes.add(401);
    codes.add(403);
  }

  if (input.hasInputSchema) codes.add(400);
  if (/\/[:{]/.test(input.url)) codes.add(404);

  return [...codes].sort((a, b) => a - b);
}

/** Doplní chýbajúce chybové odpovede do `response` mapy operácie. */
function addErrorResponses(response: Record<string, unknown>, codes: readonly number[]): void {
  for (const code of codes) {
    if (response[String(code)] !== undefined) continue;
    response[String(code)] = {
      $ref: ERROR_RESPONSE_REF,
      description: ERROR_DESCRIPTIONS[code] ?? 'Chyba požiadavky.',
    };
  }
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

  const declaredSecurity = (schema as { security?: unknown } | undefined)?.security;

  const errorCodes = deriveErrorCodes({
    url: result.url,
    preHandler: route.preHandler,
    hasInputSchema:
      schema?.params !== undefined ||
      schema?.querystring !== undefined ||
      schema?.body !== undefined,
    hasSecurity: Array.isArray(declaredSecurity) && declaredSecurity.length > 0,
  });

  // Časť rout je registrovaná bez `schema` (napr. invitations,
  // memberships) — v OpenAPI dokumente sú, takže operationId potrebujú
  // tiež, len im ho nemá kam zapísať. Vytvoríme minimálnu schému.
  if (transformed === undefined) {
    const response: Record<string, unknown> = {};
    addErrorResponses(response, errorCodes);
    return { schema: { operationId, response }, url: result.url };
  }

  if (transformed['operationId'] === undefined) {
    transformed['operationId'] = operationId;
  }

  const response = (transformed['response'] ?? {}) as Record<string, unknown>;
  addErrorResponses(response, errorCodes);
  transformed['response'] = response;

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

  ensureSuccessResponse(doc);

  return convertToOpenApi31(doc);
};

/**
 * Routa bez `response` schémy dostávala od @fastify/swagger náhradnú
 * `200 Default Response`. Odkedy jej `transform` dopĺňa chybové odpovede,
 * `response` mapa už prázdna nie je a náhradná 200 sa negeneruje — bez
 * tohto kroku by tie operácie v dokumente stratili úspešnú odpoveď.
 * Dopĺňa sa tu, nad hotovým dokumentom, aby to nezáviselo od interného
 * chovania @fastify/swagger.
 */
function ensureSuccessResponse(doc: unknown): void {
  const paths = (doc as { paths?: Record<string, Record<string, unknown>> }).paths;
  if (paths === undefined) return;

  for (const operations of Object.values(paths)) {
    for (const operation of Object.values(operations)) {
      const responses = (operation as { responses?: Record<string, unknown> }).responses;
      if (responses === undefined) continue;
      if (Object.keys(responses).some((code) => code.startsWith('2'))) continue;

      responses['200'] = { description: 'Default Response' };
    }
  }
}

/** Produkčné API. Domény sú v `infra/vercel/DNS-SETUP.md`. */
const PRODUCTION_API_URL = 'https://api.inventario.estate';

const swaggerPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.config.ENABLE_SWAGGER) {
    fastify.log.info('Swagger UI disabled via ENABLE_SWAGGER=false');
    return;
  }

  // `EXPORT_ONLY` je beh generátora dokumentu (openapi:sync) — ten má
  // vyzerať ako produkčný dokument, nie ako lokálny dev.
  const isLocalDev =
    fastify.config.NODE_ENV !== 'production' && process.env['EXPORT_ONLY'] !== 'true';

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
          url: 'https://inventario.estate',
          email: 'inventario@ltk.solutions',
        },
        license: {
          name: 'EUPL-1.2',
          url: 'https://joinup.ec.europa.eu/collection/eupl/eupl-text-eupl-12',
        },
      },
      // Poradie nie je kozmetika: Swagger UI berie prvý server ako
      // predvolený cieľ pre „Try it out". Lokálne teda musí byť prvý
      // localhost, inak by pokusný request z dev prostredia išiel na
      // produkčné API. V produkcii (a pri exporte dokumentu pre
      // integrátorov) je prvá produkcia.
      servers: isLocalDev
        ? [
            { url: `http://localhost:${fastify.config.PORT}`, description: 'Local dev' },
            { url: PRODUCTION_API_URL, description: 'Production' },
          ]
        : [
            { url: PRODUCTION_API_URL, description: 'Production' },
            { url: `http://localhost:${fastify.config.PORT}`, description: 'Local dev' },
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
        schemas: {
          // Telo každej chybovej odpovede. Spoločné 4xx odpovede sa naň
          // odkazujú cez `$ref`, aby dokument nenosil 97× ten istý objekt.
          [ERROR_RESPONSE_COMPONENT_NAME]: ERROR_RESPONSE_JSON_SCHEMA,
        },
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
          deploymentSecret: {
            type: 'http',
            scheme: 'bearer',
            description:
              'Zdieľané tajomstvo pre servisné endpointy pod /v1/system — nie používateľský ' +
              'token. Migrácie a indexy používajú MIGRATIONS_SECRET (volá GitHub Actions po ' +
              'produkčnom deployi), retencia CRON_SECRET (volá Vercel Cron). Bez nastavenej ' +
              'premennej endpoint vracia 503.',
          },
        },
      },
      externalDocs: {
        description: 'Inventario documentation',
        url: 'https://docs.inventario.estate',
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
