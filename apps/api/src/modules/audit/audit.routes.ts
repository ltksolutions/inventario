// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Audit log routes — kompletný, prehľadávateľný audit log pre správcov
 * (2026-07-07).
 *
 * Odlišné od `GET /v1/assets/:id/audit` (per-entity história v
 * assets.routes.ts) — toto je tenant-wide pohľad naprieč všetkými typmi
 * entít, s filtrami podľa akcie, typu entity, osoby (aktér) a dátumového
 * rozsahu. Vždy tenant-scoped (nikdy cross-tenant).
 *
 * RBAC: ASSET_MANAGER + ADMIN (rozhodnutie Janiky pri zadaní — pôvodne
 * plánované len pre ADMIN, rozšírené aj na Správcu majetku aktívneho
 * tenanta). Rovnaká úroveň ako existujúci per-asset audit tab.
 */

import { AuditLogSchema } from '@inventario/shared-types';
import { z } from 'zod';

import { AuditLogRepository } from './audit.repository.js';

import type { AuditLog } from '@inventario/shared-types';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

// Znovupoužité enumy zo shared-types namiesto duplikovania — pri pridaní
// novej akcie (napr. budúci ASSET_TAG_* vzor) sa filter automaticky
// rozšíri, nič sa tu nemusí meniť.
const ActionEnum = AuditLogSchema.shape.action;
const EntityTypeEnum = AuditLogSchema.shape.target.unwrap().shape.entityType;

const AuditLogListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  action: ActionEnum.optional(),
  entityType: EntityTypeEnum.optional(),
  /** Mongo ObjectId hex reťazec konkrétnej osoby (aktér). */
  actorUserId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'actorUserId musí byť platné Mongo ObjectId')
    .optional(),
  /** ISO 8601 timestamp — od (vrátane). */
  dateFrom: z.string().datetime().optional(),
  /** ISO 8601 timestamp — do (vrátane). */
  dateTo: z.string().datetime().optional(),
});

const AuditLogEntrySchema = z.object({
  id: z.string(),
  at: z.string(),
  actor: z.object({
    userId: z.string(),
    displayName: z.string(),
    accountType: z.string(),
  }),
  action: z.string(),
  target: z
    .object({
      entityType: z.string(),
      entityId: z.string().nullable(),
    })
    .nullable(),
  description: z.string(),
  changes: z
    .array(
      z.object({
        field: z.string(),
        before: z.unknown(),
        after: z.unknown(),
      }),
    )
    .nullable(),
  severity: z.string(),
});

const AuditLogListResponseSchema = z.object({
  data: z.array(AuditLogEntrySchema),
  pagination: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    skip: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});

// ---------------------------------------------------------------------------
// Response mapping — odolné voči legacy tvaru záznamov
// ---------------------------------------------------------------------------

/**
 * Loosely-typed pohľad na surový `audit_logs` dokument. Zopár záznamov
 * z júna 2026 (pred zjednotením na `AuditLogService.record()` — najmä
 * `MEMBERSHIP_*` a `USER_INVITATION_ACCEPTED`) má úplne iný, staršiu
 * schému: `createdAt` namiesto `at`, `actor: {userId, email}` bez
 * `displayName`/`accountType`, žiadne `description`. Potvrdené priamym
 * dotazom do prod DB (2026-07-07) po nahlásenej chybe "Audit log sa
 * nepodarilo načítať" pri filtrovaní.
 *
 * Tieto staré dokumenty sa NEUPRAVUJÚ (audit log je append-only — viď
 * `AuditLogSchema` docstring) — namiesto backfill migrácie ich táto
 * funkcia len bezpečne normalizuje pri čítaní, nech prísna response
 * schéma (`AuditLogEntrySchema`) nikdy nedostane `undefined`.
 */
interface LegacyAuditLogShape {
  _id: unknown;
  at?: string;
  createdAt?: string;
  actor?: {
    userId?: unknown;
    displayName?: string;
    accountType?: string;
    email?: string;
  };
  action: string;
  target?: { entityType?: string; entityId?: unknown } | null;
  description?: string;
  changes?: AuditLog['changes'];
  severity?: string;
}

function toEntryResponse(raw: AuditLog): {
  id: string;
  at: string;
  actor: { userId: string; displayName: string; accountType: string };
  action: string;
  target: { entityType: string; entityId: string | null } | null;
  description: string;
  changes: AuditLog['changes'];
  severity: string;
} {
  const e = raw as unknown as LegacyAuditLogShape;
  const actor = e.actor ?? {};

  return {
    id: String(e._id),
    at: e.at ?? e.createdAt ?? new Date(0).toISOString(),
    actor: {
      userId: actor.userId != null ? String(actor.userId) : '',
      displayName: actor.displayName ?? actor.email ?? 'Neznámy',
      accountType: actor.accountType ?? 'LOCAL',
    },
    action: e.action,
    target: e.target
      ? {
          entityType: e.target.entityType ?? 'System',
          entityId: e.target.entityId != null ? String(e.target.entityId) : null,
        }
      : null,
    description: e.description ?? `(starší záznam bez popisu — akcia: ${e.action})`,
    changes: e.changes ?? null,
    severity: e.severity ?? 'INFO',
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const auditRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const repo = new AuditLogRepository(fastify.mongo.db);
  await repo.ensureIndexes();

  const canRead = fastify.requireRole(['ASSET_MANAGER', 'ADMIN']);

  // --- GET /v1/audit-log ----------------------------------------------------
  app.get(
    '/v1/audit-log',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Audit'],
        summary: 'Kompletný audit log aktívneho tenanta (filtrovateľný)',
        description:
          'Záznamy auditu pre aktívny tenant (najnovšie prvé), stránkované, ' +
          's voliteľnými filtrami podľa akcie (`action`), typu entity ' +
          '(`entityType`), osoby (`actorUserId`) a dátumového rozsahu ' +
          '(`dateFrom`/`dateTo`). Vyžaduje ASSET_MANAGER alebo ADMIN.',
        security: [{ bearerAuth: [] }],
        querystring: AuditLogListQuerySchema,
        response: { 200: AuditLogListResponseSchema },
      },
    },
    async (request) => {
      const organisationId = String(request.currentUser.organisationId);
      const { limit, skip, action, entityType, actorUserId, dateFrom, dateTo } = request.query;

      const filters = { action, entityType, actorUserId, dateFrom, dateTo };

      const [entries, total] = await Promise.all([
        repo.findByOrganisation(organisationId, filters, { limit, skip }),
        repo.countByOrganisation(organisationId, filters),
      ]);

      return {
        data: entries.map(toEntryResponse),
        pagination: { total, limit, skip, hasMore: skip + entries.length < total },
      };
    },
  );
};

export default auditRoutes;
