// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Local dev entry point — starts a long-running Fastify server.
 *
 * Production on Vercel uses `api/index.ts` (serverless handler).
 *
 * Run with:
 *   pnpm dev   → uses tsx watch for auto-reload
 *   pnpm start → uses compiled dist/index.js
 */

import { buildServer } from './server.js';

async function main(): Promise<void> {
  const app = await buildServer();

  const port = app.config.PORT;
  const host = '0.0.0.0';

  try {
    await app.listen({ port, host });
    app.log.info(
      `🚀 API running at http://localhost:${port}\n` +
        `   Swagger UI: http://localhost:${port}/docs\n` +
        `   Health: http://localhost:${port}/health`,
    );
  } catch (err) {
    app.log.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutdown signal received, closing server...');
    try {
      await app.close();
      app.log.info('Server closed cleanly');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
