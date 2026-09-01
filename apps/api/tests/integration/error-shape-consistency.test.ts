// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Runtime tvar chybovej odpovede je jednotný naprieč API.
 *
 * Prečo tento test existuje: `server.ts` registruje `serializerCompiler`
 * z `fastify-type-provider-zod`, takže `response` schéma nie je len
 * dokumentácia — Fastify podľa nej odpoveď serializuje a neznáme kľúče
 * zahodí. Pred zjednotením mali dva verejné endpointy lokálne
 * `z.object({ message: z.string() })` a serializér im pri chybe zahodil
 * `statusCode`, `error` aj `issues`:
 *
 *   GET /v1/public/organisations/login-context?slug=<81 znakov>
 *     → {"message":"querystring/slug String must contain at most 40 character(s)"}
 *
 * Zdroj pravdy o tvare je `plugins/error-handler.ts`, jeho Zod podoba
 * `lib/error-response.ts`. Test porovnáva SKUTOČNÉ odpovede, nie schémy.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ErrorResponseSchema } from '../../src/lib/error-response.js';
import { buildTestApp } from '../helpers/test-app.js';

import type { FastifyInstance } from 'fastify';

/** Povinné polia každej chybovej odpovede. */
const REQUIRED_KEYS = ['error', 'message', 'statusCode'] as const;

describe('runtime tvar chybovej odpovede', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Overí, že telo zodpovedá zdieľanej schéme a nesie povinné polia. */
  function expectErrorShape(body: unknown, statusCode: number): void {
    expect(ErrorResponseSchema.safeParse(body).success).toBe(true);
    const keys = Object.keys(body as Record<string, unknown>);
    for (const key of REQUIRED_KEYS) expect(keys).toContain(key);
    expect((body as { statusCode: number }).statusCode).toBe(statusCode);
  }

  it('401 na chránenej route bez vlastnej 4xx schémy', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/assets' });

    expect(res.statusCode).toBe(401);
    expectErrorShape(res.json(), 401);
  });

  it('404 neznámej routy (notFoundHandler)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/neexistuje' });

    expect(res.statusCode).toBe(404);
    expectErrorShape(res.json(), 404);
  });

  it('400 z validácie vstupu nesie plný tvar — schéma ho nesmie orezať', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/public/organisations/login-context?slug=${'x'.repeat(80)}`,
    });

    expect(res.statusCode).toBe(400);
    // Práve tu serializér predtým zahodil `statusCode` a `error` a
    // klientovi zostalo len `{ message }`.
    expectErrorShape(res.json(), 400);
    // eslint-disable-next-line no-console
    console.log('400 z validácie vstupu:', res.body);
  });

  it('400 z vlastnej validácie v handleri (login-context bez parametrov)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/public/organisations/login-context',
    });

    expect(res.statusCode).toBe(400);
    expectErrorShape(res.json(), 400);
  });

  it('404 na verejnom login-contexte', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/public/organisations/login-context?slug=neexistujuca-org',
    });

    expect(res.statusCode).toBe(404);
    expectErrorShape(res.json(), 404);
  });

  it('404 na verejnom scan endpointe', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/public/scan/neexistujuci-token',
    });

    expect(res.statusCode).toBe(404);
    expectErrorShape(res.json(), 404);
  });

  it('no-oracle: neexistujúci token a vypnutý lookup majú identické telo', async () => {
    const a = await app.inject({ method: 'GET', url: '/v1/public/scan/token-a' });
    const b = await app.inject({ method: 'GET', url: '/v1/public/scan/token-b' });

    expect(a.statusCode).toBe(404);
    expect(a.body).toBe(b.body);
  });
});
