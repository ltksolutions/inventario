// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests — ADR-0022 K7: Preberacie protokoly (protocols).
 *
 * Pokryté invarianty:
 *   - RBAC: borrower vidí vlastné, manager vidí všetky, cudzí dostane 403/404
 *   - Cross-tenant izolácia
 *   - PDF render: GET /pdf vráti Content-Type application/pdf
 *   - Podpis K6: jednostranný = stále DRAFT; obojstranný = SIGNED + pdfSha256 fixnutý
 *   - Snapshot-not-live: zmena assetu po vzniku protokolu nemení protokol
 *   - Stránkovanie: protokol vzniká aj pri 25+ položkách (smoke)
 *   - Multi-fulfil: každý fulfil = vlastný HANDOVER protokol
 *
 * Determinizmus a diakritika sú pokryté unit testami (protocol-renderer.test.ts).
 * Race na protocolNumber je pokrytý unit testom (protocol-number.test.ts).
 *
 * Vzor: priame DB inserty pre fixture dáta, API volania pre SUT.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  UserRole,
  insertTestAsset,
  insertTestCategory,
  insertTestMembership,
  provisionUser,
  seedTestTenant,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function futureDate(daysFromNow = 7): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Vytvorí schválený request + zavolá fulfil — vráti loanId a protocolId.
 * Štandardný setup pre väčšinu testov.
 */
async function setupDirectLoanWithProtocol(
  app: FastifyInstance,
  managerToken: string,
  borrowerId: string,
  assetId: string,
): Promise<{ loanId: string; protocolId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/loans',
    headers: { cookie: `inv_access=${managerToken}` },
    payload: {
      borrowerId,
      items: [{ assetId }],
      purpose: 'Protokol test',
      dueAt: futureDate(),
    },
  });

  expect(res.statusCode).toBe(201);
  const loan = res.json<{ _id: string; handoverProtocolId: string | null }>();
  const loanId = loan._id;

  // Protokol sa vytvoril — overíme cez GET /v1/loans/:id/protocols
  const listRes = await app.inject({
    method: 'GET',
    url: `/v1/loans/${loanId}/protocols`,
    headers: { cookie: `inv_access=${managerToken}` },
  });
  expect(listRes.statusCode).toBe(200);
  const protocols = listRes.json<{ data: Array<{ _id: string }> }>().data;
  expect(protocols.length).toBeGreaterThanOrEqual(1);
  const protocolId = protocols[0]!._id;

  return { loanId, protocolId };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ADR-0022 K5–K6 — Protokoly (integration)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await cleanTestDatabase(app);
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // K5: GET /v1/loans/:id/protocols
  // ─────────────────────────────────────────────────────────────────────────

  describe('GET /v1/loans/:id/protocols — zoznam protokolov', () => {
    it('manager vidí protokoly výpožičky', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'mgr-list-proto',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower } = await provisionUser(app, {
        oid: 'borrower-list-proto',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app);

      const { loanId } = await setupDirectLoanWithProtocol(
        app,
        managerToken,
        String(borrower._id),
        asset._id,
      );

      const res = await app.inject({
        method: 'GET',
        url: `/v1/loans/${loanId}/protocols`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: Array<{ type: string; status: string }> }>();
      expect(body.data.length).toBe(1);
      expect(body.data[0]!.type).toBe('HANDOVER');
      expect(body.data[0]!.status).toBe('DRAFT');
    });

    it('borrower vidí protokoly vlastnej výpožičky', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'mgr-borrower-view',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower, token: borrowerToken } = await provisionUser(app, {
        oid: 'borrower-view-proto',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app);

      const { loanId } = await setupDirectLoanWithProtocol(
        app,
        managerToken,
        String(borrower._id),
        asset._id,
      );

      const res = await app.inject({
        method: 'GET',
        url: `/v1/loans/${loanId}/protocols`,
        headers: { cookie: `inv_access=${borrowerToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ data: unknown[] }>().data.length).toBe(1);
    });

    it('iný EMPLOYEE (nie borrower) dostane 403', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'mgr-other-emp',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower } = await provisionUser(app, {
        oid: 'borrower-other-emp',
        role: UserRole.EMPLOYEE,
      });
      const { token: strangerToken } = await provisionUser(app, {
        oid: 'stranger-emp',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app);

      const { loanId } = await setupDirectLoanWithProtocol(
        app,
        managerToken,
        String(borrower._id),
        asset._id,
      );

      const res = await app.inject({
        method: 'GET',
        url: `/v1/loans/${loanId}/protocols`,
        headers: { cookie: `inv_access=${strangerToken}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it('cross-tenant izolácia — loan iného tenanta vráti 404', async () => {
      const otherTenant = await seedTestTenant(app, { slug: 'other-tenant-proto' });
      const { token: managerToken } = await provisionUser(app, {
        oid: 'mgr-cross-proto',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: otherBorrower } = await provisionUser(app, {
        oid: 'other-borrower-proto',
        role: UserRole.EMPLOYEE,
        organisationId: otherTenant._id,
      });
      const { token: otherManagerToken } = await provisionUser(app, {
        oid: 'other-mgr-proto',
        role: UserRole.ASSET_MANAGER,
        organisationId: otherTenant._id,
      });
      const asset = await insertTestAsset(app, { organisationId: otherTenant._id });

      const { loanId: otherLoanId } = await setupDirectLoanWithProtocol(
        app,
        otherManagerToken,
        String(otherBorrower._id),
        asset._id,
      );

      // Manager z iného tenanta sa snaží čítať loans iného tenanta
      const res = await app.inject({
        method: 'GET',
        url: `/v1/loans/${otherLoanId}/protocols`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      expect(res.statusCode).toBe(404);
    });

    it('RETURN protokol je v zozname po vrátení', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'mgr-return-list',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower } = await provisionUser(app, {
        oid: 'borrower-return-list',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app);

      const { loanId } = await setupDirectLoanWithProtocol(
        app,
        managerToken,
        String(borrower._id),
        asset._id,
      );

      // Vrátiť výpožičku
      const returnRes = await app.inject({
        method: 'POST',
        url: `/v1/loans/${loanId}/return`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          returnedTo: String(
            (await provisionUser(app, { oid: 'recv-return', role: UserRole.ASSET_MANAGER })).user
              ._id,
          ),
          items: [{ assetId: asset._id, condition: 'GOOD', requiresService: false }],
        },
      });
      expect(returnRes.statusCode).toBe(200);

      const listRes = await app.inject({
        method: 'GET',
        url: `/v1/loans/${loanId}/protocols`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(listRes.statusCode).toBe(200);
      const types = listRes.json<{ data: Array<{ type: string }> }>().data.map((p) => p.type);
      expect(types).toContain('HANDOVER');
      expect(types).toContain('RETURN');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // K5: GET /v1/protocols/:id — metadata
  // ─────────────────────────────────────────────────────────────────────────

  describe('GET /v1/protocols/:id — metadata protokolu', () => {
    it('vráti správne polia protokolu', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'mgr-meta',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower } = await provisionUser(app, {
        oid: 'borrower-meta',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app);

      const { protocolId } = await setupDirectLoanWithProtocol(
        app,
        managerToken,
        String(borrower._id),
        asset._id,
      );

      const res = await app.inject({
        method: 'GET',
        url: `/v1/protocols/${protocolId}`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const proto = res.json<{
        type: string;
        status: string;
        protocolNumber: string;
        signatures: { handover: null; receive: null };
        pdfSha256: null;
      }>();
      expect(proto.type).toBe('HANDOVER');
      expect(proto.status).toBe('DRAFT');
      expect(proto.protocolNumber).toMatch(/^PROT-\d{4}-\d{6}$/);
      expect(proto.signatures.handover).toBeNull();
      expect(proto.signatures.receive).toBeNull();
      expect(proto.pdfSha256).toBeNull();
    });

    it('neznámy protocol ID → 404', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'mgr-404-proto',
        role: UserRole.ASSET_MANAGER,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/protocols/000000000000000000000099',
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('cudzí user (nie účastník, nie manager) → 403', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'mgr-stranger-meta',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower } = await provisionUser(app, {
        oid: 'borrower-stranger-meta',
        role: UserRole.EMPLOYEE,
      });
      const { token: strangerToken } = await provisionUser(app, {
        oid: 'stranger-meta',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app);

      const { protocolId } = await setupDirectLoanWithProtocol(
        app,
        managerToken,
        String(borrower._id),
        asset._id,
      );

      const res = await app.inject({
        method: 'GET',
        url: `/v1/protocols/${protocolId}`,
        headers: { cookie: `inv_access=${strangerToken}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // K5: GET /v1/protocols/:id/pdf — on-demand render
  // ─────────────────────────────────────────────────────────────────────────

  describe('GET /v1/protocols/:id/pdf — PDF render', () => {
    it('vráti Content-Type application/pdf s PDF bajty', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'mgr-pdf',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower } = await provisionUser(app, {
        oid: 'borrower-pdf',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app);

      const { protocolId } = await setupDirectLoanWithProtocol(
        app,
        managerToken,
        String(borrower._id),
        asset._id,
      );

      const res = await app.inject({
        method: 'GET',
        url: `/v1/protocols/${protocolId}/pdf`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.rawPayload.length).toBeGreaterThan(100);
      // PDF magic bytes (%PDF-)
      expect(Buffer.from(res.rawPayload).slice(0, 4).toString()).toBe('%PDF');
    });

    it('lazy pdfSha256 sa uloží po prvom stiahnutí', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'mgr-sha256',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower } = await provisionUser(app, {
        oid: 'borrower-sha256',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app);

      const { protocolId } = await setupDirectLoanWithProtocol(
        app,
        managerToken,
        String(borrower._id),
        asset._id,
      );

      // Overíme, že pdfSha256 je null PRED stiahnutím
      const beforeRes = await app.inject({
        method: 'GET',
        url: `/v1/protocols/${protocolId}`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(beforeRes.json<{ pdfSha256: null }>().pdfSha256).toBeNull();

      // Stiahni PDF
      const pdfRes = await app.inject({
        method: 'GET',
        url: `/v1/protocols/${protocolId}/pdf`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(pdfRes.statusCode).toBe(200);

      // Počkaj krátko (background update je void promise)
      await new Promise((r) => setTimeout(r, 200));

      // pdfSha256 by mal byť teraz nastavený
      const afterRes = await app.inject({
        method: 'GET',
        url: `/v1/protocols/${protocolId}`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      const sha = afterRes.json<{ pdfSha256: string | null }>().pdfSha256;
      expect(sha).toMatch(/^[0-9a-f]{64}$/);
    });

    it('cudzí user → 403 (rovnaký ako metadata endpoint)', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'mgr-pdf-403',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower } = await provisionUser(app, {
        oid: 'borrower-pdf-403',
        role: UserRole.EMPLOYEE,
      });
      const { token: strangerToken } = await provisionUser(app, {
        oid: 'stranger-pdf-403',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app);

      const { protocolId } = await setupDirectLoanWithProtocol(
        app,
        managerToken,
        String(borrower._id),
        asset._id,
      );

      const res = await app.inject({
        method: 'GET',
        url: `/v1/protocols/${protocolId}/pdf`,
        headers: { cookie: `inv_access=${strangerToken}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // K6: POST /v1/protocols/:id/sign — podpis
  // ─────────────────────────────────────────────────────────────────────────

  describe('POST /v1/protocols/:id/sign — CLICK_TO_SIGN', () => {
    it('jednostranný podpis (len handover) — protokol ostáva DRAFT', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'mgr-sign-one',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower } = await provisionUser(app, {
        oid: 'borrower-sign-one',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app);

      const { protocolId } = await setupDirectLoanWithProtocol(
        app,
        managerToken,
        String(borrower._id),
        asset._id,
      );

      // Manager = handover strana (actor.displayName pri fulfil)
      const signRes = await app.inject({
        method: 'POST',
        url: `/v1/protocols/${protocolId}/sign`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: { method: 'CLICK_TO_SIGN' },
      });

      // Manager je handover userId — podpis by mal prejsť
      // Ak 403: manager nie je v protocol.parties.handover.userId — je to K4 borrower-snapshot prázdny zámer
      // V K4 insertDraftProtocol: handoverUserId = actorId (manager), receiveUserId = borrowerId
      // Teda manager = handover ✓
      if (signRes.statusCode === 200) {
        const proto = signRes.json<{
          status: string;
          signatures: { handover: object | null; receive: object | null };
        }>();
        expect(proto.status).toBe('DRAFT'); // len jedna strana podpísala
        expect(proto.signatures.handover).not.toBeNull();
        expect(proto.signatures.receive).toBeNull();
      } else {
        // Ak 403 z iného dôvodu, fail s popisom
        expect(signRes.statusCode, `Sign failed: ${signRes.body}`).toBe(200);
      }
    });

    it('obojstranný podpis → SIGNED + pdfSha256 fixnutý', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'mgr-sign-both',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower, token: borrowerToken } = await provisionUser(app, {
        oid: 'borrower-sign-both',
        role: UserRole.EMPLOYEE,
      });
      await insertTestMembership(app, { userId: String(borrower._id) });
      const asset = await insertTestAsset(app);

      const { protocolId } = await setupDirectLoanWithProtocol(
        app,
        managerToken,
        String(borrower._id),
        asset._id,
      );

      // Handover strana (manager) podpíše
      const sign1 = await app.inject({
        method: 'POST',
        url: `/v1/protocols/${protocolId}/sign`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: { method: 'CLICK_TO_SIGN' },
      });
      expect(sign1.statusCode, `Handover sign failed: ${sign1.body}`).toBe(200);
      expect(sign1.json<{ status: string }>().status).toBe('DRAFT');

      // Receive strana (borrower) podpíše
      const sign2 = await app.inject({
        method: 'POST',
        url: `/v1/protocols/${protocolId}/sign`,
        headers: { cookie: `inv_access=${borrowerToken}` },
        payload: { method: 'CLICK_TO_SIGN' },
      });
      expect(sign2.statusCode, `Receive sign failed: ${sign2.body}`).toBe(200);

      const finalProto = sign2.json<{
        status: string;
        pdfSha256: string | null;
        signatures: { handover: object; receive: object };
      }>();
      expect(finalProto.status).toBe('SIGNED');
      expect(finalProto.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(finalProto.signatures.handover).not.toBeNull();
      expect(finalProto.signatures.receive).not.toBeNull();
    });

    it('podpis tej istej strany dvakrát → 403', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'mgr-double-sign',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower } = await provisionUser(app, {
        oid: 'borrower-double-sign',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app);

      const { protocolId } = await setupDirectLoanWithProtocol(
        app,
        managerToken,
        String(borrower._id),
        asset._id,
      );

      // Prvý podpis
      await app.inject({
        method: 'POST',
        url: `/v1/protocols/${protocolId}/sign`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: { method: 'CLICK_TO_SIGN' },
      });

      // Druhý pokus rovnakou stranou
      const res = await app.inject({
        method: 'POST',
        url: `/v1/protocols/${protocolId}/sign`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: { method: 'CLICK_TO_SIGN' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('cudzí user (nie účastník) → 403', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'mgr-stranger-sign',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower } = await provisionUser(app, {
        oid: 'borrower-stranger-sign',
        role: UserRole.EMPLOYEE,
      });
      const { token: strangerToken } = await provisionUser(app, {
        oid: 'stranger-sign',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app);

      const { protocolId } = await setupDirectLoanWithProtocol(
        app,
        managerToken,
        String(borrower._id),
        asset._id,
      );

      const res = await app.inject({
        method: 'POST',
        url: `/v1/protocols/${protocolId}/sign`,
        headers: { cookie: `inv_access=${strangerToken}` },
        payload: { method: 'CLICK_TO_SIGN' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('podpis SIGNED protokolu → 403 (nemenný po podpise)', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'mgr-signed-sign',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower, token: borrowerToken } = await provisionUser(app, {
        oid: 'borrower-signed-sign',
        role: UserRole.EMPLOYEE,
      });
      await insertTestMembership(app, { userId: String(borrower._id) });
      const asset = await insertTestAsset(app);

      const { protocolId } = await setupDirectLoanWithProtocol(
        app,
        managerToken,
        String(borrower._id),
        asset._id,
      );

      // Obojstranný podpis
      await app.inject({
        method: 'POST',
        url: `/v1/protocols/${protocolId}/sign`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: { method: 'CLICK_TO_SIGN' },
      });
      await app.inject({
        method: 'POST',
        url: `/v1/protocols/${protocolId}/sign`,
        headers: { cookie: `inv_access=${borrowerToken}` },
        payload: { method: 'CLICK_TO_SIGN' },
      });

      // Ďalší pokus o podpis
      const res = await app.inject({
        method: 'POST',
        url: `/v1/protocols/${protocolId}/sign`,
        headers: { cookie: `inv_access=${borrowerToken}` },
        payload: { method: 'CLICK_TO_SIGN' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Snapshot-not-live
  // ─────────────────────────────────────────────────────────────────────────

  describe('Snapshot-not-live — zmena assetu nemení protokol', () => {
    it('zmena asset.name po fulfil sa neodráža v protokole', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'mgr-snapshot',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower } = await provisionUser(app, {
        oid: 'borrower-snapshot',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app, { name: 'Pôvodný názov' });

      const { protocolId } = await setupDirectLoanWithProtocol(
        app,
        managerToken,
        String(borrower._id),
        asset._id,
      );

      // Zmeň asset.name priamo v DB (simulácia zmeny po fulfil)
      await app.mongo.db
        .collection('assets')
        .updateOne({ inventoryNumber: asset.inventoryNumber }, { $set: { name: 'Zmenený názov' } });

      // Protokol by mal stále mať pôvodný snapshot
      const protoRes = await app.inject({
        method: 'GET',
        url: `/v1/protocols/${protocolId}`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(protoRes.statusCode).toBe(200);
      const items = protoRes.json<{
        items: Array<{ snapshot: { name: string } }>;
      }>().items;
      expect(items[0]!.snapshot.name).toBe('Pôvodný názov');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Multi-fulfil: každý fulfil = vlastný HANDOVER protokol
  // ─────────────────────────────────────────────────────────────────────────

  describe('Multi-fulfil — každý fulfil vytvára vlastný protokol', () => {
    it('dva fulfil z tej istej žiadosti → dva HANDOVER protokoly', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'mgr-multi',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower } = await provisionUser(app, {
        oid: 'borrower-multi',
        role: UserRole.EMPLOYEE,
      });
      await insertTestMembership(app, { userId: String(borrower._id) });
      const category = await insertTestCategory(app);
      const asset1 = await insertTestAsset(app, {
        status: 'AVAILABLE',
        categoryId: category._id,
      });
      const asset2 = await insertTestAsset(app, {
        status: 'AVAILABLE',
        categoryId: category._id,
      });

      // Vytvor žiadosť o 2 kusy
      const reqRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          purpose: 'Multi fulfil test',
          plannedFrom: new Date().toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 2 }],
        },
      });
      expect(reqRes.statusCode).toBe(201);
      const requestId = reqRes.json<{ _id: string }>()._id;

      // Schváľ
      await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/approve`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      // Fulfil 1 — asset1
      const fulfil1 = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/fulfil`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          items: [{ requestItemIndex: 0, type: 'SERIALIZED', assetIds: [asset1._id] }],
          dueAt: futureDate(),
        },
      });
      expect(fulfil1.statusCode).toBe(201);
      const loan1Id = fulfil1.json<{ _id: string }>()._id;

      // Fulfil 2 — asset2
      const fulfil2 = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/fulfil`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          items: [{ requestItemIndex: 0, type: 'SERIALIZED', assetIds: [asset2._id] }],
          dueAt: futureDate(),
        },
      });
      expect(fulfil2.statusCode).toBe(201);
      const loan2Id = fulfil2.json<{ _id: string }>()._id;

      // Každý loan má vlastný protokol
      const proto1Res = await app.inject({
        method: 'GET',
        url: `/v1/loans/${loan1Id}/protocols`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      const proto2Res = await app.inject({
        method: 'GET',
        url: `/v1/loans/${loan2Id}/protocols`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      expect(proto1Res.statusCode).toBe(200);
      expect(proto2Res.statusCode).toBe(200);
      const protos1 = proto1Res.json<{ data: Array<{ _id: string; protocolNumber: string }> }>()
        .data;
      const protos2 = proto2Res.json<{ data: Array<{ _id: string; protocolNumber: string }> }>()
        .data;

      expect(protos1.length).toBe(1);
      expect(protos2.length).toBe(1);
      // Rôzne protokoly
      expect(protos1[0]!._id).not.toBe(protos2[0]!._id);
      // Rôzne čísla protokolov
      expect(protos1[0]!.protocolNumber).not.toBe(protos2[0]!.protocolNumber);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Stránkovanie: protokol s 25+ položkami
  // ─────────────────────────────────────────────────────────────────────────

  describe('Stránkovanie — protokol s 25+ položkami', () => {
    it('PDF sa vyrenderuje aj pre protokol s 26 položkami', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'mgr-paging',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower } = await provisionUser(app, {
        oid: 'borrower-paging',
        role: UserRole.EMPLOYEE,
      });

      // Vytvor 26 assetov
      const assets = await Promise.all(
        Array.from({ length: 26 }, (_, i) =>
          insertTestAsset(app, { name: `Majetok ${String(i + 1).padStart(2, '0')}` }),
        ),
      );

      // Priama výpožička so 26 položkami
      const loanRes = await app.inject({
        method: 'POST',
        url: '/v1/loans',
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          borrowerId: String(borrower._id),
          items: assets.map((a) => ({ assetId: a._id })),
          purpose: 'Stránkovanie test',
          dueAt: futureDate(),
        },
      });
      expect(loanRes.statusCode).toBe(201);
      const loanId = loanRes.json<{ _id: string }>()._id;

      const listRes = await app.inject({
        method: 'GET',
        url: `/v1/loans/${loanId}/protocols`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(listRes.statusCode).toBe(200);
      const protocolId = listRes.json<{ data: Array<{ _id: string }> }>().data[0]!._id;

      const pdfRes = await app.inject({
        method: 'GET',
        url: `/v1/protocols/${protocolId}/pdf`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      expect(pdfRes.statusCode).toBe(200);
      expect(pdfRes.headers['content-type']).toBe('application/pdf');
      expect(Buffer.from(pdfRes.rawPayload).slice(0, 4).toString()).toBe('%PDF');
    });
  });
});
