// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Phase D Blok 1 — Export the live OpenAPI 3.1 spec to apps/api/openapi.json.
 *
 * Why this script exists
 * ----------------------
 * `@fastify/swagger` builds the OpenAPI document at runtime by walking
 * the registered Fastify routes and converting each route's Zod schema
 * into JSON Schema via `fastify-type-provider-zod`. The result is the
 * single source of truth for our public API contract.
 *
 * Consumers of this file:
 *
 *   1. **apps/web (Slice #4)** — auto-generates a TypeScript HTTP client
 *      from the spec (planned via `openapi-typescript` + `openapi-fetch`).
 *      Re-running this script after every API change keeps the frontend
 *      client in sync without manual type duplication.
 *
 *   2. **EU procurement / interoperability** — public-sector tenders
 *      increasingly require OpenAPI 3.1 export as a checkbox item
 *      (European Interoperability Framework, ISA² programme).
 *
 *   3. **Future integration partners** — third-party developers wanting
 *      to build on Inventario can read the spec without bootstrapping
 *      the full server.
 *
 * What it does
 * ------------
 *   1. Boots the Fastify app via `buildServer()`. This goes through the
 *      full plugin chain — including Mongo connection — because the
 *      Swagger plugin's `transform` hook references the route schemas
 *      that are registered by the domain modules.
 *   2. Awaits `app.ready()` so every plugin has finished registering
 *      and every route schema is on the swagger collector.
 *   3. Calls `app.swagger()` to materialise the OpenAPI 3.1 document.
 *   4. Writes the document to `apps/api/openapi.json` (pretty-printed,
 *      2-space indent, trailing newline so it matches Prettier output).
 *   5. Closes the server cleanly (releases Mongo connection).
 *
 * Note on env
 * -----------
 * The script reads `.env.local` via the npm-script wrapper
 * (`tsx --env-file=.env.local`). That's the same env the dev server
 * uses, so `MONGO_URI` and Entra ID variables must be set. The Mongo
 * ping during `buildServer()` takes ~3 seconds against Atlas Flex; that
 * cost is acceptable for an export script run on demand.
 *
 * `ENABLE_SWAGGER` must be `true` (the plugin no-ops otherwise). If the
 * env says `false`, this script overrides it for the duration of the
 * export. Production servers stay locked down via env vars.
 *
 * Usage
 * -----
 *   pnpm --filter @inventario/api openapi:export
 *
 * Or directly:
 *   pnpm --filter @inventario/api exec \
 *     tsx --env-file=.env.local scripts/export-openapi.ts
 *
 * Flags
 * -----
 *   --output <path>   Override the output path (default: apps/api/openapi.json).
 *   --check           Exit with non-zero if the generated spec differs from the
 *                     file on disk. Use in CI to fail when someone forgets to
 *                     regenerate after an API change.
 *   --help, -h        Print usage and exit.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildServer } from '../src/server.js';

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  printUsage();
  process.exit(0);
}

const checkMode = args.includes('--check');

const outputIndex = args.indexOf('--output');
const customOutput = outputIndex !== -1 ? args[outputIndex + 1] : undefined;

// Resolve default output path relative to this script so the command
// works regardless of the directory it's invoked from.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultOutput = path.resolve(__dirname, '..', 'openapi.json');
const outputPath = customOutput ? path.resolve(customOutput) : defaultOutput;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('\n❌ OpenAPI export failed:');
  console.error(err);
  process.exit(1);
});

async function main(): Promise<void> {
  banner();

  // Force Swagger plugin on regardless of env so the export works in
  // CI where ENABLE_SWAGGER might be false. Production servers control
  // this via real env vars; this script's process is throwaway.
  process.env['ENABLE_SWAGGER'] = 'true';

  console.log('Booting Fastify app...');
  // Use the same plugin timeout the test suite uses. Atlas Flex cold
  // TLS handshakes routinely take 5-10 seconds on the first call from
  // a fresh process, and Fastify's 10s default is too tight for that
  // window. 30s mirrors the test setup and matches Vercel's serverless
  // function ceiling.
  const app = await buildServer({ pluginTimeout: 30_000 });
  await app.ready();
  console.log('  ✓ Server ready.');
  console.log('');

  // `app.swagger()` is added by @fastify/swagger when registered. The
  // type provider returns `Record<string, unknown>`; we capture it as
  // an OpenAPI document for JSON serialisation.
  const spec = app.swagger() as unknown as Record<string, unknown>;

  // Pretty-printed with trailing newline so the file matches the
  // formatting Prettier would produce if we ran it on a JSON file.
  // This keeps `--check` mode stable across editors.
  const serialised = JSON.stringify(spec, null, 2) + '\n';

  if (checkMode) {
    await runCheck(serialised, app);
    return;
  }

  writeFileSync(outputPath, serialised, 'utf8');
  console.log(`Wrote OpenAPI 3.1 spec to:`);
  console.log(`  ${outputPath}`);
  console.log(`  (${formatBytes(Buffer.byteLength(serialised))})`);
  console.log('');

  summarise(spec);

  await app.close();
}

// ---------------------------------------------------------------------------
// --check mode
// ---------------------------------------------------------------------------

async function runCheck(
  generated: string,
  app: Awaited<ReturnType<typeof buildServer>>,
): Promise<void> {
  if (!existsSync(outputPath)) {
    console.error('❌ Check failed: openapi.json does not exist on disk.');
    console.error(`   Expected at: ${outputPath}`);
    console.error('   Run `pnpm --filter @inventario/api openapi:export` to create it.');
    await app.close();
    process.exit(1);
  }

  const onDisk = readFileSync(outputPath, 'utf8');

  if (onDisk === generated) {
    console.log('✓ openapi.json on disk matches generated spec.');
    await app.close();
    return;
  }

  console.error('❌ Check failed: openapi.json on disk is stale.');
  console.error('');
  console.error('The generated spec from the live routes does not match');
  console.error('the file checked into git. Someone made API changes');
  console.error('without re-running the export.');
  console.error('');
  console.error('To fix:');
  console.error('  pnpm --filter @inventario/api openapi:export');
  console.error('  git add apps/api/openapi.json');
  console.error('  git commit -m "chore(api): refresh openapi.json"');
  console.error('');

  // Show byte-level mismatch hint so the diff is obvious if printed in CI.
  console.error(
    `  (generated: ${Buffer.byteLength(generated)} bytes, on-disk: ${Buffer.byteLength(onDisk)} bytes)`,
  );

  await app.close();
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarise(spec: Record<string, unknown>): void {
  const info = (spec['info'] ?? {}) as Record<string, unknown>;
  const paths = (spec['paths'] ?? {}) as Record<string, Record<string, unknown>>;
  const components = (spec['components'] ?? {}) as Record<string, unknown>;
  const schemas = (components['schemas'] ?? {}) as Record<string, unknown>;

  let endpointCount = 0;
  for (const methods of Object.values(paths)) {
    for (const key of Object.keys(methods)) {
      // Only count HTTP methods, not parameters/summary/description on the path object itself.
      if (['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(key)) {
        endpointCount += 1;
      }
    }
  }

  console.log('Summary:');
  console.log(`  Title:      ${String(info['title'] ?? '(unknown)')}`);
  console.log(`  Version:    ${String(info['version'] ?? '(unknown)')}`);
  console.log(`  OpenAPI:    ${String(spec['openapi'] ?? '(unknown)')}`);
  console.log(`  Paths:      ${Object.keys(paths).length}`);
  console.log(`  Endpoints:  ${endpointCount}`);
  console.log(`  Schemas:    ${Object.keys(schemas).length}`);
  console.log('');
}

function banner(): void {
  const title = 'Phase D Blok 1 — OpenAPI 3.1 export';
  console.log('');
  console.log('═'.repeat(title.length + 4));
  console.log(`  ${title}`);
  console.log('═'.repeat(title.length + 4));
  console.log('');
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

function printUsage(): void {
  console.log('Phase D Blok 1 — Export OpenAPI 3.1 spec from live Fastify routes.');
  console.log('');
  console.log('Usage:');
  console.log('  pnpm --filter @inventario/api openapi:export [--check] [--output PATH]');
  console.log('');
  console.log('Flags:');
  console.log('  --check           Exit non-zero if openapi.json on disk is stale (for CI).');
  console.log('  --output PATH     Write to a custom path instead of apps/api/openapi.json.');
  console.log('  --help, -h        Print this help.');
  console.log('');
}
