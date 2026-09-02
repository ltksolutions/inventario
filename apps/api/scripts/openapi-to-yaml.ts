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
 * A presne to sa 2026-09-02 stalo. YAML zaostal o dva endpointy a Redocly
 * chybu `security-defined` neohlásil, lebo lintoval starý dokument. Odvtedy
 * to stráži `--check` (nižšie) a pre-commit hook, ktorý YAML dogeneruje.
 *
 * Použitie
 * --------
 *   pnpm --filter @inventario/api openapi:export:offline   (openapi.json)
 *   pnpm --filter @inventario/api openapi:docs             (tento skript)
 *
 * Alebo oboje naraz:
 *   pnpm --filter @inventario/api openapi:sync
 *
 * Prepínače
 * ---------
 *   --check   Nezapisuje. Skončí nenulovo, ak YAML na disku nezodpovedá
 *             tomu, čo by sa z aktuálneho `openapi.json` vygenerovalo.
 *             Používa to CI (`ci.yml`, job `OpenAPI Spec Freshness`).
 *
 * Prečo tu beží Prettier
 * ----------------------
 * `yaml.stringify` a Prettier sa nezhodnú na úvodzovkách — Prettier napríklad
 * prepíše `"…user's…"` na `'…user''s…'`. Keďže YAML potom prechádza cez
 * lint-staged, súbor v gite by sa od surového výstupu generátora vždy líšil
 * o pár znakov a `--check` by hlásil zastaranosť aj tesne po regenerácii.
 * Preto formátujeme priamo tu: to, čo skript zapíše, je už finálny tvar
 * a porovnanie bajt po bajte má zmysel.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';
import { stringify } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const jsonPath = resolve(here, '../openapi.json');
const yamlPath = resolve(here, '../../../docs/api/openapi.yaml');

const checkMode = process.argv.slice(2).includes('--check');

const HEADER = `# GENEROVANÝ SÚBOR — needituj ručne.
# Zdroj pravdy: apps/api/openapi.json (export z Fastify swagger).
# Regenerácia: pnpm --filter @inventario/api openapi:sync
# SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
# SPDX-License-Identifier: EUPL-1.2

`;

const doc: unknown = JSON.parse(readFileSync(jsonPath, 'utf8'));

// lineWidth: 0 vypína zalamovanie — Prettier si potom riadky naformátuje
// sám a diff medzi dvoma generovaniami ostáva čitateľný.
const yaml = stringify(doc, { lineWidth: 0 });

const prettierConfig = await resolveConfig(yamlPath);
const generated = await format(HEADER + yaml, {
  ...prettierConfig,
  filepath: yamlPath,
  parser: 'yaml',
});

if (checkMode) {
  runCheck(generated);
} else {
  writeFileSync(yamlPath, generated, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`✅ ${yamlPath}`);
}

// ---------------------------------------------------------------------------
// --check mode
// ---------------------------------------------------------------------------

function runCheck(expected: string): void {
  /* eslint-disable no-console */
  if (!existsSync(yamlPath)) {
    console.error('❌ Check failed: docs/api/openapi.yaml neexistuje.');
    console.error(`   Očakávaný na: ${yamlPath}`);
    console.error('   Spusti `pnpm --filter @inventario/api openapi:docs`.');
    process.exit(1);
  }

  const onDisk = readFileSync(yamlPath, 'utf8');

  if (onDisk === expected) {
    console.log('✓ docs/api/openapi.yaml zodpovedá openapi.json.');
    return;
  }

  console.error('❌ Check failed: docs/api/openapi.yaml je zastaraný.');
  console.error('');
  console.error('YAML v gite nezodpovedá tomu, čo sa z openapi.json vygeneruje.');
  console.error('Redocly v CI lintuje práve tento YAML, takže zelený lint by');
  console.error('nehovoril nič o skutočnom stave API.');
  console.error('');
  console.error('Oprava:');
  console.error('  pnpm --filter @inventario/api openapi:sync');
  console.error('  git add apps/api/openapi.json docs/api/openapi.yaml');
  console.error('');
  console.error(`  na disku:      ${onDisk.length} znakov`);
  console.error(`  vygenerované:  ${expected.length} znakov`);
  console.error('');

  process.exit(1);
  /* eslint-enable no-console */
}
