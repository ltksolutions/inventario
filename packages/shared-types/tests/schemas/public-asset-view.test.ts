// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
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
  it('obsahuje PRESNE tychto 3 polia a nic ine', () => {
    const actualKeys = Object.keys(PublicAssetViewSchema.shape).sort();
    const expectedKeys = ['foundContact', 'organisationLogoUrl', 'organisationName'].sort();
    expect(actualKeys).toEqual(expectedKeys);
  });

  it('akceptuje validny PublicAssetView s foundContact', () => {
    const result = PublicAssetViewSchema.safeParse({
      organisationName: 'Firma s.r.o.',
      organisationLogoUrl: 'https://cdn.inventario.estate/firma-logo.png',
      foundContact: {
        email: 'majetok@firma.sk',
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
      foundContact: null,
    });
    expect(result.success).toBe(true);
  });

  it('NEPREZENTUJE identitu majetku — odmietne name a inventoryNumber (ADR-0021)', () => {
    // Jadro invariantu: verejný lost&found NESMIE odhaliť názov ani inv. číslo.
    // Strict mode → akékoľvek pole identity majetku spôsobí zlyhanie validácie.
    const withName = PublicAssetViewSchema.safeParse({
      organisationName: 'Firma s.r.o.',
      organisationLogoUrl: null,
      foundContact: null,
      name: 'Lenovo ThinkPad X1',
    });
    expect(withName.success).toBe(false);

    const withInventoryNumber = PublicAssetViewSchema.safeParse({
      organisationName: 'Firma s.r.o.',
      organisationLogoUrl: null,
      foundContact: null,
      inventoryNumber: 'LT-2026-0001',
    });
    expect(withInventoryNumber.success).toBe(false);
  });

  it('odmietne extra pole (strict mode)', () => {
    const result = PublicAssetViewSchema.safeParse({
      organisationName: 'Firma s.r.o.',
      organisationLogoUrl: null,
      foundContact: null,
      // Toto pole nesmie pretiec do verejneho DTO
      internalNotes: 'TAJNE POZNAMKY',
    });
    expect(result.success).toBe(false);
  });

  it('odmietne chybajuce povinne pole', () => {
    const result = PublicAssetViewSchema.safeParse({
      organisationLogoUrl: null,
      foundContact: null,
      // chyba organisationName
    });
    expect(result.success).toBe(false);
  });
});
