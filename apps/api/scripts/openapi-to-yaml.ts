// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Konverzia `apps/api/openapi.json` → `docs/api/openapi.yaml`.
 *
 * Prečo tento skript existuje
 * ---------------------------
 * `docs/api/openapi.yaml` je to, čo lintuje Redocly v CI (`docs.yml`,
 * job `openapi`) a čo číta človek. Zdrojom pravdy je ale `openapi.json`,
 * ktorý exportuje `export-openapi.ts` z bežiacej Fastify appky.
 *
 * Konverzia medzi nimi bola doteraz ručná — hlavička YAML súboru na to
 * priamo upozorňovala („potom konverzia JSON→YAML do tohto súboru").
 * Ručný krok medzi dvomi generovanými súbormi je pozvánka k tomu, aby sa
 * rozišli: stačí raz zabudnúť a dokumentácia tvrdí niečo iné než API.
 *
 * Použitie
 * --------
 *   pnpm --filter @inventario/api openapi:export:offline   (openapi.json)
 *   pnpm --filter @inventario/api openapi:docs             (tento skript)
 *
 * Alebo oboje naraz:
 *   pnpm --filter @inventario/api openapi:sync
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stringify } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const jsonPath = resolve(here, '../openapi.json');
const yamlPath = resolve(here, '../../../docs/api/openapi.yaml');

const HEADER = `# GENEROVANÝ SÚBOR — needituj ručne.
# Zdroj pravdy: apps/api/openapi.json (export z Fastify swagger).
# Regenerácia: pnpm --filter @inventario/api openapi:sync
# SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
# SPDX-License-Identifier: EUPL-1.2

`;

const doc: unknown = JSON.parse(readFileSync(jsonPath, 'utf8'));

// lineWidth: 0 vypína zalamovanie — Prettier si potom riadky naformátuje
// sám a diff medzi dvomi generovaniami ostáva čitateľný.
const yaml = stringify(doc, { lineWidth: 0 });

writeFileSync(yamlPath, HEADER + yaml, 'utf8');

// eslint-disable-next-line no-console
console.log(`✅ ${yamlPath}`);
