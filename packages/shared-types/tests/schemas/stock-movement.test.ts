// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { describe, expect, it } from 'vitest';

import { StockMovementType } from '../../src/enums/stock-movement-type.js';
import {
  CreateStockMovementSchema,
  StockMovementSchema,
} from '../../src/schemas/stock-movement.js';

const validMovementInput = {
  _id: '507f1f77bcf86cd799439011',
  organisationId: '507f1f77bcf86cd799439020',
  createdAt: '2026-05-30T08:00:00.000Z',
  updatedAt: '2026-05-30T08:00:00.000Z',
  createdBy: '507f1f77bcf86cd799439099',
  updatedBy: '507f1f77bcf86cd799439099',
  itemId: '507f1f77bcf86cd799439012',
  type: StockMovementType.RECEIPT,
  quantity: 30,
  balanceAfter: 30,
  reason: null,
  loanId: null,
  locationId: '507f1f77bcf86cd799439013',
  note: null,
};

describe('StockMovementSchema', () => {
  it('akceptuje validný pohyb (RECEIPT)', () => {
    const result = StockMovementSchema.safeParse(validMovementInput);
    expect(result.success).toBe(true);
  });

  it('akceptuje záporné množstvo (LOAN_OUT je výdaj)', () => {
    const result = StockMovementSchema.safeParse({
      ...validMovementInput,
      type: StockMovementType.LOAN_OUT,
      quantity: -10,
      balanceAfter: 20,
    });
    expect(result.success).toBe(true);
  });

  it('odmieta nulové množstvo', () => {
    const result = StockMovementSchema.safeParse({
      ...validMovementInput,
      quantity: 0,
    });
    expect(result.success).toBe(false);
  });

  it('odmieta neceločíselné množstvo', () => {
    const result = StockMovementSchema.safeParse({
      ...validMovementInput,
      quantity: 2.5,
    });
    expect(result.success).toBe(false);
  });

  it('odmieta záporný balanceAfter (stav nesmie ísť pod nulu)', () => {
    const result = StockMovementSchema.safeParse({
      ...validMovementInput,
      type: StockMovementType.LOAN_OUT,
      quantity: -40,
      balanceAfter: -10,
    });
    expect(result.success).toBe(false);
  });

  it('odmieta neznámy typ pohybu', () => {
    const result = StockMovementSchema.safeParse({
      ...validMovementInput,
      type: 'SHIPMENT',
    });
    expect(result.success).toBe(false);
  });

  it('akceptuje pohyb naviazaný na zápožičku', () => {
    const result = StockMovementSchema.safeParse({
      ...validMovementInput,
      type: StockMovementType.LOAN_OUT,
      quantity: -5,
      balanceAfter: 25,
      loanId: '507f1f77bcf86cd799439055',
    });
    expect(result.success).toBe(true);
  });
});

describe('CreateStockMovementSchema', () => {
  it('akceptuje minimálny vstup a defaultuje voliteľné polia na null', () => {
    const result = CreateStockMovementSchema.safeParse({
      itemId: '507f1f77bcf86cd799439012',
      type: StockMovementType.RECEIPT,
      quantity: 30,
      locationId: '507f1f77bcf86cd799439013',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBeNull();
      expect(result.data.loanId).toBeNull();
      expect(result.data.note).toBeNull();
    }
  });

  it('balanceAfter ani organisationId nie sú súčasťou create vstupu (server ich dopĺňa)', () => {
    const result = CreateStockMovementSchema.safeParse({
      itemId: '507f1f77bcf86cd799439012',
      type: StockMovementType.ADJUSTMENT,
      quantity: -3,
      reason: 'Inventúra — chýbajúce kusy',
      locationId: '507f1f77bcf86cd799439013',
      // tieto klient nemôže nastaviť — ignorujú sa
      balanceAfter: 999,
      organisationId: '507f1f77bcf86cd799439020',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('balanceAfter' in result.data).toBe(false);
      expect('organisationId' in result.data).toBe(false);
      expect(result.data.reason).toBe('Inventúra — chýbajúce kusy');
    }
  });
});
