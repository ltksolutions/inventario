// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-06-05b-location-type-enum-expand
 *
 * Rozširuje LocationType enum o dve nové hodnoty: HEADQUARTERS a BRANCH.
 *
 * Existujúce dokumenty v kolekcii `locations` sú stále valídne —
 * enum rozšírenie je spätne kompatibilné (pridáva hodnoty, nič neodstraňuje).
 *
 * Migrácia je teda no-op z hľadiska DB dát — jej účel je len zaznamenať
 * do `migrations` kolekcie že zmena bola nasadená, a tým zabrániť
 * opätovnému spusteniu pri reštarte.
 *
 * Poznámka: Zod schéma v `locations.routes.ts` používa `LOCATION_TYPE_VALUES`
 * z `@inventario/shared-types`, takže po rebuild shared-types API automaticky
 * akceptuje HEADQUARTERS a BRANCH bez ďalších zmien.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

export async function migrate_2026_06_05b_location_type_enum_expand(
  _db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  logger.info(
    'location-type-enum-expand: HEADQUARTERS + BRANCH added to LocationType enum — no DB changes needed.',
  );
}
