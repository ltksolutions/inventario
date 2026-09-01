// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Výber úložiska originálov príloh (ADR-0037).
 *
 * Reálny Vercel Blob private store sa použije vtedy, keď je k dispozícii
 * autentifikácia — teda `BLOB_READ_WRITE_TOKEN` (lokálne a v CI) alebo
 * OIDC na Verceli (`VERCEL_OIDC_TOKEN` + `BLOB_STORE_ID`, ktoré SDK berie
 * samo). Inak sa použije in-memory stub.
 *
 * Rovnaký vzor ako `plugins/email.ts` s `EMAIL_PROVIDER=stub`: bez
 * konfigurácie appka nabootuje a funguje, len prílohy nikam neodletia.
 * Testy tak nesiahajú na skutočný store.
 */

import { createStubStorage } from './stub.storage.js';
import { createVercelBlobStorage } from './vercel-blob.storage.js';

import type { ObjectStorage, StorageContext } from './types.js';
import type { FastifyBaseLogger } from 'fastify';

export * from './types.js';
export { createStubStorage } from './stub.storage.js';
export type { StubStorage } from './stub.storage.js';

export interface SelectStorageInput {
  logger: FastifyBaseLogger;
  /** `BLOB_READ_WRITE_TOKEN`, ak je nastavený. */
  token?: string | undefined;
  /** `BLOB_STORE_ID`, ak je nastavený (na Verceli ho dopĺňa platforma). */
  storeId?: string | undefined;
  /** `NODE_ENV` — kvôli hlasitému varovaniu v produkcii. */
  nodeEnv: 'development' | 'test' | 'production';
}

export function selectObjectStorage(input: SelectStorageInput): ObjectStorage {
  const { logger, token, storeId, nodeEnv } = input;

  // V testoch vždy stub, aj keby token v prostredí náhodou bol. Test nesmie
  // zapisovať do skutočného storu ani omylom.
  if (nodeEnv === 'test') {
    return createStubStorage({ logger, token: undefined });
  }

  const hasAuth = Boolean(token) || Boolean(storeId) || Boolean(process.env['VERCEL_OIDC_TOKEN']);

  if (!hasAuth) {
    if (nodeEnv === 'production') {
      logger.error(
        'BLOB_READ_WRITE_TOKEN ani BLOB_STORE_ID nie sú nastavené — prílohy sa NEBUDÚ ukladať. ' +
          'Pripoj private Blob store k projektu (ADR-0037).',
      );
    } else {
      logger.warn(
        'Object storage beží v stub režime (bez BLOB_READ_WRITE_TOKEN) — prílohy zostanú len v pamäti.',
      );
    }
    return createStubStorage({ logger, token: undefined });
  }

  logger.info(
    { hasToken: Boolean(token), hasStoreId: Boolean(storeId) },
    'Object storage: Vercel Blob (private)',
  );

  const ctx: StorageContext = { logger, token };
  return createVercelBlobStorage(ctx);
}
