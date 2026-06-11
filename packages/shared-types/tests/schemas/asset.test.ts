// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { describe, expect, it } from 'vitest';

import { AssetStatus } from '../../src/enums/asset-status.js';
import { AssetCondition } from '../../src/enums/asset-type.js';
import { TrackingMode } from '../../src/enums/tracking-mode.js';
import {
  AssetSchema,
  CreateAssetSchema,
  ITSpecsSchema,
  UpdateAssetSchema,
} from '../../src/schemas/asset.js';

const validAssetInput = {
  _id: '507f1f77bcf86cd799439011',
  organisationId: '507f1f77bcf86cd799439020',
  createdAt: '2024-03-18T08:00:00.000Z',
  updatedAt: '2024-03-18T08:00:00.000Z',
  createdBy: 'SYSTEM' as const,
  updatedBy: 'SYSTEM' as const,
  deletedAt: null,
  deletedBy: null,
  inventoryNumber: 'LT-2024-008',
  publicToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  serialNumber: 'PN-ABC123',
  name: 'Lenovo ThinkPad X1 Carbon Gen 11',
  description: null,
  categoryId: '507f1f77bcf86cd799439012',
  status: AssetStatus.AVAILABLE,
  condition: AssetCondition.EXCELLENT,
  locationId: '507f1f77bcf86cd799439013',
  currentLoanId: null,
  manufacturer: 'Lenovo',
  model: 'X1 Carbon Gen 11',
  acquiredAt: '2024-01-15T00:00:00.000Z',
  acquisitionCost: 2199.99,
  warrantyUntil: '2027-01-15T00:00:00.000Z',
  specs: { cpu: 'Intel i7-1365U', ramGb: 32 },
  tags: ['laptop', 'pracovný'],
  imageIds: [],
  internalNotes: null,
  isLoanable: true,
  requiresApproval: true,
};

describe('AssetSchema', () => {
  it('akceptuje validný asset', () => {
    const result = AssetSchema.safeParse(validAssetInput);
    expect(result.success).toBe(true);
  });

  it('odmieta inventárne číslo bez prefixu', () => {
    const result = AssetSchema.safeParse({
      ...validAssetInput,
      inventoryNumber: '2024-008',
    });
    expect(result.success).toBe(false);
  });

  it('odmieta inventárne číslo s malými písmenami', () => {
    const result = AssetSchema.safeParse({
      ...validAssetInput,
      inventoryNumber: 'lt-2024-008',
    });
    expect(result.success).toBe(false);
  });

  it('odmieta zápornú acquisitionCost', () => {
    const result = AssetSchema.safeParse({
      ...validAssetInput,
      acquisitionCost: -100,
    });
    expect(result.success).toBe(false);
  });

  it('akceptuje acquisitionCost = 0 (napr. darované)', () => {
    const result = AssetSchema.safeParse({
      ...validAssetInput,
      acquisitionCost: 0,
    });
    expect(result.success).toBe(true);
  });

  it('akceptuje prázdne specs', () => {
    const result = AssetSchema.safeParse({
      ...validAssetInput,
      specs: {},
    });
    expect(result.success).toBe(true);
  });

  it('odmieta tag dlhší ako 50 znakov', () => {
    const result = AssetSchema.safeParse({
      ...validAssetInput,
      tags: ['a'.repeat(51)],
    });
    expect(result.success).toBe(false);
  });
});

describe('AssetSchema — tracking mode (ADR-0020)', () => {
  it('default trackingMode je SERIALIZED a quantityOnHand je null', () => {
    const result = AssetSchema.safeParse(validAssetInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.trackingMode).toBe(TrackingMode.SERIALIZED);
      expect(result.data.quantityOnHand).toBeNull();
    }
  });

  it('akceptuje BULK položku s quantityOnHand', () => {
    const result = AssetSchema.safeParse({
      ...validAssetInput,
      trackingMode: TrackingMode.BULK,
      quantityOnHand: 30,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.trackingMode).toBe(TrackingMode.BULK);
      expect(result.data.quantityOnHand).toBe(30);
    }
  });

  it('odmieta záporné quantityOnHand', () => {
    const result = AssetSchema.safeParse({
      ...validAssetInput,
      trackingMode: TrackingMode.BULK,
      quantityOnHand: -5,
    });
    expect(result.success).toBe(false);
  });

  it('odmieta nedefinovaný trackingMode režim', () => {
    const result = AssetSchema.safeParse({
      ...validAssetInput,
      trackingMode: 'CONSUMABLE',
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateAssetSchema', () => {
  it('vyžaduje status = AVAILABLE pri vytvorení', () => {
    const input = {
      inventoryNumber: 'LT-2024-009',
      name: 'Test',
      categoryId: '507f1f77bcf86cd799439012',
      condition: AssetCondition.NEW,
      locationId: '507f1f77bcf86cd799439013',
      acquiredAt: '2024-03-18T00:00:00.000Z',
    };

    const result = CreateAssetSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(AssetStatus.AVAILABLE);
    }
  });

  it('odmieta vytvorenie s iným ako AVAILABLE statusom', () => {
    const result = CreateAssetSchema.safeParse({
      inventoryNumber: 'LT-2024-009',
      name: 'Test',
      categoryId: '507f1f77bcf86cd799439012',
      status: AssetStatus.BORROWED,
      condition: AssetCondition.NEW,
      locationId: '507f1f77bcf86cd799439013',
      acquiredAt: '2024-03-18T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('default trackingMode SERIALIZED a quantityOnHand nie je súčasťou create vstupu', () => {
    const result = CreateAssetSchema.safeParse({
      inventoryNumber: 'LT-2024-009',
      name: 'Test',
      categoryId: '507f1f77bcf86cd799439012',
      condition: AssetCondition.NEW,
      locationId: '507f1f77bcf86cd799439013',
      acquiredAt: '2024-03-18T00:00:00.000Z',
      // quantityOnHand je server-controlled — ak ho klient pošle, ignoruje sa
      quantityOnHand: 99,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.trackingMode).toBe(TrackingMode.SERIALIZED);
      expect('quantityOnHand' in result.data).toBe(false);
    }
  });
});

describe('UpdateAssetSchema — immutable polia (ADR-0020)', () => {
  it('akceptuje update bežného poľa', () => {
    const result = UpdateAssetSchema.safeParse({ name: 'Nový názov' });
    expect(result.success).toBe(true);
  });

  it('ignoruje pokus zmeniť trackingMode a quantityOnHand cez PATCH', () => {
    const result = UpdateAssetSchema.safeParse({
      name: 'X',
      trackingMode: TrackingMode.BULK,
      quantityOnHand: 50,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('trackingMode' in result.data).toBe(false);
      expect('quantityOnHand' in result.data).toBe(false);
    }
  });
});

describe('ITSpecsSchema', () => {
  it('akceptuje validnú MAC adresu s dvojbodkami', () => {
    const result = ITSpecsSchema.safeParse({ macAddress: 'AA:BB:CC:DD:EE:FF' });
    expect(result.success).toBe(true);
  });

  it('akceptuje validnú MAC adresu s pomlčkami', () => {
    const result = ITSpecsSchema.safeParse({ macAddress: 'AA-BB-CC-DD-EE-FF' });
    expect(result.success).toBe(true);
  });

  it('odmieta nesprávnu MAC', () => {
    const result = ITSpecsSchema.safeParse({ macAddress: 'AA:BB:CC:DD:EE' });
    expect(result.success).toBe(false);
  });

  it('akceptuje validné 15-miestne IMEI', () => {
    const result = ITSpecsSchema.safeParse({ imei: '353247104467777' });
    expect(result.success).toBe(true);
  });

  it('odmieta IMEI s nepárnym počtom číslic', () => {
    const result = ITSpecsSchema.safeParse({ imei: '35324710446777' });
    expect(result.success).toBe(false);
  });

  it('akceptuje prázdny objekt (všetky polia voliteľné)', () => {
    const result = ITSpecsSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
