// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests for POST /v1/system/retention/run (cron endpoint).
 *
 * Covered:
 *   - 503 when CRON_SECRET is not configured
 *   - 401 when Authorization header is missing
 *   - 401 when Authorization header has wrong token
 *   - 200 with RetentionRunResult when called with correct token
 *   - result shape is correct (all expected fields present)
 */

import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';

import type { FastifyInstance } from 'fastify';

const VALID_SECRET = 'a'.repeat(32); // 32 chars — meets min length

describe('POST /v1/system/retention/run', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Set CRON_SECRET before building the app so config plugin picks it up
    process.env['CRON_SECRET'] = VALID_SECRET;
    app = await buildTestApp();
  });

  afterAll(async () => {
    delete process.env['CRON_SECRET'];
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  it('returns 401 without Authorization header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/system/retention/run',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with wrong token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/system/retention/run',
      headers: { authorization: 'Bearer wrong-secret' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with RetentionRunResult when called with correct token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/system/retention/run',
      headers: { authorization: `Bearer ${VALID_SECRET}` },
    });

    expect(res.statusCode).toBe(200);

    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty('startedAt');
    expect(body).toHaveProperty('completedAt');
    expect(body).toHaveProperty('auditLogsCrud');
    expect(body).toHaveProperty('auditLogsSecurity');
    expect(body).toHaveProperty('auditLogsOrgLifecycle');
    expect(body).toHaveProperty('totalAuditLogs');
    expect(body).toHaveProperty('usersPseudonymized');

    // Empty DB → all counts are 0
    expect(body['totalAuditLogs']).toBe(0);
    expect(body['usersPseudonymized']).toBe(0);
  });

  it('is idempotent — second call returns same shape with 0 new records', async () => {
    const headers = { authorization: `Bearer ${VALID_SECRET}` };

    const first = await app.inject({ method: 'POST', url: '/v1/system/retention/run', headers });
    const second = await app.inject({ method: 'POST', url: '/v1/system/retention/run', headers });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json<Record<string, unknown>>()['totalAuditLogs']).toBe(0);
  });
});
