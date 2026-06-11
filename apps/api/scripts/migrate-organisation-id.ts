// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Phase C Blok 4 migration — backfill organisationId on pre-Blok-3 data.
 *
 * Why this script exists
 * ----------------------
 * Phase C Blok 1 added the `organisationId` field to every tenant-scoped
 * collection (users, assets, categories, locations, audit_logs). Until
 * Blok 3 landed, JIT user provisioning wrote the placeholder
 * `PENDING_TENANT_ID` (`'000000000000000000000000'`) into newly created
 * rows because there was no tenant resolution flow yet.
 *
 * Blok 3 replaced that placeholder path with real tenant resolution
 * from the JWT `tid` claim. New rows from now on get a real tenant id.
 * But existing rows from slice #2 to slice #3 deployments still carry
 * the placeholder.
 *
 * This script:
 *
 *   1. Creates (or reuses) a default `Inventario` tenant document.
 *   2. Backfills every row in every tenant-scoped collection whose
 *      `organisationId` equals the placeholder, pointing them at the
 *      default tenant's real `_id`.
 *   3. Drops legacy single-field unique indexes that should now be
 *      composite per-tenant (`{slug:1}`, `{email:1}`, `{inventoryNumber:1}`).
 *      The new composite indexes are recreated automatically by each
 *      repository's `ensureIndexes()` call on next server boot.
 *
 * Idempotent
 * ----------
 * Running the script a second time is a no-op:
 *   - Tenant lookup finds the existing Inventario row, skips creation.
 *   - Backfill `updateMany` matches zero documents (none left with
 *     the placeholder).
 *   - Index drop only acts on names that still exist.
 *
 * Dry-run
 * -------
 * Pass `--dry-run` to print what would change without writing
 * anything. Safe to run against production before the real migration
 * to confirm scope.
 *
 * Usage
 * -----
 *   pnpm --filter @inventario/api migrate:organisation-id [--dry-run]
 *
 * Or directly:
 *   pnpm --filter @inventario/api exec \
 *     tsx --env-file=.env.local scripts/migrate-organisation-id.ts \
 *     [--dry-run]
 *
 * Environment
 * -----------
 * Reads `MONGO_URI` + `MONGO_DB_NAME` from the environment (or from
 * `.env.local` when invoked via the npm script). The script
 * deliberately does NOT go through the Fastify plugin chain — it is a
 * standalone admin tool that talks to MongoDB directly with no
 * authentication, no request lifecycle, and no audit log writes
 * (the operator running the migration is the audit trail).
 */

import { MongoClient, ObjectId, type Db } from 'mongodb';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Placeholder id written by JIT user provisioning before Blok 3.
 * Duplicated here (rather than imported from `src/lib/`) so the script
 * has zero compile-time dependency on the api source tree. Important
 * if the source tree's exports change later — the migration script
 * should remain runnable against historical data.
 */
const PENDING_TENANT_ID = '000000000000000000000000';

/**
 * Stable slug for the default tenant. Matches the auto-generated slug
 * format used by Blok 3 JIT provisioning (lowercase alphanumeric, no
 * hyphens). Short and human-readable since this is the platform owner
 * tenant, not an auto-provisioned one.
 */
const DEFAULT_TENANT_SLUG = 'inventario';

/**
 * Display name shown in the admin UI for the default tenant.
 */
const DEFAULT_TENANT_DISPLAY_NAME = 'Inventario';

/**
 * Collections that carry `organisationId` and need backfilling.
 *
 * Order matters for log readability only — backfill is independent
 * per collection.
 */
const TENANT_SCOPED_COLLECTIONS = [
  'users',
  'assets',
  'categories',
  'locations',
  'audit_logs',
] as const;

type TenantScopedCollection = (typeof TENANT_SCOPED_COLLECTIONS)[number];

/**
 * Legacy single-field unique indexes that should be replaced with
 * composite `{organisationId: 1, X: 1}` ones. The repositories'
 * `ensureIndexes()` calls create the new composite indexes on next
 * server boot; this script's job is to drop the obsolete ones so the
 * collection metadata is clean.
 *
 * Index NAMES are the auto-generated ones from MongoDB when the
 * collection was created via `createIndex({foo: 1}, {unique: true})`
 * — that produces `foo_1`. The newer repositories use named indexes
 * (`slug_unique`, `inventoryNumber_unique`, ...) so we drop both
 * variants to cover collections created at different points in
 * history.
 */
const LEGACY_INDEXES: Record<TenantScopedCollection, string[]> = {
  users: ['email_1', 'email_unique', 'isActive_1_deletedAt_1', 'isActive_deletedAt'],
  assets: ['inventoryNumber_1', 'inventoryNumber_unique'],
  categories: ['slug_1', 'slug_unique'],
  locations: ['slug_1', 'slug_unique'],
  audit_logs: [],
};

/**
 * Legacy indexes on the `organisations` root collection. These are not
 * tenant-scoped (Organisation sits above tenancy) but the sparse-vs-
 * partial fix from Phase C Blok 5 needs the old `*_unique_sparse`
 * indexes dropped before the partial-filter replacements can be
 * created on the next server boot.
 */
const LEGACY_ORGANISATION_INDEXES: string[] = [
  'entraTenantId_unique_sparse',
  'customDomain_unique_sparse',
];

// ---------------------------------------------------------------------------
// CLI argument parsing
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

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10_000,
  });

  try {
    await client.connect();
    const db = client.db(dbName);

    console.log(`Connected to MongoDB.`);
    console.log(`  Database: ${dbName}`);
    console.log('');

    // Step 1: ensure default tenant exists
    const tenant = await ensureDefaultTenant(db, isDryRun);

    // Step 2: backfill organisationId on every tenant-scoped collection
    await backfillAll(db, tenant.organisationIdString, isDryRun);

    // Step 3: drop legacy single-field unique indexes
    await dropLegacyIndexes(db, isDryRun);

    summary(isDryRun);
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// Step 1: default tenant
// ---------------------------------------------------------------------------

interface DefaultTenant {
  /** Real Mongo ObjectId of the Inventario tenant row. */
  organisationId: ObjectId;
  /** Same id as a 24-hex string, the form stored in other collections. */
  organisationIdString: string;
  /** True if this run inserted the row; false if it already existed. */
  created: boolean;
}

async function ensureDefaultTenant(db: Db, dryRun: boolean): Promise<DefaultTenant> {
  console.log('Step 1: Default tenant');

  const organisations = db.collection('organisations');
  const existing = await organisations.findOne({ slug: DEFAULT_TENANT_SLUG });

  if (existing) {
    console.log(`  ✓ Default tenant "${DEFAULT_TENANT_SLUG}" already exists.`);
    console.log(`    _id: ${String(existing['_id'])}`);
    console.log('');
    return {
      organisationId: existing['_id'] as ObjectId,
      organisationIdString: String(existing['_id']),
      created: false,
    };
  }

  const now = new Date().toISOString();
  const doc = {
    displayName: DEFAULT_TENANT_DISPLAY_NAME,
    slug: DEFAULT_TENANT_SLUG,
    entraTenantId: null,
    customDomain: null,
    status: 'ACTIVE' as const,
    plan: 'FREE' as const,
    primaryContactEmail: null,
    brandKit: null,
    settings: {},
    createdAt: now,
    updatedAt: now,
    createdBy: 'SYSTEM' as const,
    updatedBy: 'SYSTEM' as const,
    deletedAt: null,
    deletedBy: null,
  };

  if (dryRun) {
    console.log(`  [DRY-RUN] Would create default tenant:`);
    console.log(`    slug: ${doc.slug}`);
    console.log(`    displayName: ${doc.displayName}`);
    console.log(`    status: ${doc.status}, plan: ${doc.plan}`);
    console.log('');
    // Return a stable placeholder id so the rest of the dry-run can
    // describe the backfill it would do. The id is unused outside the
    // log messages because no writes happen in dry-run mode.
    const placeholderId = new ObjectId();
    return {
      organisationId: placeholderId,
      organisationIdString: placeholderId.toString(),
      created: true,
    };
  }

  const result = await organisations.insertOne(doc);
  const newId = result.insertedId;
  console.log(`  ✓ Created default tenant "${DEFAULT_TENANT_SLUG}".`);
  console.log(`    _id: ${String(newId)}`);
  console.log('');

  return {
    organisationId: newId,
    organisationIdString: String(newId),
    created: true,
  };
}

// ---------------------------------------------------------------------------
// Step 2: backfill
// ---------------------------------------------------------------------------

async function backfillAll(db: Db, realOrganisationId: string, dryRun: boolean): Promise<void> {
  console.log('Step 2: Backfill organisationId on tenant-scoped collections');

  let totalMatched = 0;
  let totalUpdated = 0;

  for (const collectionName of TENANT_SCOPED_COLLECTIONS) {
    const result = await backfillCollection(db, collectionName, realOrganisationId, dryRun);
    totalMatched += result.matched;
    totalUpdated += result.updated;
  }

  console.log('');
  if (dryRun) {
    console.log(`  Summary: ${totalMatched} document(s) would be updated.`);
  } else {
    console.log(`  Summary: ${totalUpdated} document(s) updated.`);
  }
  console.log('');
}

async function backfillCollection(
  db: Db,
  collectionName: TenantScopedCollection,
  realOrganisationId: string,
  dryRun: boolean,
): Promise<{ matched: number; updated: number }> {
  const collection = db.collection(collectionName);

  const filter = { organisationId: PENDING_TENANT_ID };
  const matched = await collection.countDocuments(filter);

  if (matched === 0) {
    console.log(`  ✓ ${collectionName}: no placeholder rows (already migrated).`);
    return { matched: 0, updated: 0 };
  }

  if (dryRun) {
    console.log(
      `  [DRY-RUN] ${collectionName}: would update ${matched} row(s) ` +
        `(organisationId "${PENDING_TENANT_ID}" → "${realOrganisationId}").`,
    );
    return { matched, updated: 0 };
  }

  const result = await collection.updateMany(filter, {
    $set: { organisationId: realOrganisationId },
  });

  console.log(`  ✓ ${collectionName}: updated ${result.modifiedCount} of ${matched} row(s).`);

  return { matched, updated: result.modifiedCount };
}

// ---------------------------------------------------------------------------
// Step 3: drop legacy indexes
// ---------------------------------------------------------------------------

async function dropLegacyIndexes(db: Db, dryRun: boolean): Promise<void> {
  console.log('Step 3: Drop legacy single-field indexes');

  let totalDropped = 0;
  let totalSkipped = 0;

  for (const collectionName of TENANT_SCOPED_COLLECTIONS) {
    const result = await dropLegacyIndexesForCollection(db, collectionName, dryRun);
    totalDropped += result.dropped;
    totalSkipped += result.skipped;
  }

  // Also drop the obsolete `*_unique_sparse` indexes on the root
  // `organisations` collection. They are replaced by partial-filter
  // equivalents that the repository's ensureIndexes() will recreate
  // on the next server boot. Critical because the old sparse index
  // treated `null` values as participating, which made two LOCAL
  // tenants collide on `customDomain: null`.
  const orgsResult = await dropLegacyOrganisationIndexes(db, dryRun);
  totalDropped += orgsResult.dropped;
  totalSkipped += orgsResult.skipped;

  console.log('');
  if (dryRun) {
    console.log(`  Summary: ${totalDropped} legacy index(es) would be dropped.`);
  } else {
    console.log(
      `  Summary: ${totalDropped} legacy index(es) dropped, ${totalSkipped} skipped (not present).`,
    );
  }
  console.log('');
}

async function dropLegacyOrganisationIndexes(
  db: Db,
  dryRun: boolean,
): Promise<{ dropped: number; skipped: number }> {
  const collection = db.collection('organisations');

  const existingIndexes = await collection.indexes();
  const existingNames = new Set<string>(
    existingIndexes
      .map((idx) => (typeof idx['name'] === 'string' ? idx['name'] : null))
      .filter((name): name is string => name !== null),
  );

  let dropped = 0;
  let skipped = 0;

  for (const indexName of LEGACY_ORGANISATION_INDEXES) {
    if (!existingNames.has(indexName)) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`  [DRY-RUN] organisations: would drop "${indexName}".`);
      dropped += 1;
      continue;
    }

    try {
      await collection.dropIndex(indexName);
      console.log(`  ✓ organisations: dropped "${indexName}".`);
      dropped += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `  ! organisations: drop of "${indexName}" failed (${message}). ` +
          'This is OK if another process already removed it.',
      );
      skipped += 1;
    }
  }

  return { dropped, skipped };
}

async function dropLegacyIndexesForCollection(
  db: Db,
  collectionName: TenantScopedCollection,
  dryRun: boolean,
): Promise<{ dropped: number; skipped: number }> {
  const collection = db.collection(collectionName);
  const legacyNames = LEGACY_INDEXES[collectionName];

  if (legacyNames.length === 0) {
    return { dropped: 0, skipped: 0 };
  }

  // List existing indexes once to avoid catching "index not found"
  // errors for each name in a loop. Index names are unique per
  // collection so a set lookup is sufficient.
  const existingIndexes = await collection.indexes();
  const existingNames = new Set<string>(
    existingIndexes
      .map((idx) => (typeof idx['name'] === 'string' ? idx['name'] : null))
      .filter((name): name is string => name !== null),
  );

  let dropped = 0;
  let skipped = 0;

  for (const indexName of legacyNames) {
    if (!existingNames.has(indexName)) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`  [DRY-RUN] ${collectionName}: would drop "${indexName}".`);
      dropped += 1;
      continue;
    }

    try {
      await collection.dropIndex(indexName);
      console.log(`  ✓ ${collectionName}: dropped "${indexName}".`);
      dropped += 1;
    } catch (err) {
      // Race condition: another process dropped the same index between
      // our existence check and our drop call. Tolerate it.
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `  ! ${collectionName}: drop of "${indexName}" failed (${message}). ` +
          'This is OK if another process already removed it.',
      );
      skipped += 1;
    }
  }

  return { dropped, skipped };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readEnv(): { uri: string; dbName: string } {
  const uri = process.env['MONGO_URI'];
  const dbName = process.env['MONGO_DB_NAME'];

  if (!uri || !dbName) {
    console.error(
      '❌ Missing MONGO_URI or MONGO_DB_NAME env vars.\n' +
        '   Run via: pnpm --filter @inventario/api migrate:organisation-id\n' +
        '   That loads .env.local automatically.\n',
    );
    process.exit(1);
  }

  return { uri, dbName };
}

function banner(dryRun: boolean): void {
  const title = dryRun ? 'Phase C Blok 4 — Migration (DRY RUN)' : 'Phase C Blok 4 — Migration';
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

function summary(dryRun: boolean): void {
  console.log('─'.repeat(50));
  if (dryRun) {
    console.log('✅ Dry-run complete. Re-run without --dry-run to apply.');
  } else {
    console.log('✅ Migration complete.');
    console.log('');
    console.log('Next steps:');
    console.log(
      '  1. Boot the API (`pnpm --filter @inventario/api dev`). The ' +
        'ensureIndexes() calls in each repository will recreate the ' +
        'new composite per-tenant indexes.',
    );
    console.log(
      '  2. Run `pnpm --filter @inventario/api migrate:organisation-id` ' +
        'a second time to confirm idempotency (should report zero rows ' +
        'to migrate).',
    );
  }
  console.log('');
}

function printUsage(): void {
  console.log('Phase C Blok 4 — backfill organisationId on pre-Blok-3 data.');
  console.log('');
  console.log('Usage:');
  console.log('  pnpm --filter @inventario/api migrate:organisation-id [--dry-run]');
  console.log('');
  console.log('Flags:');
  console.log('  --dry-run  Show planned changes without writing anything.');
  console.log('  --help     Print this help and exit.');
  console.log('');
}
