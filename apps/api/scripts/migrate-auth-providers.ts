/**
 * K9 ADR-0013 — Backfill authProviders on pre-Slice-#6 Entra ID users.
 *
 * Why this script exists
 * ----------------------
 * Slice #6a (ADR-0013) introduced the `authProviders[]` array to the User
 * schema. New users created via the OAuth or email auth flows have this
 * field populated. However, users provisioned by the legacy JIT MSAL flow
 * (Slice #2 → #5) have `entraOid` set but `authProviders` empty (`[]`).
 *
 * Without this backfill those users cannot log in via the new
 * `GET /v1/auth/callback/microsoft` flow because
 * `provisionOrFindUser()` looks them up by
 * `authProviders[].{provider: 'MICROSOFT', providerId: entraOid}`.
 *
 * This script:
 *
 *   1. Finds all users with `entraOid != null` AND
 *      `authProviders` empty (`{ $size: 0 }`) or missing.
 *   2. Pushes `{ provider: 'MICROSOFT', providerId: entraOid, email,
 *      linkedAt: createdAt }` into `authProviders`.
 *   3. Sets `emailVerified: true` (Entra ID always verifies email).
 *
 * Idempotent
 * ----------
 * Running twice is a no-op: the `authProviders` array will already have
 * the Microsoft entry, and the `$size: 0` filter matches zero documents.
 *
 * Dry-run
 * -------
 * Pass `--dry-run` to print what would change without writing anything.
 *
 * Usage
 * -----
 *   pnpm --filter @inventario/api migrate:auth-providers [--dry-run]
 *
 * Environment
 * -----------
 * Reads MONGO_URI + MONGO_DB_NAME from the environment / .env.local.
 */

import { MongoClient } from 'mongodb';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const showHelp = args.includes('--help') || args.includes('-h');

if (showHelp) {
  printUsage();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('\n❌ Migration failed:');
  console.error(err);
  process.exit(1);
});

async function main(): Promise<void> {
  const { uri, dbName } = readEnv();

  banner(isDryRun);

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });

  try {
    await client.connect();
    const db = client.db(dbName);
    const users = db.collection('users');

    console.log(`Connected → ${dbName}`);
    console.log('');

    // -----------------------------------------------------------------------
    // Step 1: Find candidates
    // -----------------------------------------------------------------------
    console.log('Step 1: Find users with entraOid but empty authProviders');

    const filter = {
      entraOid: { $ne: null },
      $or: [{ authProviders: { $exists: false } }, { authProviders: { $size: 0 } }],
    };

    const total = await users.countDocuments(filter);

    if (total === 0) {
      console.log('  ✓ No users to migrate — all already have authProviders set.');
      console.log('');
      summary(isDryRun, 0);
      return;
    }

    console.log(`  Found ${total} user(s) to migrate.`);
    console.log('');

    // -----------------------------------------------------------------------
    // Step 2: Backfill
    // -----------------------------------------------------------------------
    console.log('Step 2: Backfill authProviders + emailVerified');

    if (isDryRun) {
      // Show a sample of affected users
      const sample = await users.find(filter).limit(5).toArray();
      for (const u of sample) {
        console.log(
          `  [DRY-RUN] Would migrate: ${String(u['email'])} (entraOid: ${String(u['entraOid'])})`,
        );
      }
      if (total > 5) {
        console.log(`  [DRY-RUN] ... and ${total - 5} more.`);
      }
      console.log('');
      summary(isDryRun, total);
      return;
    }

    // Process in batches to avoid huge update payloads
    const BATCH = 100;
    let migrated = 0;
    let errors = 0;

    const cursor = users.find(filter);
    for await (const user of cursor) {
      const entraOid = String(user['entraOid']);
      const email = String(user['email'] ?? '');
      const linkedAt = String(user['createdAt'] ?? new Date().toISOString());

      try {
        await users.updateOne(
          { _id: user['_id'] },
          {
            $set: {
              authProviders: [
                {
                  provider: 'MICROSOFT',
                  providerId: entraOid,
                  email,
                  linkedAt,
                },
              ],
              emailVerified: true,
              updatedAt: new Date().toISOString(),
            },
          },
        );
        migrated += 1;

        if (migrated % BATCH === 0) {
          console.log(`  … migrated ${migrated}/${total}`);
        }
      } catch (err) {
        errors += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ Failed user _id=${String(user['_id'])}: ${msg}`);
      }
    }

    console.log('');
    console.log(`  ✓ Migrated: ${migrated} user(s).`);
    if (errors > 0) {
      console.log(`  ✗ Errors:   ${errors} user(s) — review logs above.`);
    }
    console.log('');

    summary(isDryRun, migrated);
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readEnv(): { uri: string; dbName: string } {
  const uri = process.env['MONGO_URI'];
  const dbName = process.env['MONGO_DB_NAME'];

  if (!uri || !dbName) {
    console.error(
      '❌ Missing MONGO_URI or MONGO_DB_NAME.\n' +
        '   Run via: pnpm --filter @inventario/api migrate:auth-providers\n' +
        '   (loads .env.local automatically)\n',
    );
    process.exit(1);
  }

  return { uri, dbName };
}

function banner(dryRun: boolean): void {
  const title = dryRun
    ? 'K9 ADR-0013 — Backfill authProviders (DRY RUN)'
    : 'K9 ADR-0013 — Backfill authProviders';
  console.log('');
  console.log('═'.repeat(title.length + 4));
  console.log(`  ${title}`);
  console.log('═'.repeat(title.length + 4));
  console.log('');
  if (dryRun) {
    console.log('🟡 Dry-run mode: no writes will be performed.');
    console.log('');
  }
}

function summary(dryRun: boolean, count: number): void {
  console.log('─'.repeat(50));
  if (dryRun) {
    console.log(`✅ Dry-run complete. ${count} user(s) would be updated.`);
    console.log('   Re-run without --dry-run to apply.');
  } else {
    console.log(`✅ Migration complete. ${count} user(s) updated.`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Verify by checking a migrated user in Atlas:');
    console.log('     db.users.findOne({ authProviders: { $size: 1 } })');
    console.log('  2. Run with --dry-run again to confirm zero candidates remain.');
  }
  console.log('');
}

function printUsage(): void {
  console.log('K9 ADR-0013 — Backfill authProviders on pre-Slice-#6 Entra ID users.');
  console.log('');
  console.log('Usage:');
  console.log('  pnpm --filter @inventario/api migrate:auth-providers [--dry-run]');
  console.log('');
  console.log('Flags:');
  console.log('  --dry-run  Show planned changes without writing anything.');
  console.log('  --help     Print this help and exit.');
  console.log('');
}
