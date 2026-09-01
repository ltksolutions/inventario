// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Unit testy stub úložiska (ADR-0037, fáza 0).
 *
 * Stub je to, proti čomu bežia integračné testy — ak sa rozíde s kontraktom
 * `ObjectStorage`, testy budú zelené proti niečomu, čo v produkcii neplatí.
 * Preto tieto testy overujú práve tie vlastnosti, na ktoré sa handlery
 * spoliehajú: idempotentné mazanie, `head` na neexistujúci objekt vracia
 * `null` (nie výnimku), a podpísané URL nesú expiráciu.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  createStubStorage,
  DOWNLOAD_URL_TTL_SECONDS,
  selectObjectStorage,
  UPLOAD_URL_TTL_SECONDS,
} from '../../src/lib/storage/index.js';

import type { FastifyBaseLogger } from 'fastify';

/** Minimálny logger — stub z neho používa len `debug`/`warn`/`info`. */
function fakeLogger(): FastifyBaseLogger {
  const noop = vi.fn();
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    trace: noop,
    silent: noop,
    level: 'info',
    child: () => fakeLogger(),
  } as unknown as FastifyBaseLogger;
}

function makeStub() {
  return createStubStorage({ logger: fakeLogger(), token: undefined });
}

describe('stub object storage', () => {
  it('put a get vrátia ten istý obsah', async () => {
    const storage = makeStub();
    const body = Buffer.from('ahoj');

    const stored = await storage.put({
      pathname: 'attachments/t1/a1/x.jpg',
      body,
      contentType: 'image/jpeg',
    });

    expect(stored.sizeBytes).toBe(4);
    expect(await storage.get('attachments/t1/a1/x.jpg')).toEqual(body);
  });

  it('head na neexistujúci objekt vracia null, nie výnimku', async () => {
    const storage = makeStub();
    await expect(storage.head('nic/tu/nie.jpg')).resolves.toBeNull();
  });

  it('head na existujúci objekt vracia veľkosť a typ', async () => {
    const storage = makeStub();
    await storage.put({
      pathname: 'p.pdf',
      body: Buffer.alloc(1234),
      contentType: 'application/pdf',
    });

    await expect(storage.head('p.pdf')).resolves.toEqual({
      pathname: 'p.pdf',
      sizeBytes: 1234,
      contentType: 'application/pdf',
    });
  });

  it('get na neexistujúci objekt padne', async () => {
    const storage = makeStub();
    await expect(storage.get('nic.jpg')).rejects.toThrow(/neexistuje/);
  });

  it('mazanie je idempotentné — druhý beh nepadne', async () => {
    const storage = makeStub();
    await storage.put({ pathname: 'a.jpg', body: Buffer.from('x'), contentType: 'image/jpeg' });

    await storage.remove('a.jpg');
    expect(storage.size).toBe(0);

    // Kľúčová vlastnosť: mazanie už zmazaného objektu NIE JE chyba. Handler
    // pri soft delete a GDPR výmaze na to spoliehá.
    await expect(storage.remove('a.jpg')).resolves.toBeUndefined();
  });

  it('podpísaná PUT URL nesie pathname a expiráciu v rozsahu TTL', async () => {
    const storage = makeStub();
    const before = Date.now();

    const result = await storage.presignUpload({
      pathname: 'attachments/t1/a1/foto.jpg',
      contentType: 'image/jpeg',
    });

    expect(result.pathname).toBe('attachments/t1/a1/foto.jpg');
    const expiresIn = new Date(result.expiresAt).getTime() - before;
    expect(expiresIn).toBeGreaterThan(0);
    expect(expiresIn).toBeLessThanOrEqual(UPLOAD_URL_TTL_SECONDS * 1000 + 1000);
  });

  it('podpísaná GET URL má kratšiu expiráciu než upload — je prenosná', async () => {
    const storage = makeStub();
    const before = Date.now();

    const result = await storage.presignDownload('attachments/t1/a1/foto.jpg');

    const expiresIn = new Date(result.expiresAt).getTime() - before;
    expect(expiresIn).toBeLessThanOrEqual(DOWNLOAD_URL_TTL_SECONDS * 1000 + 1000);
    expect(DOWNLOAD_URL_TTL_SECONDS).toBeLessThan(UPLOAD_URL_TTL_SECONDS);
  });
});

describe('selectObjectStorage', () => {
  it('v testovacom prostredí vždy stub, aj keď je token nastavený', () => {
    const storage = selectObjectStorage({
      logger: fakeLogger(),
      token: 'vercel_blob_rw_fake',
      storeId: 'store_fake',
      nodeEnv: 'test',
    });

    // Test nesmie zapisovať do skutočného storu ani omylom.
    expect(storage.name).toBe('stub');
  });

  it('bez tokenu a bez storeId padne na stub', () => {
    const storage = selectObjectStorage({
      logger: fakeLogger(),
      token: undefined,
      storeId: undefined,
      nodeEnv: 'development',
    });

    expect(storage.name).toBe('stub');
  });

  it('s tokenom mimo testov použije Vercel Blob', () => {
    const storage = selectObjectStorage({
      logger: fakeLogger(),
      token: 'vercel_blob_rw_fake',
      storeId: undefined,
      nodeEnv: 'development',
    });

    expect(storage.name).toBe('vercel-blob');
  });
});
