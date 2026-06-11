// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Audit log plugin — exposes `fastify.auditLog` for other modules.
 *
 * Other modules (assets, users, loans, ...) inject this service into
 * their own service classes to record events. Centralising the
 * `auditLog` instance on the Fastify root means there's a single
 * place to swap implementations later (e.g. external SIEM forwarder).
 *
 * Registered after the `mongo` plugin so `fastify.mongo.db` is available
 * for the repository constructor.
 */

import fp from 'fastify-plugin';

import { AuditLogRepository } from './audit.repository.js';
import { AuditLogService } from './audit.service.js';

import type { FastifyPluginAsync } from 'fastify';

// ---------------------------------------------------------------------------
// Fastify decoration
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Audit log service for recording user-initiated events.
     *
     * Use `auditLog.record(user, request, { action, target, ... }, session?)`
     * to log a transactional or fire-and-forget event.
     */
    auditLog: AuditLogService;
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const auditPlugin: FastifyPluginAsync = async (fastify) => {
  const repo = new AuditLogRepository(fastify.mongo.db);
  await repo.ensureIndexes();

  const service = new AuditLogService(repo);
  fastify.decorate('auditLog', service);
};

export default fp(auditPlugin, {
  name: 'audit',
  dependencies: ['mongo'],
});
