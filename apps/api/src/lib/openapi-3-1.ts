// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Prevod pozostatkov OpenAPI 3.0 / JSON Schema draft-4 na tvar 3.1.
 *
 * Prečo to treba
 * --------------
 * Dokument deklarujeme ako `openapi: 3.1.0`, ale konverzia Zod → JSON
 * Schema zatiaľ cieli na 3.0. Redocly to hlásil ako 219 chýb `struct`
 * pravidla v dvoch rodinách:
 *
 *   1. `nullable: true` — kľúčové slovo z 3.0. V 3.1 (nadmnožina JSON
 *      Schema 2020-12) neexistuje, nullovateľnosť sa vyjadruje typom.
 *   2. `exclusiveMinimum: true` vedľa `minimum` — tvar z JSON Schema
 *      draft-4. V 2020-12 je `exclusiveMinimum` samo číslom.
 *
 * Nepíše to človek: `nullable` generuje Zod → JSON Schema konverzia
 * (`fastify-type-provider-zod`), ktorá zatiaľ cieli na 3.0. Preto sa to
 * prevádza tu, nad hotovým dokumentom, a nie ručne v schémach.
 *
 * Prevádzané tvary (všetky namerané v našom dokumente 2026-08-31):
 *
 *   { type: 'string', nullable: true }
 *     → { type: ['string', 'null'] }
 *
 *   { type: 'string', enum: [...], nullable: true }
 *     → { type: ['string', 'null'], enum: [..., null] }
 *     Bez `null` v enume by bol `default: null` nevalidný.
 *
 *   { allOf: [...], nullable: true }            (bez vlastného `type`)
 *     → { anyOf: [{ allOf: [...] }, { type: 'null' }] }
 *     Kombinátor sa nedá „ponulliť" typom, treba ho obaliť.
 *
 *   { enum: ['null'], nullable: true }
 *     → { type: 'null' }
 *     Zod `z.null()` (naše 204 odpovede) skončí ako enum s reťazcom
 *     "null", čo je nesprávne aj v 3.0 — nešlo o hodnotu null.
 *
 *   { minimum: 0, exclusiveMinimum: true }
 *     → { exclusiveMinimum: 0 }
 *     Booleovský flag bol draft-4; v 2020-12 nesie hranicu priamo.
 *     `exclusiveMinimum: false` znamená obyčajné `minimum` — flag len
 *     zmizne. To isté platí pre maximum.
 *
 * Funkcia je čistá: vracia nový dokument, vstup nemení.
 */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const COMBINATORS = ['allOf', 'anyOf', 'oneOf'] as const;

function isPlainObject(value: unknown): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Prejde dokument a prepíše pozostatky 3.0 / draft-4 na 3.1 ekvivalent.
 */
export function convertToOpenApi31<T>(input: T): T {
  return convert(input as Json) as T;
}

function convert(node: Json): Json {
  if (Array.isArray(node)) {
    return node.map(convert);
  }

  if (!isPlainObject(node)) {
    return node;
  }

  // Najprv deti, aby sa vnorené schémy previedli tiež.
  const result: Record<string, Json> = {};
  for (const [key, value] of Object.entries(node)) {
    result[key] = convert(value);
  }

  convertExclusiveBounds(result);

  if (result['nullable'] !== true) {
    return result;
  }

  delete result['nullable'];

  // z.null() → { enum: ['null'] }. Nie je to hodnota null, ale reťazec;
  // v 3.1 je na to samostatný typ.
  const enumValues = result['enum'];
  if (
    result['type'] === undefined &&
    Array.isArray(enumValues) &&
    enumValues.length === 1 &&
    enumValues[0] === 'null'
  ) {
    delete result['enum'];
    result['type'] = 'null';
    return result;
  }

  const type = result['type'];

  if (typeof type === 'string') {
    result['type'] = [type, 'null'];
    // Ak je hodnota obmedzená enumom, null tam musí byť tiež, inak
    // schéma povolí null typom a hneď ho zakáže enumom.
    if (Array.isArray(enumValues) && !enumValues.includes(null)) {
      result['enum'] = [...enumValues, null];
    }
    return result;
  }

  if (Array.isArray(type)) {
    if (!type.includes('null')) {
      result['type'] = [...type, 'null'];
    }
    return result;
  }

  // Bez vlastného typu: kombinátor alebo $ref sa obalí do anyOf.
  const hasCombinator = COMBINATORS.some((k) => k in result);
  if (hasCombinator || '$ref' in result) {
    // `description` a spol. patria obalu, nie vnorenej schéme.
    const inner: Record<string, Json> = {};
    const outer: Record<string, Json> = {};
    for (const [key, value] of Object.entries(result)) {
      if (key === '$ref' || (COMBINATORS as readonly string[]).includes(key)) {
        inner[key] = value;
      } else {
        outer[key] = value;
      }
    }
    return { ...outer, anyOf: [inner, { type: 'null' }] };
  }

  // Schéma bez typu aj bez kombinátora už null pripúšťa — stačí, že
  // `nullable` zmizlo.
  return result;
}

/**
 * `{ minimum: X, exclusiveMinimum: true }` → `{ exclusiveMinimum: X }`.
 * Mení objekt na mieste — volá sa už nad kópiou.
 */
function convertExclusiveBounds(node: Record<string, Json>): void {
  for (const [flag, bound] of [
    ['exclusiveMinimum', 'minimum'],
    ['exclusiveMaximum', 'maximum'],
  ] as const) {
    if (typeof node[flag] !== 'boolean') continue;

    const isExclusive = node[flag] === true;
    const boundValue = node[bound];
    delete node[flag];

    if (isExclusive && typeof boundValue === 'number') {
      delete node[bound];
      node[flag] = boundValue;
    }
  }
}
