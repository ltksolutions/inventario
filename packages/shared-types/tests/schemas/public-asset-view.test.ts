// SPDX-FileCopyrightText: 2026 Jan Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * K6 — snapshot test pre PublicAssetViewSchema (ADR-0021).
 *
 * KRITICKY INVARIANT: schema musi mat PRESNE tieto kluce a ziadne ine.
 * Keby sa pridalo pole na AssetSchema a omylom by sa dostalo sem cez
 * Pick/Omit/spread, tento test by to zachytil okamzite.
 *
 * Tento test NIE JE o "co prezentujeme" — je o "co NESMIEME prezentovat".
 */

import { describe, expect, it } from 'vitest';

import { PublicAssetViewSchema } from '../../src/schemas/asset.js';

describe('PublicAssetViewSchema — whitelist invariant (ADR-0021 K6)', () => {
  it('obsahuje PRESNE tychto 5 poli a nic ine', () => {
    const actualKeys = Object.keys(PublicAssetViewSchema.shape).sort();
    const expectedKeys = [
      'foundContact',
      'inventoryNumber',
      'name',
      'organisationLogoUrl',
      'organisationName',
    ].sort();
    expect(actualKeys).toEqual(expectedKeys);
  });

  it('akceptuje validny PublicAssetView s foundContact', () => {
    const result = PublicAssetViewSchema.safeParse({
      organisationName: 'SFZ',
      organisationLogoUrl: 'https://cdn.inventario.estate/sfz-logo.png',
      inventoryNumber: 'LT-2026-0001',
      name: 'Lenovo ThinkPad X1',
      foundContact: {
        email: 'majetok@futbalsfz.sk',
        phone: '+421900000000',
        message: 'Kontaktujte nas na vrátenie',
      },
    });
    expect(result.success).toBe(true);
  });

  it('akceptuje null foundContact a null logoUrl', () => {
    const result = PublicAssetViewSchema.safeParse({
      organisationName: 'Test Org',
      organisationLogoUrl: null,
      inventoryNumber: 'TEST-001',
      name: 'Test Asset',
      foundContact: null,
    });
    expect(result.success).toBe(true);
  });

  it('odmietne extra pole (strict mode)', () => {
    const result = PublicAssetViewSchema.safeParse({
      organisationName: 'SFZ',
      organisationLogoUrl: null,
      inventoryNumber: 'LT-001',
      name: 'Laptop',
      foundContact: null,
      // Toto pole nesmie pretiec do verejneho DTO
      internalNotes: 'TAJNE POZNAMKY',
    });
    expect(result.success).toBe(false);
  });

  it('odmietne chybajuce povinne pole', () => {
    const result = PublicAssetViewSchema.safeParse({
      organisationLogoUrl: null,
      inventoryNumber: 'LT-001',
      name: 'Laptop',
      foundContact: null,
      // chyba organisationName
    });
    expect(result.success).toBe(false);
  });
});
