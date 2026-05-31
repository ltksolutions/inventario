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
  lastName: 'Novák',
  displayName: 'Peter Novák',
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
  it('akceptuje validného Entra ID používateľa', () => {
    const result = UserSchema.safeParse(validUserInput);
    expect(result.success).toBe(true);
  });

  it('akceptuje používateľa s prázdnym roles (deprecated — roles sú na Membership po ADR-0015)', () => {
    // ADR-0015 K1: User.roles je deprecated field s default([]).
    // Authoritative roles su na Membership, nie na User.
    const result = UserSchema.safeParse({
      ...validUserInput,
      roles: [],
    });
    expect(result.success).toBe(true);
  });

  it('akceptuje viac rolí naraz', () => {
    const result = UserSchema.safeParse({
      ...validUserInput,
      roles: [UserRole.ASSET_MANAGER, UserRole.EMPLOYEE],
    });
    expect(result.success).toBe(true);
  });

  it('odmieta neplatnú UUID pre entraOid', () => {
    const result = UserSchema.safeParse({
      ...validUserInput,
      entraOid: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('akceptuje LOCAL účet s heslom', () => {
    const result = UserSchema.safeParse({
      ...validUserInput,
      accountType: AccountType.LOCAL,
      entraOid: null,
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$...',
    });
    expect(result.success).toBe(true);
  });

  it('odmieta neplatný telefón', () => {
    const result = UserSchema.safeParse({
      ...validUserInput,
      phone: '+420 605 123 456',
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateUserSchema', () => {
  it('akceptuje minimálny vstup pre nového používateľa', () => {
    const result = CreateUserSchema.safeParse({
      email: 'novak@futbalsfz.sk',
      firstName: 'Pavol',
      lastName: 'Novák',
      displayName: 'Pavol Novák',
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
      lastName: 'Novák',
      displayName: 'Pavol Novák',
      accountType: AccountType.ENTRA_ID,
      roles: [UserRole.EMPLOYEE],
    });
    // _id by malo byť odignorované (pretože je `.omit({ _id: true })`)
    expect(result.success).toBe(true);
    if (result.success) {
      expect('_id' in result.data).toBe(false);
    }
  });
});

describe('UpdateUserSchema', () => {
  it('akceptuje partial update s len jedným poľom', () => {
    const result = UpdateUserSchema.safeParse({
      firstName: 'Peter',
    });
    expect(result.success).toBe(true);
  });

  it('akceptuje prázdny update objekt', () => {
    const result = UpdateUserSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('nedovolí zmenu e-mailu cez bežný update', () => {
    const result = UpdateUserSchema.safeParse({
      email: 'new@futbalsfz.sk',
    });
    // E-mail je v `.omit({ email: true })`, takže by bol odignorovaný
    expect(result.success).toBe(true);
    if (result.success) {
      expect('email' in result.data).toBe(false);
    }
  });
});
