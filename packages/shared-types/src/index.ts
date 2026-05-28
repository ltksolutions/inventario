/**
 * @sfz/shared-types — Single source of truth pre dátový model SFZ Asset Management.
 *
 * Tento balíček obsahuje:
 * - **Zod schémy** — runtime validácia + TypeScript typová inferencia v jednom
 * - **Enumy** — pomenované konštanty (stavy, role, kategórie)
 * - **JSON Schema generátor** — pre Mongo `$jsonSchema` validátory
 *
 * Filozofia:
 * 1. Zod schéma = zdroj pravdy
 * 2. TypeScript typy sa **iba odvodzujú** cez `z.infer<typeof X>`
 * 3. JSON Schema sa **generuje** automaticky cez `zod-to-json-schema`
 * 4. OpenAPI komponenty sa **generujú** v `apps/api` cez `zod-to-openapi`
 *
 * Príklad použitia:
 * ```ts
 * import { AssetSchema, type Asset } from '@sfz/shared-types';
 *
 * const result = AssetSchema.safeParse(input);
 * if (!result.success) {
 *   throw new ValidationError(result.error);
 * }
 * const asset: Asset = result.data;
 * ```
 */

export * from './enums/index.js';
export * from './schemas/index.js';
export * from './defaults/taxonomy-defaults.js';
