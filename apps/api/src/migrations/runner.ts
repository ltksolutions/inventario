// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration runner — runs pending migrations in order on startup.
 *
 * Migrations are tracked via a `migrations` collection in MongoDB.
 * Each migration has a unique `key` and is only run once (idempotent via
 * the `completedAt` flag check before running).
 *
 * Usage:
 *   import { runPendingMigrations } from './migrations/runner.js';
 *   await runPendingMigrations(db, logger);
 *
 * This is called from apps/api/src/index.ts (and the Vercel edge function)
 * BEFORE the Fastify server starts accepting requests.
 */

import { migrate_2026_05_23_memberships } from './2026-05-23-memberships.js';

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

// ---------------------------------------------------------------------------
// Migration registry — add new migrations here in chronological order
// ---------------------------------------------------------------------------

interface MigrationDefinition {
  key: string;
  description: string;
  run: (db: Db, logger: FastifyBaseLogger) => Promise<void>;
}

const MIGRATIONS: MigrationDefinition[] = [
  {
    key: '2026-05-23-memberships',
    description: 'ADR-0015: Split User into global identity + Membership. Move per-tenant fields.',
    run: migrate_2026_05_23_memberships,
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runPendingMigrations(db: Db, logger: FastifyBaseLogger): Promise<void> {
  const migrationsCollection = db.collection<MigrationRecord>('migrations');

  // Ensure the tracking collection has a unique index on `key`.
  await migrationsCollection.createIndex({ key: 1 }, { unique: true, name: 'migrations_key' });

  for (const migration of MIGRATIONS) {
    const existing = await migrationsCollection.findOne({ key: migration.key });

    if (existing?.completedAt) {
      logger.info(
        { key: migration.key, completedAt: existing.completedAt },
        `Migration already completed — skipping`,
      );
      continue;
    }

    logger.info({ key: migration.key }, `Running migration: ${migration.description}`);
    const startedAt = new Date().toISOString();

    try {
      await migration.run(db, logger);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ key: migration.key, error: msg }, `Migration FAILED`);
      throw new Error(`Migration '${migration.key}' failed: ${msg}`);
    }

    const completedAt = new Date().toISOString();

    // Upsert the completion record (idempotent if runner is restarted
    // after the migration ran but before this write).
    await migrationsCollection.updateOne(
      { key: migration.key },
      {
        $set: {
          key: migration.key,
          description: migration.description,
          startedAt,
          completedAt,
        },
      },
      { upsert: true },
    );

    logger.info({ key: migration.key, completedAt }, `Migration completed`);
  }

  logger.info('All pending migrations completed.');
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface MigrationRecord {
  key: string;
  description: string;
  startedAt: string;
  completedAt: string;
}
