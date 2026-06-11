// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Smoke test for the health endpoint.
 *
 * This is the cheapest possible integration test — no auth, no database
 * writes, just verifying that:
 *   1. `buildTestApp()` boots the Fastify app
 *   2. The test database connection works (MongoDB ping succeeds)
 *   3. `app.inject()` end-to-end request flow works
 *
 * If this test fails, every other integration test will too. Treat it
 * as a canary for the whole test infrastructure.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../helpers/test-app.js';

import type { FastifyInstance } from 'fastify';

describe('GET /health/ready', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with mongo:ok when the test DB is reachable', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(res.statusCode).toBe(200);

    const body = res.json<{ status: string; checks: { mongo: string } }>();
    expect(body.status).toBe('ready');
    expect(body.checks.mongo).toBe('ok');
  });
});
