import { describe, expect, it } from 'vitest';

import { AccountType, UserRole } from '../../src/enums/user-role.js';
import { CreateUserSchema, UpdateUserSchema, UserSchema } from '../../src/schemas/user.js';

const validUserInput = {
  _id: '507f1f77bcf86cd799439011',
  organisationId: '507f1f77bcf86cd799439020',
  createdAt: '2024-03-18T08:00:00.000Z',
  updatedAt: '2024-03-18T08:00:00.000Z',
  createdBy: 'SYSTEM' as const,
  updatedBy: 'SYSTEM' as const,
  deletedAt: null,
  deletedBy: null,
  email: 'peter.novak@futbalsfz.sk',
  firstName: 'Peter',
  lastName: 'Nov\u00e1k',
  displayName: 'Peter Nov\u00e1k',
  accountType: AccountType.ENTRA_ID,
  entraOid: '550e8400-e29b-41d4-a716-446655440000',
  passwordHash: null,
  roles: [UserRole.EMPLOYEE],
  organizationalUnit: null,
  teams: [],
  isActive: true,
  lastLoginAt: null,
  invitationSentAt: null,
  mustChangePassword: false,
  preferences: {
    language: 'sk' as const,
    timezone: 'Europe/Bratislava',
    emailNotifications: true,
    pushNotifications: false,
  },
};

describe('UserSchema', () => {
  it('akceptuje validn\u00e9ho Entra ID pou\u017e\u00edvate\u013ea', () => {
    const result = UserSchema.safeParse(validUserInput);
    expect(result.success).toBe(true);
  });

  it('akceptuje pou\u017e\u00edvate\u013ea s pr\u00e1zdnym roles (deprecated \u2014 roles s\u00fa na Membership po ADR-0015)', () => {
    // ADR-0015 K1: User.roles je deprecated field s default([]).
    // Authoritative roles su na Membership, nie na User.
    const result = UserSchema.safeParse({
      ...validUserInput,
      roles: [],
    });
    expect(result.success).toBe(true);
  });

  it('akceptuje viac rol\u00ed naraz', () => {
    const result = UserSchema.safeParse({
      ...validUserInput,
      roles: [UserRole.TEAM_MANAGER, UserRole.EMPLOYEE],
    });
    expect(result.success).toBe(true);
  });

  it('odmieta neplatn\u00fa UUID pre entraOid', () => {
    const result = UserSchema.safeParse({
      ...validUserInput,
      entraOid: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('akceptuje LOCAL \u00fa\u010det s heslom', () => {
    const result = UserSchema.safeParse({
      ...validUserInput,
      accountType: AccountType.LOCAL,
      entraOid: null,
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$...',
    });
    expect(result.success).toBe(true);
  });

  it('odmieta neplatn\u00fd telef\u00f3n', () => {
    const result = UserSchema.safeParse({
      ...validUserInput,
      phone: '+420 605 123 456',
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateUserSchema', () => {
  it('akceptuje minim\u00e1lny vstup pre nov\u00e9ho pou\u017e\u00edvate\u013ea', () => {
    const result = CreateUserSchema.safeParse({
      email: 'novak@futbalsfz.sk',
      firstName: 'Pavol',
      lastName: 'Nov\u00e1k',
      displayName: 'Pavol Nov\u00e1k',
      accountType: AccountType.ENTRA_ID,
      entraOid: '550e8400-e29b-41d4-a716-446655440000',
      roles: [UserRole.EMPLOYEE],
    });
    expect(result.success).toBe(true);
  });

  it('odmieta vytvorenie s _id (audit fields generuje server)', () => {
    const result = CreateUserSchema.safeParse({
      _id: '507f1f77bcf86cd799439011',
      email: 'novak@futbalsfz.sk',
      firstName: 'Pavol',
      lastName: 'Nov\u00e1k',
      displayName: 'Pavol Nov\u00e1k',
      accountType: AccountType.ENTRA_ID,
      roles: [UserRole.EMPLOYEE],
    });
    // _id by malo by\u0165 odignorovan\u00e9 (preto\u017ee je `.omit({ _id: true })`)
    expect(result.success).toBe(true);
    if (result.success) {
      expect('_id' in result.data).toBe(false);
    }
  });
});

describe('UpdateUserSchema', () => {
  it('akceptuje partial update s len jedn\u00fdm po\u013eem', () => {
    const result = UpdateUserSchema.safeParse({
      firstName: 'Peter',
    });
    expect(result.success).toBe(true);
  });

  it('akceptuje pr\u00e1zdny update objekt', () => {
    const result = UpdateUserSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('nedovol\u00ed zmenu e-mailu cez be\u017en\u00fd update', () => {
    const result = UpdateUserSchema.safeParse({
      email: 'new@futbalsfz.sk',
    });
    // E-mail je v `.omit({ email: true })`, tak\u017ee by bol odignorovan\u00fd
    expect(result.success).toBe(true);
    if (result.success) {
      expect('email' in result.data).toBe(false);
    }
  });
});
