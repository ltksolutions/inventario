// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Generuje JSON Schema z Zod schém pre použitie v Mongo `$jsonSchema` validátoroch.
 *
 * Spustenie:
 *   pnpm --filter @inventario/shared-types run generate:json-schema
 *
 * Výstup:
 *   packages/shared-types/generated/json-schema.json
 *
 * Tento súbor používa `apps/api` na vytvorenie `$jsonSchema` validátorov v Mongo
 * pri spustení migračného skriptu (`apps/api/scripts/setup-mongo-validators.ts`).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { zodToJsonSchema } from 'zod-to-json-schema';

import * as schemas from '../src/schemas/index.js';

import type { ZodTypeAny } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '..', 'generated', 'json-schema.json');

/**
 * Schémy, ktoré chceme exportovať do JSON Schema.
 * Kľúč = názov v Mongo collection / OpenAPI komponente.
 */
const SCHEMAS_TO_GENERATE: Record<string, ZodTypeAny> = {
  // Core entity schémy (pre Mongo $jsonSchema validátory)
  Asset: schemas.AssetSchema,
  Attachment: schemas.AttachmentSchema,
  AuditLog: schemas.AuditLogSchema,
  Category: schemas.CategorySchema,
  Loan: schemas.LoanSchema,
  LoanProtocol: schemas.LoanProtocolSchema,
  LoanRequest: schemas.LoanRequestSchema,
  Location: schemas.LocationSchema,
  Notification: schemas.NotificationSchema,
  Organisation: schemas.OrganisationSchema,
  StockMovement: schemas.StockMovementSchema,
  User: schemas.UserSchema,

  // Create/Update input schémy (pre API request validáciu — síce backend ich
  // beží cez Zod priamo, ale generovaný JSON Schema je užitočný pre OpenAPI
  // a pre frontend formuláre)
  CreateAsset: schemas.CreateAssetSchema,
  UpdateAsset: schemas.UpdateAssetSchema,
  CreateUser: schemas.CreateUserSchema,
  UpdateUser: schemas.UpdateUserSchema,
  CreateLoanRequest: schemas.CreateLoanRequestSchema,
  CreateLoan: schemas.CreateLoanSchema,
  ReturnLoan: schemas.ReturnLoanSchema,
  CreateCategory: schemas.CreateCategorySchema,
  UpdateCategory: schemas.UpdateCategorySchema,
  CreateLocation: schemas.CreateLocationSchema,
  UpdateLocation: schemas.UpdateLocationSchema,
  CreateOrganisation: schemas.CreateOrganisationSchema,
  UpdateOrganisation: schemas.UpdateOrganisationSchema,
  CreateAttachment: schemas.CreateAttachmentSchema,
  CreateAuditLog: schemas.CreateAuditLogSchema,
  CreateNotification: schemas.CreateNotificationSchema,
  CreateStockMovement: schemas.CreateStockMovementSchema,

  // Public/projektované verzie
  UserPublic: schemas.UserPublicSchema,
};

async function main(): Promise<void> {
  console.info('🔧 Generujem JSON Schema z Zod schém...');

  const output: Record<string, unknown> = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $comment: `Auto-generated from packages/shared-types/src/schemas. DO NOT EDIT MANUALLY.`,
    generatedAt: new Date().toISOString(),
    definitions: {},
  };

  const definitions = output['definitions'] as Record<string, unknown>;

  for (const [name, schema] of Object.entries(SCHEMAS_TO_GENERATE)) {
    try {
      const jsonSchema = zodToJsonSchema(schema, {
        name,
        $refStrategy: 'none', // Inline všetky referencie (Mongo $jsonSchema nepodporuje $ref)
        target: 'jsonSchema7',
      });

      definitions[name] = jsonSchema;
      console.info(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}:`, (err as Error).message);
      process.exit(1);
    }
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');

  const count = Object.keys(definitions).length;
  console.info(`\n✅ Vygenerovaných ${count} schém do ${OUTPUT_PATH}`);
}

main().catch((err: unknown) => {
  console.error('❌ Generovanie zlyhalo:', err);
  process.exit(1);
});
