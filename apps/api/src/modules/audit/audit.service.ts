/**
 * Audit log service — high-level "record an event" API.
 *
 * Wraps `AuditLogRepository` with a small builder that:
 *   1. Normalizes timestamps (always `new Date().toISOString()`)
 *   2. Snapshots actor details from `currentUser` so the audit log
 *      reflects who they were AT THE TIME (their displayName may change)
 *   3. Sets sensible defaults (severity=INFO, isPseudonymized=false)
 *
 * Transactional usage:
 *   The `record(...)` method accepts an optional `ClientSession`. When
 *   the caller passes one, the audit insert participates in the same
 *   transaction as the business-data write. Aborting the transaction
 *   rolls back BOTH atomically — no orphan audit records, no missing
 *   audit records.
 *
 * Non-transactional usage:
 *   Omit the session for fire-and-forget logging (e.g. login events
 *   where atomicity with the User document is overkill).
 */

import type { AuditLogRepository } from './audit.repository.js';
import type { AuditLog, User } from '@inventario/shared-types';
import type { FastifyRequest } from 'fastify';
import type { ClientSession, WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

/**
 * Subset of `AuditLog` fields the caller must provide. Everything else
 * (`at`, `actor`, `isPseudonymized`) is filled in by the service.
 */
export interface RecordEventInput {
  action: AuditLog['action'];
  target: AuditLog['target'];
  description: string;
  changes?: AuditLog['changes'];
  metadata?: AuditLog['metadata'];
  severity?: AuditLog['severity'];
  /**
   * GDPR čl. 30 — právny základ spracovania. Voliteľný v call site:
   * ak nie je poskytnutý, service ho odvodí z `action` cez
   * `defaultLegalBasisFor(action)`. Override explicit-ne ak má akcia
   * netradičný kontext (napr. núdzový zmrazený účet — `vital_interests`).
   */
  legalBasis?: AuditLog['legalBasis'];
  /**
   * GDPR čl. 30 ods. 1 písm. c) — dotknuté kategórie osobných údajov.
   * Defaultne odvodené z `action` cez `defaultDataCategoriesFor(action)`.
   */
  dataCategories?: AuditLog['dataCategories'];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AuditLogService {
  constructor(private readonly repo: AuditLogRepository) {}

  /**
   * Record an audit event for a user-initiated action.
   *
   * Pass `session` to make the insert part of a multi-document transaction
   * — strongly recommended for any state-changing business operation
   * (asset CRUD, loan transitions, role changes).
   *
   * The `request` parameter is used only for snapshotting actor metadata
   * (IP, User-Agent). It's optional for background/system actions; pass
   * `null` and the metadata fields will be set to `null`.
   */
  async record(
    user: WithId<User>,
    request: FastifyRequest | null,
    input: RecordEventInput,
    session?: ClientSession,
  ): Promise<void> {
    const record: Omit<AuditLog, '_id'> = {
      organisationId: String(user.organisationId),
      at: new Date().toISOString(),
      actor: {
        userId: String(user._id),
        displayName: user.displayName,
        accountType: user.accountType,
        ipAddress: request ? extractIpAddress(request) : null,
        userAgent: request ? extractUserAgent(request) : null,
      },
      action: input.action,
      target: input.target,
      description: input.description,
      changes: input.changes ?? null,
      metadata: input.metadata ?? {},
      severity: input.severity ?? 'INFO',
      legalBasis: input.legalBasis ?? defaultLegalBasisFor(input.action),
      dataCategories: input.dataCategories ?? defaultDataCategoriesFor(input.action),
      isPseudonymized: false,
      pseudonymizedAt: null,
    };

    await this.repo.insert(record, session);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * GDPR čl. 30 default mapping pre `action` → `legalBasis`.
 *
 * Používa sa, keď caller v `RecordEventInput` neuvedie `legalBasis`
 * explicitne. Väčšina akcií predstavuje jeden typ spracovania, takže
 * hardcoded mapping je jednoduchší než nechávať rozhodovanie na každých
 * call-site.
 *
 * Compliance referenčný dokument: `docs/compliance/gdpr-article-30.md`.
 */
function defaultLegalBasisFor(action: string): AuditLog['legalBasis'] {
  // Auth events — prevencia podvodov a security → legitimate interest.
  if (
    action === 'USER_LOGIN' ||
    action === 'USER_LOGIN_FAILED' ||
    action === 'USER_LOGOUT' ||
    action === 'USER_PASSWORD_CHANGED' ||
    action === 'USER_PASSWORD_RESET_REQUESTED' ||
    action === 'USER_MFA_ENABLED' ||
    action === 'USER_MFA_DISABLED' ||
    action === 'USER_MFA_RESET_BY_ADMIN'
  ) {
    return 'legitimate_interest';
  }

  // User lifecycle — plnenie zmluvy.
  if (
    action === 'USER_CREATED' ||
    action === 'USER_UPDATED' ||
    action === 'USER_DEACTIVATED' ||
    action === 'USER_REACTIVATED' ||
    action === 'USER_ROLE_GRANTED' ||
    action === 'USER_ROLE_REVOKED'
  ) {
    return 'contract';
  }

  // Tenant lifecycle — plnenie zmluvy s tenantom.
  if (
    action === 'ORGANISATION_CREATED' ||
    action === 'ORGANISATION_UPDATED' ||
    action === 'ORGANISATION_DELETED'
  ) {
    return 'contract';
  }

  // Asset / Category / Location / Loan / Stock — plnenie zmluvy (evidenčná služba).
  if (
    action.startsWith('ASSET_') ||
    action.startsWith('CATEGORY_') ||
    action.startsWith('LOCATION_') ||
    action.startsWith('LOAN_') ||
    action.startsWith('STOCK_')
  ) {
    return 'contract';
  }

  // GDPR rights — zákonná povinnosť.
  if (
    action === 'DATA_EXPORT_REQUESTED' ||
    action === 'DATA_DELETION_REQUESTED' ||
    action === 'USER_PSEUDONYMIZED'
  ) {
    return 'legal_obligation';
  }

  // Membership lifecycle (slice #9d) — plnenie zmluvy s tenantom.
  if (
    action === 'MEMBERSHIP_CREATED' ||
    action === 'MEMBERSHIP_ROLES_CHANGED' ||
    action === 'MEMBERSHIP_REMOVED' ||
    action === 'USER_SWITCHED_ORGANISATION'
  ) {
    return 'contract';
  }

  // System actions — žiadne osobné údaje.
  return 'n/a';
}

/**
 * GDPR čl. 30 default mapping pre `action` → `dataCategories[]`.
 *
 * Konzervatívny default — ak akcia môže dotknuť kategóriu, je v zozname.
 * Call-site môže override-núť, ak vie že konkrétny call sa nedotýka
 * niektorých fields (napr. update štítkov assetu sa nedotýka
 * `asset_custody`).
 */
function defaultDataCategoriesFor(action: string): NonNullable<AuditLog['dataCategories']> {
  // Auth
  if (action === 'USER_LOGIN' || action === 'USER_LOGIN_FAILED' || action === 'USER_LOGOUT') {
    return ['authentication', 'identification'];
  }
  if (
    action === 'USER_PASSWORD_CHANGED' ||
    action === 'USER_PASSWORD_RESET_REQUESTED' ||
    action === 'USER_MFA_ENABLED' ||
    action === 'USER_MFA_DISABLED' ||
    action === 'USER_MFA_RESET_BY_ADMIN'
  ) {
    return ['authentication'];
  }

  // User CRUD
  if (action === 'USER_CREATED' || action === 'USER_UPDATED') {
    return ['identification', 'contact', 'account'];
  }
  if (
    action === 'USER_DEACTIVATED' ||
    action === 'USER_REACTIVATED' ||
    action === 'USER_ROLE_GRANTED' ||
    action === 'USER_ROLE_REVOKED'
  ) {
    return ['account'];
  }

  // Organisation lifecycle — obsahuje contact (primaryContactEmail).
  if (
    action === 'ORGANISATION_CREATED' ||
    action === 'ORGANISATION_UPDATED' ||
    action === 'ORGANISATION_DELETED'
  ) {
    return ['contact', 'audit_metadata'];
  }

  // Asset CRUD — nepriame os. údaje cez createdBy/updatedBy.
  if (action.startsWith('ASSET_')) {
    return ['audit_metadata'];
  }

  // Loan — väzba osoba ↔ aktívum.
  if (action.startsWith('LOAN_')) {
    return ['asset_custody', 'audit_metadata'];
  }

  // Stock movements — nepriame os. údaje cez createdBy; LOAN_OUT/RETURN sú
  // viazané na zápožičku, ale samotný pohyb je skladová operácia.
  if (action.startsWith('STOCK_')) {
    return ['audit_metadata'];
  }

  // Category / Location — nepriame os. údaje cez createdBy/updatedBy.
  if (action.startsWith('CATEGORY_') || action.startsWith('LOCATION_')) {
    return ['audit_metadata'];
  }

  // GDPR rights
  if (
    action === 'DATA_EXPORT_REQUESTED' ||
    action === 'DATA_DELETION_REQUESTED' ||
    action === 'USER_PSEUDONYMIZED'
  ) {
    return ['identification', 'contact', 'account', 'authentication'];
  }

  // Membership lifecycle (slice #9d)
  if (
    action === 'MEMBERSHIP_CREATED' ||
    action === 'MEMBERSHIP_ROLES_CHANGED' ||
    action === 'MEMBERSHIP_REMOVED'
  ) {
    return ['account', 'audit_metadata'];
  }
  if (action === 'USER_SWITCHED_ORGANISATION') {
    return ['account'];
  }

  // System actions — väčšinou nič.
  return [];
}

/**
 * Extracts the client IP from a Fastify request.
 *
 * Fastify's `request.ip` honours `trustProxy` (set in server.ts), which
 * means on Vercel it returns the real client IP from `X-Forwarded-For`
 * rather than the Vercel edge IP.
 *
 * We truncate to 45 chars (max IPv6 length) to match the schema constraint.
 */
function extractIpAddress(request: FastifyRequest): string | null {
  const ip = request.ip;
  if (!ip) return null;
  // Drop trailing nulls / placeholders some proxies emit
  if (ip === '::1' || ip === '127.0.0.1') return ip;
  return ip.slice(0, 45);
}

/**
 * Extracts and truncates the User-Agent header. Schema cap is 500 chars.
 */
function extractUserAgent(request: FastifyRequest): string | null {
  const ua = request.headers['user-agent'];
  if (typeof ua !== 'string') return null;
  return ua.slice(0, 500);
}
