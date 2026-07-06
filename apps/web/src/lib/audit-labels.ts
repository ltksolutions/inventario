// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Zdieľané slovenské popisky pre audit log — akcie, typy entít, závažnosť.
 *
 * Použité na dvoch miestach (2026-07-07):
 *   - `AuditLogTab` v `AssetDetailContent.tsx` (história zmien jedného
 *     majetku) — predtým mal vlastnú lokálnu mapu pokrývajúcu len 6
 *     ASSET_* akcií, teraz zdieľa túto kompletnú.
 *   - `AuditLogContent.tsx` (`/audit-log`, kompletný tenant-wide audit
 *     log pre správcov).
 *
 * Zoznam akcií musí zostať v súlade s `AuditLogSchema.shape.action` v
 * `@inventario/shared-types` (packages/shared-types/src/schemas/audit-log.ts).
 * Chýbajúci kľúč nespôsobí chybu — volajúci si vždy robí `?? action`
 * fallback na surovú hodnotu, takže nová akcia sa jednoducho zobrazí
 * anglicky, kým sa sem nedoplní preklad.
 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  // Auth
  USER_LOGIN: 'Prihlásenie',
  USER_LOGIN_FAILED: 'Neúspešné prihlásenie',
  USER_LOGOUT: 'Odhlásenie',
  USER_PASSWORD_CHANGED: 'Zmena hesla',
  USER_PASSWORD_RESET_REQUESTED: 'Žiadosť o reset hesla',
  USER_MFA_ENABLED: 'Zapnuté dvojfaktorové overenie',
  USER_MFA_DISABLED: 'Vypnuté dvojfaktorové overenie',
  USER_MFA_RESET_BY_ADMIN: 'Dvojfaktorové overenie zresetované administrátorom',

  // User management
  USER_CREATED: 'Používateľ vytvorený',
  USER_UPDATED: 'Používateľ upravený',
  USER_DEACTIVATED: 'Používateľ deaktivovaný',
  USER_REACTIVATED: 'Používateľ reaktivovaný',
  USER_ROLE_GRANTED: 'Rola pridelená',
  USER_ROLE_REVOKED: 'Rola odobratá',

  // Organisation
  ORGANISATION_CREATED: 'Organizácia vytvorená',
  ORGANISATION_UPDATED: 'Organizácia upravená',
  ORGANISATION_DELETED: 'Organizácia zmazaná',
  ORGANISATION_BRANDING_UPDATED: 'Vzhľad organizácie upravený',

  // Asset
  ASSET_CREATED: 'Majetok vytvorený',
  ASSET_UPDATED: 'Majetok upravený',
  ASSET_DELETED: 'Majetok zmazaný',
  ASSET_STATUS_CHANGED: 'Zmena stavu majetku',
  ASSET_LOCATION_CHANGED: 'Zmena lokality majetku',
  ASSET_DISPOSED: 'Majetok vyradený',
  ASSET_ATTACHMENT_ADDED: 'Príloha pridaná',
  ASSET_ATTACHMENT_REMOVED: 'Príloha odstránená',
  ASSET_ATTACHMENT_SET_PRIMARY: 'Príloha označená ako hlavná',
  ASSET_TAG_RENAMED: 'Tag premenovaný',
  ASSET_TAG_DELETED: 'Tag zmazaný',

  // Category
  CATEGORY_CREATED: 'Kategória vytvorená',
  CATEGORY_UPDATED: 'Kategória upravená',
  CATEGORY_DELETED: 'Kategória zmazaná',

  // Location
  LOCATION_CREATED: 'Lokalita vytvorená',
  LOCATION_UPDATED: 'Lokalita upravená',
  LOCATION_DELETED: 'Lokalita zmazaná',

  // Loan
  LOAN_REQUEST_CREATED: 'Žiadosť o výpožičku vytvorená',
  LOAN_REQUEST_APPROVED: 'Žiadosť schválená',
  LOAN_REQUEST_REJECTED: 'Žiadosť zamietnutá',
  LOAN_REQUEST_CANCELLED: 'Žiadosť zrušená',
  LOAN_PICKED_UP: 'Majetok prevzatý',
  LOAN_RETURNED: 'Majetok vrátený',
  LOAN_EXTENDED: 'Výpožička predĺžená',
  LOAN_MARKED_OVERDUE: 'Výpožička označená ako po termíne',
  LOAN_MARKED_LOST: 'Majetok označený ako stratený',
  LOAN_CREATED_DIRECT: 'Priama výpožička vytvorená',
  LOAN_REQUEST_FULFILLED: 'Žiadosť vydaná',
  LOAN_PROTOCOL_CREATED: 'Preberací protokol vytvorený',
  LOAN_PROTOCOL_SIGNED: 'Preberací protokol podpísaný',

  // Stock movements
  STOCK_RECEIVED: 'Príjem na sklad',
  STOCK_ISSUED: 'Výdaj zo skladu',
  STOCK_RETURNED: 'Vrátenie na sklad',
  STOCK_ADJUSTED: 'Skladová korekcia',

  // GDPR
  DATA_EXPORT_REQUESTED: 'Žiadosť o export osobných údajov',
  DATA_DELETION_REQUESTED: 'Žiadosť o vymazanie osobných údajov',
  USER_PSEUDONYMIZED: 'Používateľ pseudonymizovaný',
  USER_RESTRICTED: 'Spracúvanie údajov obmedzené',
  USER_UNRESTRICTED: 'Obmedzenie spracúvania zrušené',

  // Membership
  MEMBERSHIP_CREATED: 'Členstvo v organizácii vytvorené',
  MEMBERSHIP_ROLES_CHANGED: 'Zmena rolí v organizácii',
  MEMBERSHIP_REMOVED: 'Členstvo v organizácii odobraté',
  USER_SWITCHED_ORGANISATION: 'Prepnutie organizácie',

  // Passkeys
  PASSKEY_REGISTERED: 'Prístupový kľúč zaregistrovaný',
  PASSKEY_REMOVED: 'Prístupový kľúč odstránený',
  PASSKEY_RENAMED: 'Prístupový kľúč premenovaný',
  PASSKEY_LOGIN: 'Prihlásenie prístupovým kľúčom',
  PASSKEY_LOGIN_FAILED: 'Neúspešné prihlásenie prístupovým kľúčom',
  PASSKEY_COUNTER_WARNING: 'Podozrivé použitie prístupového kľúča',

  // AssetType (legacy)
  ASSET_TYPE_CREATED: 'Typ majetku vytvorený',
  ASSET_TYPE_UPDATED: 'Typ majetku upravený',
  ASSET_TYPE_DELETED: 'Typ majetku zmazaný',

  // AssetCondition
  ASSET_CONDITION_CREATED: 'Stav majetku vytvorený',
  ASSET_CONDITION_UPDATED: 'Stav majetku upravený',
  ASSET_CONDITION_DELETED: 'Stav majetku zmazaný',

  // System
  SYSTEM_CONFIG_CHANGED: 'Systémové nastavenie zmenené',
  BULK_IMPORT_EXECUTED: 'Hromadný import vykonaný',
  INTEGRATION_TOKEN_CREATED: 'Integračný token vytvorený',
  INTEGRATION_TOKEN_REVOKED: 'Integračný token zrušený',
};

/** Popisky `target.entityType` — na čo sa akcia vzťahovala. */
export const AUDIT_ENTITY_TYPE_LABELS: Record<string, string> = {
  User: 'Používateľ',
  Organisation: 'Organizácia',
  Asset: 'Majetok',
  AssetType: 'Typ majetku',
  AssetCondition: 'Stav majetku',
  Loan: 'Výpožička',
  LoanRequest: 'Žiadosť o výpožičku',
  LoanProtocol: 'Preberací protokol',
  StockMovement: 'Skladový pohyb',
  Category: 'Kategória',
  Location: 'Lokalita',
  Membership: 'Členstvo',
  Passkey: 'Prístupový kľúč',
  System: 'Systém',
};

/** Popisky `severity` pre badge farby a text. */
export const AUDIT_SEVERITY_LABELS: Record<string, string> = {
  INFO: 'Info',
  WARNING: 'Upozornenie',
  ERROR: 'Chyba',
  CRITICAL: 'Kritické',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export function auditEntityTypeLabel(entityType: string): string {
  return AUDIT_ENTITY_TYPE_LABELS[entityType] ?? entityType;
}

export function auditSeverityLabel(severity: string): string {
  return AUDIT_SEVERITY_LABELS[severity] ?? severity;
}
