// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Register indexov — `ensureIndexes()` mimo produkčného cold-startu.
 *
 * Každý modul volal pri registrácii svoje `repo.ensureIndexes()`. Spolu
 * je toho 18 volaní a idú sériovo, takže cold start platí 18 round-tripov
 * na Atlas ešte pred prvým užitočným requestom (lokálne, pri nulovej
 * sieťovej latencii, to bolo ~1,4 s; na Atlase podstatne viac).
 *
 * Indexy sa pritom pri behu appky nemenia — menia sa pri deployi. Preto
 * ten istý vzor ako pri migráciách (`migrations.routes.ts`, commit
 * `00a2515`): v produkcii sa pri boote nevytvárajú, spustí ich deploy-time
 * endpoint `POST /v1/system/indexes/ensure`.
 *
 * Mimo produkcie (dev, testy, EXPORT_ONLY) sa naďalej volajú pri boote —
 * testy si každý súbor vytvárajú čistú DB a spoliehajú sa na to, že
 * indexy (najmä unique) existujú.
 *
 * Moduly sa do registra pridávajú samy tým, že namiesto priameho volania
 * použijú `ensureIndexesOnBoot(fastify, 'nazov', repo)`. Žiadny centrálny
 * zoznam, ktorý by sa dal zabudnúť aktualizovať.
 */

import fp from 'fastify-plugin';

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

/** Čokoľvek, čo vie vytvoriť svoje indexy. */
export interface IndexEnsurer {
  ensureIndexes: () => Promise<void>;
}

interface RegisteredEnsurer {
  name: string;
  run: () => Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    indexEnsurers: RegisteredEnsurer[];
  }
}

/**
 * V produkcii sa indexy pri boote nevytvárajú — má to na starosti
 * deploy-time endpoint. EXPORT_ONLY je výnimka (ephemerálna in-memory DB).
 */
export function skipIndexesOnBoot(): boolean {
  return process.env['NODE_ENV'] === 'production' && process.env['EXPORT_ONLY'] !== 'true';
}

/**
 * Zaregistruje repozitár do registra indexov a — mimo produkcie — rovno
 * vytvorí jeho indexy. Nahrádza priame `await repo.ensureIndexes()` v
 * registrácii modulu.
 */
export async function ensureIndexesOnBoot(
  fastify: FastifyInstance,
  name: string,
  repo: IndexEnsurer,
): Promise<void> {
  fastify.indexEnsurers.push({ name, run: () => repo.ensureIndexes() });
  if (skipIndexesOnBoot()) return;
  await repo.ensureIndexes();
}

const indexRegistryPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('indexEnsurers', [] as RegisteredEnsurer[]);
};

export default fp(indexRegistryPlugin, {
  name: 'index-registry',
  dependencies: ['mongo'],
});
