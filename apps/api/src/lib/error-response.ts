// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Jediný tvar chybovej odpovede API — runtime schéma aj OpenAPI komponent.
 *
 * Zdroj pravdy o tom, čo klient naozaj dostane, je
 * `plugins/error-handler.ts`. Tento súbor ten tvar opisuje na dvoch
 * miestach, ktoré musia zostať v zhode:
 *
 *   - `ErrorResponseSchema` — Zod schéma pre `response` v routách. POZOR:
 *     `server.ts` registruje `serializerCompiler` z
 *     `fastify-type-provider-zod`, takže response schéma NIE JE len
 *     dokumentácia — Fastify podľa nej odpoveď serializuje a neznáme
 *     kľúče zahodí. Preto tu musia byť VŠETKY polia, ktoré error-handler
 *     posiela, vrátane voliteľných `details` a `issues`.
 *   - `ERROR_RESPONSE_JSON_SCHEMA` — ten istý tvar ako OpenAPI komponent
 *     `#/components/schemas/ErrorResponse`. Naň sa odkazujú spoločné
 *     chybové odpovede, ktoré do dokumentu dopĺňa `plugins/swagger.ts`.
 *
 * Historický kontext: pred zjednotením mali dva verejné endpointy lokálne
 * `z.object({ message: z.string() })`. Serializér podľa nej pri Zod
 * validačnej chybe zahodil `statusCode`, `error` aj `issues` — integrátor
 * dostal osekané telo. Pokryté testom
 * `tests/integration/error-shape-consistency.test.ts`.
 */

import { z } from 'zod';

/** Jedna položka Zod validačnej chyby, ako ju posiela error-handler. */
export const ErrorIssueSchema = z.object({
  /** Cesta k poľu spojená bodkami, napr. `body.name`. */
  path: z.string(),
  message: z.string(),
  code: z.string(),
});

/**
 * Telo každej chybovej odpovede API.
 *
 * `error` je krátky strojový názov chyby — pri `HttpError` potomkoch
 * vzniká ako `error.name.replace(/Error$/, '')` (`NotFound`,
 * `BadRequest`, `Unauthorized`, `Forbidden`), pri Zod validácii a pri
 * Fastify vstavaných chybách je to text typu `Bad Request` / `Not Found`.
 * Preto `z.string()`, nie enum.
 */
export const ErrorResponseSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
  /** Voliteľný kontext z `HttpError.details`. */
  details: z.record(z.unknown()).optional(),
  /**
   * Prítomné, keď sa k error handleru dostane `ZodError` priamo.
   * Validácia vstupu cez Fastify vracia jednu chybu v `message` — overené
   * testom `tests/integration/error-shape-consistency.test.ts`.
   */
  issues: z.array(ErrorIssueSchema).optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/** Názov OpenAPI komponentu, na ktorý sa odkazujú chybové odpovede. */
export const ERROR_RESPONSE_COMPONENT_NAME = 'ErrorResponse';

/** OpenAPI `$ref` na komponent chybovej odpovede. */
export const ERROR_RESPONSE_REF = `#/components/schemas/${ERROR_RESPONSE_COMPONENT_NAME}`;

/**
 * `ErrorResponseSchema` ako OpenAPI 3.1 schéma. Ručne, nie generovane —
 * generátor by ťahal `zod-to-json-schema` ako priamu závislosť len pre
 * jeden statický objekt. Zhodu s runtime tvarom stráži integračný test
 * nad skutočnou odpoveďou, nie porovnanie dvoch schém.
 */
export const ERROR_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  title: 'ErrorResponse',
  description:
    'Jednotné telo chybovej odpovede. Generuje ho centrálny error handler ' +
    '(apps/api/src/plugins/error-handler.ts) pre všetky 4xx a 5xx odpovede.',
  required: ['statusCode', 'error', 'message'],
  properties: {
    statusCode: {
      type: 'integer',
      description: 'HTTP status kód, rovnaký ako v hlavičke odpovede.',
      examples: [404],
    },
    error: {
      type: 'string',
      description:
        'Krátky strojový názov chyby — `NotFound`, `BadRequest`, `Unauthorized`, ' +
        '`Forbidden`, prípadne text Fastify chyby (`Bad Request`).',
      examples: ['NotFound'],
    },
    message: {
      type: 'string',
      description: 'Ľudsky čitateľný popis. Nie je určený na strojové rozhodovanie.',
      examples: ['Asset not found: 6a9f1c2e4b7d8a0f12345678'],
    },
    details: {
      type: 'object',
      description: 'Voliteľný strukturovaný kontext chyby.',
      additionalProperties: true,
    },
    issues: {
      type: 'array',
      description:
        'Prítomné, keď sa k error handleru dostane ZodError priamo. Validácia vstupu cez ' +
        'Fastify (`params`, `querystring`, `body`) vracia jednu chybu v `message`, bez `issues`.',
      items: {
        type: 'object',
        required: ['path', 'message', 'code'],
        properties: {
          path: { type: 'string', examples: ['body.name'] },
          message: { type: 'string', examples: ['String must contain at least 1 character(s)'] },
          code: { type: 'string', examples: ['too_small'] },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Značkovanie preHandlerov — ktoré HTTP kódy vie hook vyhodiť
// ---------------------------------------------------------------------------

/**
 * Kľúč, pod ktorým si preHandler nesie zoznam chybových kódov, ktoré vie
 * vyhodiť. Číta ho `plugins/swagger.ts` a podľa neho dopĺňa spoločné
 * chybové odpovede do OpenAPI dokumentu.
 *
 * Prečo takto a nie podľa mien funkcií: `requireRole(...)` vracia
 * anonymný handler, takže názov v `preHandler` poli nie je použiteľný.
 * Značka je explicitná a nerozbije sa pri refaktoringu.
 */
export const ERROR_CODES_KEY = Symbol.for('inventario.openapi.errorCodes');

type MaybeTagged = { [ERROR_CODES_KEY]?: readonly number[] };

/** Pripne hooku zoznam kódov, ktoré vie vyhodiť. Vracia ten istý hook. */
export function tagErrorCodes<T extends (...args: never[]) => unknown>(
  hook: T,
  codes: readonly number[],
): T {
  Object.defineProperty(hook, ERROR_CODES_KEY, {
    value: codes,
    enumerable: false,
    configurable: true,
  });
  return hook;
}

/**
 * Vyzbiera kódy zo `preHandler` route (jeden hook alebo pole hookov).
 * Neoznačené hooky ignoruje.
 */
export function collectErrorCodes(preHandler: unknown): number[] {
  const hooks = Array.isArray(preHandler) ? preHandler : [preHandler];
  const codes = new Set<number>();

  for (const hook of hooks) {
    if (typeof hook !== 'function') continue;
    const tagged = (hook as MaybeTagged)[ERROR_CODES_KEY];
    if (tagged === undefined) continue;
    for (const code of tagged) codes.add(code);
  }

  return [...codes].sort((a, b) => a - b);
}
