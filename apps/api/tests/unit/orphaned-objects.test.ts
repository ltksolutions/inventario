// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Čistič osirelých objektov (ADR-0039).
 *
 * Toto je mazacia cesta, takže testy nestrážia „funguje to", ale „nezmaže
 * to niečo živé". Štyri veci, na ktorých to stojí:
 *
 *   1. objekt bez záznamu a starší než odklad → osirelý
 *   2. objekt SO záznamom → nikdy, ani keď je starý
 *   3. objekt mladší než odklad → nikdy, aj keď záznam nemá (`confirm`
 *      mohol práve bežať)
 *   4. cross-tenant: objekt tenanta B sa nesmie javiť ako osirelý len
 *      preto, že sa pozeráme „z" tenanta A. Referencie sa čítajú naprieč
 *      všetkými tenantmi — keby nie, čistič by mazal cudzie dáta.
 *
 * Test ide proti stub úložisku a in-memory Mongu; `uploadedAt` si seeduje
 * sám, aby sa vekový odklad dal overiť bez čakania.
 */

import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createStubStorage } from '../../src/lib/storage/stub.storage.js';
import {
  ORPHAN_MIN_AGE_HOURS,
  purgeOrphanedObjects,
  scanOrphanedObjects,
} from '../../src/modules/system/orphaned-objects.service.js';

import type { StubStorage } from '../../src/lib/storage/stub.storage.js';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

const TENANT_A = '6a2132796759f4db9a40bcad';
const TENANT_B = '6a18ba69ef5a83d709e0a770';
const ASSET = '6a23d12490714b1de5ac9e4a';

const BODY = Buffer.from('x'.repeat(64), 'utf8');

function fakeLogger(): FastifyBaseLogger {
  const noop = (): void => {};
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    fatal: noop,
    trace: noop,
    silent: noop,
    level: 'info',
    child: () => fakeLogger(),
  } as unknown as FastifyBaseLogger;
}

/** ISO čas o `hours` hodín v minulosti. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function pathFor(tenantId: string, name: string): string {
  return `attachments/${tenantId}/${ASSET}/${name}`;
}

describe('osirelé objekty v úložisku', () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let storage: StubStorage;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    db = client.db('orphans_test');
  });

  afterAll(async () => {
    await client.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    await db.collection('attachments').deleteMany({});
    storage = createStubStorage({ logger: fakeLogger(), token: undefined });
  });

  /** Vloží prílohu, ktorá na daný pathname ukazuje. */
  async function insertAttachment(
    pathname: string,
    options: { deleted?: boolean } = {},
  ): Promise<void> {
    await db.collection('attachments').insertOne({
      organisationId: TENANT_A,
      storageKey: pathname,
      storagePathname: pathname,
      storageAccess: 'PRIVATE',
      deletedAt: options.deleted === true ? new Date().toISOString() : null,
    });
  }

  it('objekt bez záznamu a starší než odklad je osirelý', async () => {
    const pathname = pathFor(TENANT_A, 'orphan.jpg');
    storage.seed({ pathname, body: BODY, contentType: 'image/jpeg', uploadedAt: hoursAgo(48) });

    const scan = await scanOrphanedObjects(db, storage, fakeLogger());

    expect(scan.orphans.map((o) => o.pathname)).toEqual([pathname]);
    expect(scan.scanned).toBe(1);
  });

  it('objekt SO záznamom nie je osirelý ani keď je starý', async () => {
    const pathname = pathFor(TENANT_A, 'zive.jpg');
    storage.seed({
      pathname,
      body: BODY,
      contentType: 'image/jpeg',
      uploadedAt: hoursAgo(24 * 90),
    });
    await insertAttachment(pathname);

    const scan = await scanOrphanedObjects(db, storage, fakeLogger());

    expect(scan.orphans).toEqual([]);
  });

  // `confirm` beží sekundy po PUT-e, ale keby čistič nepočkal, zmazal by
  // objekt práve prebiehajúceho uploadu — a používateľ by dostal chybu
  // „objekt v úložisku neexistuje" bez toho, aby čokoľvek pokazil.
  it('objekt mladší než odklad sa nepovažuje za osirelý', async () => {
    const pathname = pathFor(TENANT_A, 'prave-teraz.jpg');
    storage.seed({
      pathname,
      body: BODY,
      contentType: 'image/jpeg',
      uploadedAt: hoursAgo(ORPHAN_MIN_AGE_HOURS - 1),
    });

    const scan = await scanOrphanedObjects(db, storage, fakeLogger());

    expect(scan.orphans).toEqual([]);
  });

  // Najzradnejšia chyba, aká sa tu dá spraviť: keby sa referencie čítali
  // per-tenant, objekty ostatných tenantov by sa javili ako osirelé.
  it('referencie sa čítajú naprieč tenantmi — cudzí objekt sa nezmaže', async () => {
    const pathA = pathFor(TENANT_A, 'a.jpg');
    const pathB = pathFor(TENANT_B, 'b.jpg');
    storage.seed({
      pathname: pathA,
      body: BODY,
      contentType: 'image/jpeg',
      uploadedAt: hoursAgo(48),
    });
    storage.seed({
      pathname: pathB,
      body: BODY,
      contentType: 'image/jpeg',
      uploadedAt: hoursAgo(48),
    });

    // Príloha tenanta B, uložená s jeho organisationId.
    await db.collection('attachments').insertOne({
      organisationId: TENANT_B,
      storageKey: pathB,
      storagePathname: pathB,
      storageAccess: 'PRIVATE',
      deletedAt: null,
    });

    const scan = await scanOrphanedObjects(db, storage, fakeLogger());

    expect(scan.orphans.map((o) => o.pathname)).toEqual([pathA]);
  });

  // Zmazaná príloha má podľa retenčného rozvrhu mať zmazaný aj objekt.
  // Ak best-effort `del()` pri mazaní zlyhal, čistič to dobehne.
  it('objekt soft-zmazanej prílohy je osirelý (dobehnutie zlyhaného del)', async () => {
    const pathname = pathFor(TENANT_A, 'zmazana.jpg');
    storage.seed({ pathname, body: BODY, contentType: 'image/jpeg', uploadedAt: hoursAgo(48) });
    await insertAttachment(pathname, { deleted: true });

    const scan = await scanOrphanedObjects(db, storage, fakeLogger());

    expect(scan.orphans.map((o) => o.pathname)).toEqual([pathname]);
  });

  it('purge zmaže len osirelé a vráti uvolnené bajty', async () => {
    const orphan = pathFor(TENANT_A, 'orphan.jpg');
    const live = pathFor(TENANT_A, 'zive.jpg');
    storage.seed({
      pathname: orphan,
      body: BODY,
      contentType: 'image/jpeg',
      uploadedAt: hoursAgo(48),
    });
    storage.seed({
      pathname: live,
      body: BODY,
      contentType: 'image/jpeg',
      uploadedAt: hoursAgo(48),
    });
    await insertAttachment(live);

    const result = await purgeOrphanedObjects(db, storage, fakeLogger());

    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.freedBytes).toBe(BODY.byteLength);
    expect(result.skipped).toBe(false);

    expect(await storage.head(orphan)).toBeNull();
    expect(await storage.head(live)).not.toBeNull();
  });

  it('objekty mimo attachments/ čistič vôbec nevidí', async () => {
    storage.seed({
      pathname: 'nieco-ine/subor.bin',
      body: BODY,
      contentType: 'application/octet-stream',
      uploadedAt: hoursAgo(48),
    });

    const scan = await scanOrphanedObjects(db, storage, fakeLogger());

    expect(scan.scanned).toBe(0);
    expect(scan.orphans).toEqual([]);
  });
});
