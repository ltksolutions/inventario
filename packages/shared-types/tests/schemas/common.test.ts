// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { describe, expect, it } from 'vitest';

import {
  EmailSchema,
  HexColorSchema,
  ObjectIdSchema,
  PhoneSchema,
  TimestampSchema,
} from '../../src/schemas/common.js';

describe('ObjectIdSchema', () => {
  it('akceptuje validný 24-znakový hex ObjectId', () => {
    const result = ObjectIdSchema.safeParse('507f1f77bcf86cd799439011');
    expect(result.success).toBe(true);
  });

  it('akceptuje uppercase hex', () => {
    const result = ObjectIdSchema.safeParse('507F1F77BCF86CD799439011');
    expect(result.success).toBe(true);
  });

  it('odmieta príliš krátky string', () => {
    const result = ObjectIdSchema.safeParse('507f1f77bcf86cd79943901');
    expect(result.success).toBe(false);
  });

  it('odmieta non-hex znaky', () => {
    const result = ObjectIdSchema.safeParse('507f1f77bcf86cd79943901z');
    expect(result.success).toBe(false);
  });

  it('odmieta prázdny string', () => {
    const result = ObjectIdSchema.safeParse('');
    expect(result.success).toBe(false);
  });
});

describe('TimestampSchema', () => {
  it('akceptuje ISO 8601 v UTC s Z', () => {
    const result = TimestampSchema.safeParse('2024-03-18T08:00:00.000Z');
    expect(result.success).toBe(true);
  });

  it('akceptuje ISO 8601 s offsetom', () => {
    const result = TimestampSchema.safeParse('2024-03-18T08:00:00.000+01:00');
    expect(result.success).toBe(true);
  });

  it('odmieta nesprávny formát', () => {
    const result = TimestampSchema.safeParse('2024-03-18 08:00:00');
    expect(result.success).toBe(false);
  });

  it('odmieta unix timestamp', () => {
    const result = TimestampSchema.safeParse(1710748800000);
    expect(result.success).toBe(false);
  });
});

describe('EmailSchema', () => {
  it('akceptuje validný e-mail', () => {
    const result = EmailSchema.safeParse('peter.novak@firma.sk');
    expect(result.success).toBe(true);
  });

  it('normalizuje na lowercase', () => {
    const result = EmailSchema.safeParse('Peter.Novak@FIRMA.SK');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('peter.novak@firma.sk');
    }
  });

  it('odmieta string bez @', () => {
    const result = EmailSchema.safeParse('peter.novak');
    expect(result.success).toBe(false);
  });

  it('odmieta príliš dlhý e-mail', () => {
    const longEmail = 'a'.repeat(250) + '@example.com';
    const result = EmailSchema.safeParse(longEmail);
    expect(result.success).toBe(false);
  });
});

describe('PhoneSchema', () => {
  it('akceptuje +421 formát s medzerami', () => {
    const result = PhoneSchema.safeParse('+421 905 123 456');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('+421905123456');
    }
  });

  it('akceptuje +421 formát bez medzier', () => {
    const result = PhoneSchema.safeParse('+421905123456');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('+421905123456');
    }
  });

  it('normalizuje 0905 na +421905', () => {
    const result = PhoneSchema.safeParse('0905 123 456');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('+421905123456');
    }
  });

  it('odmieta zahraničné čísla', () => {
    const result = PhoneSchema.safeParse('+420 605 123 456');
    expect(result.success).toBe(false);
  });

  it('odmieta pevnú linku', () => {
    const result = PhoneSchema.safeParse('+421 2 5443 1234');
    expect(result.success).toBe(false);
  });
});

describe('HexColorSchema', () => {
  it('akceptuje platný lowercase #RRGGBB', () => {
    expect(HexColorSchema.safeParse('#1a2d47').success).toBe(true);
  });

  it('akceptuje platný uppercase #RRGGBB', () => {
    expect(HexColorSchema.safeParse('#1A2D47').success).toBe(true);
  });

  it('akceptuje bielu a čiernu', () => {
    expect(HexColorSchema.safeParse('#ffffff').success).toBe(true);
    expect(HexColorSchema.safeParse('#000000').success).toBe(true);
  });

  it('odmieta skrátený #RGB formát', () => {
    expect(HexColorSchema.safeParse('#fff').success).toBe(false);
  });

  it('odmieta hodnotu bez # prefixu', () => {
    expect(HexColorSchema.safeParse('1a2d47').success).toBe(false);
  });

  it('odmieta 8-znakový RGBA formát', () => {
    expect(HexColorSchema.safeParse('#1a2d47ff').success).toBe(false);
  });

  it('odmieta neplatné hex znaky', () => {
    expect(HexColorSchema.safeParse('#1a2d4g').success).toBe(false);
  });

  it('odmieta prázdny string', () => {
    expect(HexColorSchema.safeParse('').success).toBe(false);
  });

  it('vracia pôvodnú hodnotu (bez transformácie)', () => {
    const result = HexColorSchema.safeParse('#388fc3');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('#388fc3');
  });
});
