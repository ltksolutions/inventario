// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Role používateľov v systéme.
 *
 * Detailný rozpis oprávnení per rola je v docs/user-guide/reference/role-opravnenia.md
 * (TODO: vytvoriť tento dokument)
 *
 * ADR-0029: rola je per-membership JEDNA hodnota (nie pole). Roly tvoria
 * lineárnu hierarchiu úrovní prístupu — ADMIN dedí ASSET_MANAGER, ten dedí
 * základnú úroveň. EMPLOYEE a EXTERNAL sú rovnocenné (rovnaká úroveň), líšia
 * sa len typom vzťahu k organizácii.
 */
export const UserRole = {
  /** Zamestnanec — môže si požičiavať (pre seba aj v mene inej osoby), vidí vlastné zápožičky a té, kde je beneficiary. */
  EMPLOYEE: 'EMPLOYEE',
  /** Správca majetku — eviduje majetok, schvaľuje zápožičky, vydáva priame výpožičky, tlačí QR kódy. */
  ASSET_MANAGER: 'ASSET_MANAGER',
  /** Administrátor — má plný prístup, spravuje používateľov a systém. */
  ADMIN: 'ADMIN',
  /** Externý používateľ — klubový tréner, dobrovoľník. Obmedzený prístup. */
  EXTERNAL: 'EXTERNAL',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const USER_ROLE_VALUES = Object.values(UserRole) as readonly UserRole[];

// ---------------------------------------------------------------------------
// Rolová hierarchia (ADR-0029)
// ---------------------------------------------------------------------------

/**
 * Úroveň prístupu pre každú rolu. Vyššie číslo = viac oprávnení.
 *
 *   ADMIN          → 3   (dedí všetko nižšie)
 *   ASSET_MANAGER  → 2   (dedí základnú úroveň)
 *   EMPLOYEE       → 1   (základná úroveň)
 *   EXTERNAL       → 1   (rovnocenné s EMPLOYEE, len iný typ vzťahu)
 *
 * EMPLOYEE a EXTERNAL majú zámerne rovnakú úroveň — sú rovnocenné z hľadiska
 * prístupu. Na rozlíšenie TYPU (interný vs externý) treba porovnať priamo
 * `role === 'EXTERNAL'`, nie cez úroveň.
 */
export const ROLE_LEVEL: Record<UserRole, number> = {
  [UserRole.ADMIN]: 3,
  [UserRole.ASSET_MANAGER]: 2,
  [UserRole.EMPLOYEE]: 1,
  [UserRole.EXTERNAL]: 1,
};

/**
 * Spĺňa `actual` rola aspoň úroveň požadovanú rolou `required`?
 *
 * Hierarchická kontrola prístupu: „má používateľ aspoň túto úroveň?".
 *   roleSatisfies('ADMIN', 'ASSET_MANAGER')   → true  (ADMIN je vyššie)
 *   roleSatisfies('EMPLOYEE', 'ASSET_MANAGER') → false (EMPLOYEE je nižšie)
 *   roleSatisfies('EXTERNAL', 'EMPLOYEE')      → true  (rovnaká úroveň)
 *   roleSatisfies('EMPLOYEE', 'EXTERNAL')      → true  (rovnaká úroveň)
 *
 * POZOR: pre rozlíšenie EMPLOYEE vs EXTERNAL (typ, nie úroveň) NEPOUŽÍVAJ
 * túto funkciu — použij priame `role === 'EXTERNAL'`.
 */
export function roleSatisfies(actual: UserRole, required: UserRole): boolean {
  return ROLE_LEVEL[actual] >= ROLE_LEVEL[required];
}

/**
 * Vráti rolu s najvyššou úrovňou z poľa rolí.
 *
 * Používa sa pri migrácii `roles[]` → `role` (ADR-0029): z viacprvkového
 * legacy poľa odvodí jednu autoritatívnu rolu.
 *
 * Deterministické pravidlo pri zhode úrovní (EMPLOYEE vs EXTERNAL, oba level 1):
 * EMPLOYEE vyhráva nad EXTERNAL (preferujeme interný vzťah).
 *
 * Prázdne pole → EMPLOYEE (bezpečný minimálny default).
 */
export function highestRole(roles: readonly UserRole[]): UserRole {
  if (roles.length === 0) return UserRole.EMPLOYEE;

  let best: UserRole = roles[0]!;
  for (const r of roles) {
    if (ROLE_LEVEL[r] > ROLE_LEVEL[best]) {
      best = r;
    } else if (ROLE_LEVEL[r] === ROLE_LEVEL[best]) {
      // Zhoda úrovní: EMPLOYEE vyhráva nad EXTERNAL.
      if (r === UserRole.EMPLOYEE && best === UserRole.EXTERNAL) {
        best = r;
      }
    }
  }
  return best;
}

/**
 * Typ účtu z hľadiska autentifikácie.
 */
export const AccountType = {
  /** Prihlásenie cez Microsoft Entra ID (SSO) — pre interných zamestnancov. */
  ENTRA_ID: 'ENTRA_ID',
  /** Lokálny účet s e-mailom a heslom — pre externých používateľov. */
  LOCAL: 'LOCAL',
} as const;

export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export const ACCOUNT_TYPE_VALUES = Object.values(AccountType) as readonly AccountType[];
