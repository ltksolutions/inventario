// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Unit testy pre prevod `nullable: true` na OpenAPI 3.1.
 *
 * Každý test zodpovedá tvaru, ktorý sa reálne vyskytuje vo vygenerovanom
 * `openapi.json` (namerané 2026-08-31: 127× skalárny typ, 22× allOf,
 * 11× enum ['null'], 3× enum so skalárom).
 */

import { describe, expect, it } from 'vitest';

import { convertToOpenApi31 } from '../../src/lib/openapi-3-1.js';

describe('convertToOpenApi31', () => {
  it('skalárny typ dostane null do type poľa', () => {
    expect(convertToOpenApi31({ type: 'string', format: 'email', nullable: true })).toEqual({
      type: ['string', 'null'],
      format: 'email',
    });
  });

  it('enum dostane null aj do zoznamu hodnôt', () => {
    expect(
      convertToOpenApi31({
        type: 'string',
        enum: ['Inter', 'Roboto'],
        nullable: true,
        default: null,
      }),
    ).toEqual({
      type: ['string', 'null'],
      enum: ['Inter', 'Roboto', null],
      default: null,
    });
  });

  it('enum, ktorý už null obsahuje, sa needuplikuje', () => {
    const out = convertToOpenApi31({ type: 'string', enum: ['a', null], nullable: true });
    expect(out).toEqual({ type: ['string', 'null'], enum: ['a', null] });
  });

  it('z.null() (enum s reťazcom "null") sa prevedie na type null', () => {
    expect(
      convertToOpenApi31({ description: 'MFA reset', enum: ['null'], nullable: true }),
    ).toEqual({ description: 'MFA reset', type: 'null' });
  });

  it('allOf bez vlastného typu sa obalí do anyOf', () => {
    expect(
      convertToOpenApi31({
        allOf: [{ type: 'string' }, { type: 'string', pattern: '^SK\\d{10}$' }],
        nullable: true,
        default: null,
      }),
    ).toEqual({
      default: null,
      anyOf: [
        { allOf: [{ type: 'string' }, { type: 'string', pattern: '^SK\\d{10}$' }] },
        { type: 'null' },
      ],
    });
  });

  it('$ref sa obalí do anyOf, popis ostane na obale', () => {
    expect(
      convertToOpenApi31({
        $ref: '#/components/schemas/Asset',
        description: 'Majetok',
        nullable: true,
      }),
    ).toEqual({
      description: 'Majetok',
      anyOf: [{ $ref: '#/components/schemas/Asset' }, { type: 'null' }],
    });
  });

  it('type už ako pole sa doplní o null bez duplicity', () => {
    expect(convertToOpenApi31({ type: ['string', 'number'], nullable: true })).toEqual({
      type: ['string', 'number', 'null'],
    });
    expect(convertToOpenApi31({ type: ['string', 'null'], nullable: true })).toEqual({
      type: ['string', 'null'],
    });
  });

  it('vnorené schémy sa prevedú tiež', () => {
    expect(
      convertToOpenApi31({
        type: 'object',
        nullable: true,
        properties: {
          ico: { type: 'string', nullable: true },
          items: { type: 'array', items: { type: 'integer', nullable: true } },
        },
      }),
    ).toEqual({
      type: ['object', 'null'],
      properties: {
        ico: { type: ['string', 'null'] },
        items: { type: 'array', items: { type: ['integer', 'null'] } },
      },
    });
  });

  it('schéma bez typu a bez kombinátora len stratí nullable', () => {
    expect(convertToOpenApi31({ description: 'čokoľvek', nullable: true })).toEqual({
      description: 'čokoľvek',
    });
  });

  it('nullable: false sa nedotýka', () => {
    expect(convertToOpenApi31({ type: 'string', nullable: false })).toEqual({
      type: 'string',
      nullable: false,
    });
  });

  it('vstup sa nemení (funkcia je čistá)', () => {
    const input = { type: 'string', nullable: true };
    const copy = structuredClone(input);
    convertToOpenApi31(input);
    expect(input).toEqual(copy);
  });

  it('exclusiveMinimum: true prenesie hranicu z minimum', () => {
    expect(
      convertToOpenApi31({ type: 'integer', exclusiveMinimum: true, minimum: 0, maximum: 3650 }),
    ).toEqual({ type: 'integer', exclusiveMinimum: 0, maximum: 3650 });
  });

  it('exclusiveMaximum funguje rovnako', () => {
    expect(convertToOpenApi31({ type: 'number', exclusiveMaximum: true, maximum: 100 })).toEqual({
      type: 'number',
      exclusiveMaximum: 100,
    });
  });

  it('exclusiveMinimum: false znamená obyčajné minimum — zmizne len flag', () => {
    expect(convertToOpenApi31({ type: 'integer', exclusiveMinimum: false, minimum: 5 })).toEqual({
      type: 'integer',
      minimum: 5,
    });
  });

  it('exclusiveMinimum, ktoré je už číslo, sa nedotýka', () => {
    expect(convertToOpenApi31({ type: 'integer', exclusiveMinimum: 0 })).toEqual({
      type: 'integer',
      exclusiveMinimum: 0,
    });
  });

  it('po prevode nikde nezostane nullable', () => {
    const doc = {
      paths: {
        '/a': { get: { responses: { 200: { schema: { type: 'string', nullable: true } } } } },
        '/b': { post: { schema: { allOf: [{ type: 'object' }], nullable: true } } },
      },
    };
    expect(JSON.stringify(convertToOpenApi31(doc))).not.toContain('nullable');
  });
});
