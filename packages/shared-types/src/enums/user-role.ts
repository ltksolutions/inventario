/**
 * Role používateľov v systéme.
 *
 * Detailný rozpis oprávnení per rola je v docs/user-guide/reference/role-opravnenia.md
 * (TODO: vytvoriť tento dokument)
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
