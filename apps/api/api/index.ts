// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Vercel Serverless Function entry point.
 *
 * Vercel invokes the default export for every HTTP request matching the
 * route `/(.*)` (configured in vercel.json). We build the Fastify instance
 * once at module scope (warm invocations reuse it) and emit incoming
 * requests to it via the underlying Node.js HTTP server's event emitter.
 *
 * Why this pattern?
 *   - Vercel gives us Node.js req/res objects (IncomingMessage/ServerResponse)
 *   - Fastify wraps a Node http.Server internally
 *   - Calling `server.emit('request', req, res)` triggers Fastify's routing
 *     as if the request came through a normal HTTP listener.
 *
 * Module-level state survives warm invocations (~5-15 min), so we get a
 * "free" connection pool reuse without managing it explicitly.
 */

import { buildServer } from '../src/server.js';

import type { FastifyInstance } from 'fastify';
import type { IncomingMessage, ServerResponse } from 'node:http';

let serverPromise: Promise<FastifyInstance> | null = null;

async function getServer(): Promise<FastifyInstance> {
  if (!serverPromise) {
    const startedAt = Date.now();
    serverPromise = buildServer().then(async (app) => {
      const builtAt = Date.now();
      await app.ready();
      // Celkový cold start tak, ako ho cíti prvý request: buildServer
      // (pluginy + Atlas + ensureIndexes) + app.ready() (Fastify uzavrie
      // route strom a skompiluje validátory).
      app.log.info(
        { buildMs: builtAt - startedAt, readyMs: Date.now() - builtAt },
        'Cold start complete',
      );
      return app;
    });
  }
  return serverPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getServer();
  app.server.emit('request', req, res);
}
