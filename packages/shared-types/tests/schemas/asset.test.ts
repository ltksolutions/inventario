import { describe, expect, it } from 'vitest';

import { AssetStatus } from '../../src/enums/asset-status.js';
import { AssetCondition, AssetType } from '../../src/enums/asset-type.js';
import { AssetSchema, CreateAssetSchema, ITSpecsSchema } from '../../src/schemas/asset.js';

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
  serialNumber: 'PN-ABC123',
  name: 'Lenovo ThinkPad X1 Carbon Gen 11',
  description: null,
  type: AssetType.IT,
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

  it('akceptuje ľubovoľný neprázdny type slug (per-tenant kolekcia)', () => {
    const result = AssetSchema.safeParse({
      ...validAssetInput,
      type: 'UNKNOWN',
    });
    expect(result.success).toBe(true);
  });

  it('odmieta prázdny type string', () => {
    const result = AssetSchema.safeParse({
      ...validAssetInput,
      type: '',
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

describe('CreateAssetSchema', () => {
  it('vyžaduje status = AVAILABLE pri vytvorení', () => {
    const input = {
      inventoryNumber: 'LT-2024-009',
      name: 'Test',
      type: AssetType.IT,
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
      type: AssetType.IT,
      categoryId: '507f1f77bcf86cd799439012',
      status: AssetStatus.BORROWED,
      condition: AssetCondition.NEW,
      locationId: '507f1f77bcf86cd799439013',
      acquiredAt: '2024-03-18T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
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
