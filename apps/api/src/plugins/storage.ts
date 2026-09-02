// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Object storage plugin — sprístupní `fastify.objectStorage` (ADR-0037).
 *
 * Rovnaký vzor ako `plugins/email.ts`: výber implementácie sa robí RAZ pri
 * boote podľa konfigurácie, nie pri každom requeste. Handlery potom nevedia
 * a nemusia vedieť, či pod tým beží Vercel Blob alebo in-memory stub.
 *
 * V testoch je to vždy stub — `selectObjectStorage` to vynucuje podľa
 * `NODE_ENV`, aj keby token v prostredí náhodou bol. Integračný test nesmie
 * zapísať do skutočného storu ani omylom.
 *
 * Bez tokenu appka NABOOTUJE a beží; prílohy len nikam neodletia a v
 * produkcii to `lib/storage` zaloguje ako error. Zámerne to nie je fatálna
 * chyba: výpadok úložiska nemá zhodiť celý inventár.
 */

import fp from 'fastify-plugin';

import { selectObjectStorage } from '../lib/storage/index.js';

import type { ObjectStorage } from '../lib/storage/index.js';
import type { FastifyPluginAsync } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    objectStorage: ObjectStorage;
  }
}

const storagePlugin: FastifyPluginAsync = async (fastify) => {
  const storage = selectObjectStorage({
    logger: fastify.log,
    token: fastify.config.BLOB_PRIVATE_READ_WRITE_TOKEN,
    storeId: fastify.config.BLOB_PRIVATE_STORE_ID,
    nodeEnv: fastify.config.NODE_ENV,
  });

  fastify.decorate('objectStorage', storage);
};

export default fp(storagePlugin, {
  name: 'storage',
  dependencies: ['config'],
});
