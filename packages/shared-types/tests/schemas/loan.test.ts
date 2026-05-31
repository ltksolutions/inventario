import { describe, expect, it } from 'vitest';

import { AssetCondition } from '../../src/enums/asset-type.js';
import { LoanRequestStatus, LoanStatus } from '../../src/enums/loan-status.js';
import {
  CreateLoanRequestSchema,
  LoanRequestSchema,
  LoanSchema,
  ReturnLoanSchema,
} from '../../src/schemas/loan.js';

describe('LoanRequestSchema', () => {
  const validLoanRequest = {
    _id: '507f1f77bcf86cd799439011',
    organisationId: '507f1f77bcf86cd799439099',
    createdAt: '2024-03-04T10:00:00.000Z',
    updatedAt: '2024-03-04T10:00:00.000Z',
    createdBy: '507f1f77bcf86cd799439012',
    updatedBy: '507f1f77bcf86cd799439012',
    deletedAt: null,
    deletedBy: null,
    requesterId: '507f1f77bcf86cd799439012',
    beneficiaryId: '507f1f77bcf86cd799439012', // ADR-0023: default = requesterId (žiadosť pre seba)
    purpose: 'Kvalifikácia U21 — Maďarsko, Budapešť',
    plannedFrom: '2024-03-18T08:00:00.000Z',
    plannedTo: '2024-03-23T20:00:00.000Z',
    items: [
      {
        assetId: '507f1f77bcf86cd799439020',
        snapshot: { inventoryNumber: 'LT-2024-008', name: 'Lenovo ThinkPad' },
        status: 'PENDING' as const,
        substitutedWithAssetId: null,
        approverNote: null,
      },
    ],
    status: LoanRequestStatus.PENDING,
    approvers: [
      {
        userId: '507f1f77bcf86cd799439030',
        categoryScope: ['507f1f77bcf86cd799439040'],
        decidedAt: null,
        decision: null,
        note: null,
      },
    ],
    resultingLoanId: null,
    rejectionReason: null,
    teamId: null,
    idempotencyKey: null,
  };

  it('akceptuje validnú žiadosť', () => {
    const result = LoanRequestSchema.safeParse(validLoanRequest);
    expect(result.success).toBe(true);
  });

  it('odmieta žiadosť bez položiek', () => {
    const result = LoanRequestSchema.safeParse({
      ...validLoanRequest,
      items: [],
    });
    expect(result.success).toBe(false);
  });

  it('odmieta príliš krátky purpose', () => {
    const result = LoanRequestSchema.safeParse({
      ...validLoanRequest,
      purpose: 'ok',
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateLoanRequestSchema', () => {
  it('nastavuje status na PENDING automaticky', () => {
    const result = CreateLoanRequestSchema.safeParse({
      requesterId: '507f1f77bcf86cd799439012',
      purpose: 'Pracovný notebook pre nového zamestnanca',
      plannedFrom: '2024-03-18T08:00:00.000Z',
      plannedTo: '2025-03-18T08:00:00.000Z',
      items: [
        {
          assetId: '507f1f77bcf86cd799439020',
          snapshot: { inventoryNumber: 'LT-2024-008', name: 'Lenovo ThinkPad' },
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(LoanRequestStatus.PENDING);
    }
  });
});

describe('LoanSchema', () => {
  const validLoan = {
    _id: '507f1f77bcf86cd799439050',
    organisationId: '507f1f77bcf86cd799439099',
    createdAt: '2024-03-17T08:00:00.000Z',
    updatedAt: '2024-03-17T08:00:00.000Z',
    createdBy: '507f1f77bcf86cd799439030',
    updatedBy: '507f1f77bcf86cd799439030',
    deletedAt: null,
    deletedBy: null,
    requestId: '507f1f77bcf86cd799439011',
    borrowerId: '507f1f77bcf86cd799439012',
    purpose: 'Kvalifikácia U21 — Maďarsko',
    pickedUpAt: '2024-03-18T08:00:00.000Z',
    handedOverBy: '507f1f77bcf86cd799439030',
    dueAt: '2024-03-23T20:00:00.000Z',
    returnedAt: null,
    returnedTo: null,
    items: [
      {
        assetId: '507f1f77bcf86cd799439020',
        snapshot: { inventoryNumber: 'LT-2024-008', name: 'Lenovo ThinkPad' },
        condition: {
          atPickup: {
            condition: AssetCondition.EXCELLENT,
            note: null,
            photoIds: [],
          },
          atReturn: null,
        },
      },
    ],
    status: LoanStatus.ACTIVE,
    extensionCount: 0,
    handoverProtocolId: null,
    returnProtocolId: null,
    notes: null,
  };

  it('akceptuje validnú aktívnu zápožičku', () => {
    const result = LoanSchema.safeParse(validLoan);
    expect(result.success).toBe(true);
  });

  it('odmieta zápožičku bez položiek', () => {
    const result = LoanSchema.safeParse({ ...validLoan, items: [] });
    expect(result.success).toBe(false);
  });

  it('akceptuje vrátenú zápožičku s atReturn', () => {
    const result = LoanSchema.safeParse({
      ...validLoan,
      status: LoanStatus.RETURNED,
      returnedAt: '2024-03-23T18:00:00.000Z',
      returnedTo: '507f1f77bcf86cd799439030',
      items: [
        {
          ...validLoan.items[0],
          condition: {
            atPickup: {
              condition: AssetCondition.EXCELLENT,
              note: null,
              photoIds: [],
            },
            atReturn: {
              condition: AssetCondition.GOOD,
              note: 'Bežné stopy používania',
              photoIds: [],
              requiresService: false,
            },
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('ReturnLoanSchema', () => {
  it('akceptuje minimálny vstup pre vrátenie', () => {
    const result = ReturnLoanSchema.safeParse({
      returnedTo: '507f1f77bcf86cd799439030',
      items: [
        {
          assetId: '507f1f77bcf86cd799439020',
          condition: AssetCondition.GOOD,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('akceptuje vrátenie s požiadavkou na servis', () => {
    const result = ReturnLoanSchema.safeParse({
      returnedTo: '507f1f77bcf86cd799439030',
      items: [
        {
          assetId: '507f1f77bcf86cd799439020',
          condition: AssetCondition.POOR,
          note: 'Prasknutý šev',
          requiresService: true,
        },
      ],
      notes: 'Vrátené čiastočne poškodené',
    });
    expect(result.success).toBe(true);
  });
});
