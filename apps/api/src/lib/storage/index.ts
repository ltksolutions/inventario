// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Výber úložiska originálov príloh (ADR-0037).
 *
 * Reálny Vercel Blob private store sa použije vtedy a len vtedy, keď je
 * nastavený `BLOB_PRIVATE_READ_WRITE_TOKEN`. Inak in-memory stub.
 *
 * POZOR — prečo nie OIDC: projekt má pripojené DVA story a v env aj
 * `BLOB_READ_WRITE_TOKEN` starého PUBLIC storu. Keby sme token nepredali
 * explicitne, `@vercel/blob` by si ho vzal z prostredia a originály
 * príloh by skončili vo verejnom store. Token je preto povinný.
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
  /** `BLOB_PRIVATE_READ_WRITE_TOKEN`. Bez neho sa použije stub. */
  token?: string | undefined;
  /** `BLOB_PRIVATE_STORE_ID` — len na logovanie. */
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

  if (token === undefined) {
    if (nodeEnv === 'production') {
      logger.error(
        'BLOB_PRIVATE_READ_WRITE_TOKEN nie je nastavený — prílohy sa NEBUDÚ ukladať. ' +
          'Pripoj private Blob store k projektu s prefixom BLOB_PRIVATE (ADR-0037).',
      );
    } else {
      logger.warn(
        'Object storage beží v stub režime (bez BLOB_PRIVATE_READ_WRITE_TOKEN) — ' +
          'prílohy zostanú len v pamäti.',
      );
    }
    return createStubStorage({ logger, token: undefined });
  }

  logger.info({ hasStoreId: Boolean(storeId) }, 'Object storage: Vercel Blob (private)');

  const ctx: StorageContext = { logger, token };
  return createVercelBlobStorage(ctx);
}
