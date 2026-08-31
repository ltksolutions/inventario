// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Protocols routes — HTTP endpoints pre preberacie protokoly (ADR-0022 K5–K6).
 *
 * RBAC:
 *   GET  /v1/protocols                ASSET_MANAGER+ADMIN všetky; EMPLOYEE len vlastné (účastník)
 *   GET  /v1/loans/:id/protocols      borrower ALEBO ASSET_MANAGER+ADMIN
 *   GET  /v1/protocols/:id            účastník protokolu ALEBO ASSET_MANAGER+ADMIN
 *   GET  /v1/protocols/:id/pdf        účastník protokolu ALEBO ASSET_MANAGER+ADMIN
 *   POST /v1/protocols/:id/sign       len príslušná strana (handover alebo receive)
 *   POST /v1/loans/:id/protocols      ASSET_MANAGER+ADMIN (backfill protokolu)
 *
 * Cross-tenant izolácia: všetky repo metódy berú `organisationId` z auth tokenu
 * (nie z URL) — dokument iného tenanta sa vráti ako null → 404.
 *
 * PDF renderovanie (ADR-0022 rozhodnutie 1C):
 *   - PDF sa negeneruje raz a neukladá. Renderuje sa on-demand pri každom GET.
 *   - `pdfSha256` sa dopočíta po prvom renderi a uloží (lazy, background).
 *   - Render je deterministický → hash je stabilný po celý životný cyklus.
 *
 * Borrower snapshot (K4 kompromis):
 *   - `insertDraftProtocol()` vloží prázdny snapshot pri borrowerovi
 *     (displayName: '', email: ''). Zámer: K4 nepridáva extra DB lookup do transakcie.
 *   - Protokol v DRAFT stave je interný doklad. Podpísaný (SIGNED) bude mať
 *     reálne strany fixnuté v čase podpisu (K6).
 *
 * Dependency: registrovaný po `loan-requests-routes` (obsahuje `loansService` decoration).
 */

import crypto from 'node:crypto';

import { roleSatisfies, UserRole } from '@inventario/shared-types';
import fp from 'fastify-plugin';
import { ObjectId } from 'mongodb';
import { z } from 'zod';

import { ensureIndexesOnBoot } from '../../lib/ensure-indexes.js';
import { ForbiddenError, NotFoundError } from '../../plugins/error-handler.js';

import { LoanProtocolsRepository } from './loan-protocols.repository.js';
import { loadDefaultFont, loadLogo } from './logo-loader.js';
import { renderProtocolPdf } from './protocol-renderer.js';

import type { LoanProtocol, Organisation } from '@inventario/shared-types';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Db, WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const IdParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát ID.'),
});

const ProtocolIdParamsSchema = z.object({
  protocolId: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát ID.'),
});

const SingleResponseSchema = z.record(z.string(), z.unknown());

const SignBodySchema = z.object({
  method: z.literal('CLICK_TO_SIGN'),
});

const CreateProtocolBodySchema = z.object({
  type: z.enum(['HANDOVER', 'RETURN']),
});

const ListProtocolsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(20),
  skip: z.coerce.number().int().min(0).default(0),
  type: z.enum(['HANDOVER', 'RETURN', 'AMENDMENT']).optional(),
  status: z.enum(['DRAFT', 'SIGNED', 'AMENDED', 'VOIDED']).optional(),
});

const PaginatedResponseSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  pagination: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    skip: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const protocolsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const protocolsRepo = new LoanProtocolsRepository(fastify.mongo.db);
  await ensureIndexesOnBoot(fastify, 'protocols', protocolsRepo);

  // Injektnúť repo do LoansService (bol dekorovaný v loan-requests-routes bez repo).
  fastify.loansService.setProtocolsRepo(protocolsRepo);

  const canRead = fastify.requireRole(['EMPLOYEE', 'ASSET_MANAGER', 'ADMIN', 'EXTERNAL']);
  const canWrite = fastify.requireMinRole('ASSET_MANAGER');

  // ── GET /v1/protocols ────────────────────────────────────────────────────
  app.get(
    '/v1/protocols',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Protocols'],
        summary: 'Zoznam preberacích protokolov',
        description:
          'Stránkovaný zoznam protokolov tenanta, najnovšie prvé. ' +
          'ASSET_MANAGER/ADMIN vidí všetky protokoly organizácie, ' +
          'EMPLOYEE len tie, kde je odovzdávajúcou alebo preberajúcou stranou. ' +
          'Filtrovateľné podľa `type` a `status`.',
        security: [{ bearerAuth: [] }],
        querystring: ListProtocolsQuerySchema,
        response: { 200: PaginatedResponseSchema },
      },
    },
    async (request) => {
      const actor = request.currentUser;
      const tenantId = String(actor.organisationId);
      const { limit, skip, type, status } = request.query;

      const { items, total } = await protocolsRepo.list(tenantId, {
        limit,
        skip,
        ...(type && { type }),
        ...(status && { status }),
        // EMPLOYEE/EXTERNAL: vynútene len protokoly, kde je účastníkom
        ...(!isManagerOrAdmin(actor) && { participantUserId: String(actor._id) }),
      });

      const enriched = await enrichPartySnapshots(fastify.mongo.db, items);
      return {
        data: enriched,
        pagination: { total, limit, skip, hasMore: skip + items.length < total },
      };
    },
  );

  // ── POST /v1/loans/:id/protocols ─────────────────────────────────────────
  app.post(
    '/v1/loans/:id/protocols',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Protocols'],
        summary: 'Dodatočne vytvoriť protokol k výpožičke (backfill)',
        description:
          'Vytvorí DRAFT protokol pre existujúcu výpožičku, ktorá ho ešte nemá — ' +
          'určené pre výpožičky vzniknuté pred zavedením protokolov. ' +
          'HANDOVER vyžaduje loan bez handoverProtocolId; ' +
          'RETURN vyžaduje vrátený loan bez returnProtocolId. ' +
          'Vyžaduje ASSET_MANAGER alebo ADMIN rolu.',
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        body: CreateProtocolBodySchema,
        response: { 201: SingleResponseSchema },
      },
    },
    async (request, reply) => {
      const actor = request.currentUser;
      const tenantId = String(actor.organisationId);
      const { id: loanId } = request.params;

      const protocolId = await fastify.loansService.createProtocolForLoan(
        loanId,
        request.body.type,
        actor,
        request,
      );

      const protocol = await protocolsRepo.findById(tenantId, protocolId);
      if (!protocol) throw new NotFoundError('LoanProtocol', protocolId);
      return reply.status(201).send(protocolToApiShape(protocol));
    },
  );

  // ── GET /v1/loans/:id/protocols ─────────────────────────────────────────
  app.get(
    '/v1/loans/:id/protocols',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Protocols'],
        summary: 'Zoznam protokolov k výpožičke',
        description:
          'Vráti všetky protokoly (HANDOVER + RETURN) viazané na danú výpožičku. ' +
          'Prístupné borrowerovi daného Loan alebo ASSET_MANAGER/ADMIN.',
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        response: {
          200: z.object({
            data: z.array(z.record(z.string(), z.unknown())),
          }),
        },
      },
    },
    async (request) => {
      const actor = request.currentUser;
      const tenantId = String(actor.organisationId);
      const { id: loanId } = request.params;

      if (!ObjectId.isValid(loanId)) throw new NotFoundError('Loan', loanId);

      // Načítaj loan pre RBAC check
      const loan = await fastify.mongo.db.collection('loans').findOne({
        _id: new ObjectId(loanId) as never,
        organisationId: tenantId,
        deletedAt: null,
      });

      if (!loan) throw new NotFoundError('Loan', loanId);

      if (!isManagerOrAdmin(actor) && String(loan['borrowerId']) !== String(actor._id)) {
        throw new ForbiddenError('Nemáš oprávnenie zobraziť protokoly tejto výpožičky.');
      }

      const protocols = await protocolsRepo.findByLoanId(tenantId, loanId);
      return { data: await enrichPartySnapshots(fastify.mongo.db, protocols) };
    },
  );

  // ── GET /v1/protocols/:protocolId ────────────────────────────────────────
  app.get(
    '/v1/protocols/:protocolId',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Protocols'],
        summary: 'Metadata protokolu (JSON)',
        description:
          'Vráti JSON záznam protokolu (číslo, strany, stav, podpisy). ' +
          'Prístupné účastníkovi protokolu (handover/receive strana) alebo ASSET_MANAGER/ADMIN.',
        security: [{ bearerAuth: [] }],
        params: ProtocolIdParamsSchema,
        response: { 200: SingleResponseSchema },
      },
    },
    async (request) => {
      const actor = request.currentUser;
      const tenantId = String(actor.organisationId);
      const { protocolId } = request.params;

      const protocol = await protocolsRepo.findById(tenantId, protocolId);
      if (!protocol) throw new NotFoundError('LoanProtocol', protocolId);

      assertCanAccessProtocol(protocol, actor);
      return protocolToApiShape(protocol);
    },
  );

  // ── GET /v1/protocols/:protocolId/pdf ────────────────────────────────────
  app.get(
    '/v1/protocols/:protocolId/pdf',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Protocols'],
        summary: 'PDF protokolu (on-demand render)',
        description:
          'Vyrenderuje PDF protokolu zo záznamu a vráti ho ako application/pdf. ' +
          'Render je deterministický — rovnaký záznam → vždy identický PDF. ' +
          'pdfSha256 sa dopočíta a uloží po prvom stiahnutí (lazy). ' +
          'Prístupné účastníkovi protokolu alebo ASSET_MANAGER/ADMIN.',
        security: [{ bearerAuth: [] }],
        params: ProtocolIdParamsSchema,
        // Bez response schema — Fastify nesmie serializovať binary stream
      },
    },
    async (request, reply) => {
      const actor = request.currentUser;
      const tenantId = String(actor.organisationId);
      const { protocolId } = request.params;

      const protocol = await protocolsRepo.findById(tenantId, protocolId);
      if (!protocol) throw new NotFoundError('LoanProtocol', protocolId);

      assertCanAccessProtocol(protocol, actor);

      // Načítaj Organisation pre hlavičku (logo + identita)
      const org = await loadOrganisation(fastify.mongo.db, tenantId);
      if (!org) throw new NotFoundError('Organisation', tenantId);

      // Načítaj logo + font (mimo transakcie — bezpečné)
      const [logo, font] = await Promise.all([loadLogo(org), loadDefaultFont()]);

      // Render PDF (deterministický)
      const pdfBytes = await renderProtocolPdf(protocol, org, font, logo);

      // Lazy pdfSha256: dopočítaj a ulož ak ešte null (background, neblokuje response)
      if (!protocol.pdfSha256) {
        const sha256 = computeSha256(pdfBytes);
        void protocolsRepo
          .update(tenantId, protocolId, {
            pdfSha256: sha256,
            updatedAt: new Date().toISOString(),
            updatedBy: String(actor._id),
          })
          .catch(() => {
            /* non-critical — nabudúce sa pokúsi znova */
          });
      }

      return sendPdf(reply, pdfBytes, `protokol-${protocol.protocolNumber}.pdf`);
    },
  );

  // ── POST /v1/protocols/:protocolId/sign ──────────────────────────────────
  app.post(
    '/v1/protocols/:protocolId/sign',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Protocols'],
        summary: 'Podpísať protokol (CLICK_TO_SIGN)',
        description:
          'Zapíše podpis prihlásená strana (handover alebo receive). ' +
          'Keď sú obe strany podpísané, protokol prejde DRAFT → SIGNED ' +
          'a pdfSha256 sa fixuje (hash záväznej podpísanej verzie). ' +
          'Každá strana môže podpísať len svoju rolu.',
        security: [{ bearerAuth: [] }],
        params: ProtocolIdParamsSchema,
        body: SignBodySchema,
        response: { 200: SingleResponseSchema },
      },
    },
    async (request) => {
      const actor = request.currentUser;
      const tenantId = String(actor.organisationId);
      const actorId = String(actor._id);
      const { protocolId } = request.params;
      const now = new Date().toISOString();

      const protocol = await protocolsRepo.findById(tenantId, protocolId);
      if (!protocol) throw new NotFoundError('LoanProtocol', protocolId);

      if (protocol.status !== 'DRAFT') {
        throw new ForbiddenError(
          `Protokol nie je v stave DRAFT (aktuálny stav: ${protocol.status}).`,
        );
      }

      // Zisti, ktorú stranu actor reprezentuje
      const isHandoverParty = String(protocol.parties.handover.userId) === actorId;
      const isReceiveParty = String(protocol.parties.receive.userId) === actorId;

      if (!isHandoverParty && !isReceiveParty) {
        throw new ForbiddenError('Nie si priamym účastníkom tohto protokolu — nemôžeš podpísať.');
      }

      const ipAddress = getClientIp(request.ip);
      const newSignatures = { ...protocol.signatures };
      let signedSide: 'handover' | 'receive';

      // K6: fixovať reálny snapshot podpisujúcej strany v čase podpisu.
      // K4 vkladá pri borrowerovi prázdny snapshot (bez DB lookupu v tx) —
      // tu ho doplníme z aktuálneho aktéra, aby SIGNED PDF malo reálne mená.
      const newParties: LoanProtocol['parties'] = {
        handover: { ...protocol.parties.handover },
        receive: { ...protocol.parties.receive },
      };
      const actorSnapshot = {
        displayName: (actor as { displayName?: string }).displayName ?? '',
        email: (actor as { email?: string }).email ?? '',
        organizationalUnit: null,
      };

      if (isHandoverParty && !protocol.signatures.handover) {
        newSignatures.handover = {
          signedAt: now,
          method: 'CLICK_TO_SIGN',
          ipAddress,
          signatureImageId: null,
        };
        if (!newParties.handover.snapshot.displayName) {
          newParties.handover = { ...newParties.handover, snapshot: actorSnapshot };
        }
        signedSide = 'handover';
      } else if (isReceiveParty && !protocol.signatures.receive) {
        newSignatures.receive = {
          signedAt: now,
          method: 'CLICK_TO_SIGN',
          ipAddress,
          signatureImageId: null,
        };
        if (!newParties.receive.snapshot.displayName) {
          newParties.receive = { ...newParties.receive, snapshot: actorSnapshot };
        }
        signedSide = 'receive';
      } else {
        throw new ForbiddenError('Táto strana protokolu už podpísala.');
      }

      // Keď obe strany podpísané → SIGNED + fixovať pdfSha256
      const bothSigned = newSignatures.handover !== null && newSignatures.receive !== null;
      let newStatus: LoanProtocol['status'] = protocol.status;
      let pdfSha256 = protocol.pdfSha256;

      if (bothSigned) {
        newStatus = 'SIGNED';
        // Fixovať hash záväznej podpísanej verzie (render s novými podpismi)
        const org = await loadOrganisation(fastify.mongo.db, tenantId);
        if (org) {
          const [logo, font] = await Promise.all([loadLogo(org), loadDefaultFont()]);
          const protocolWithSigs: LoanProtocol = {
            ...(protocol as unknown as LoanProtocol),
            parties: newParties,
            signatures: newSignatures as LoanProtocol['signatures'],
            status: 'SIGNED',
          };
          const pdfBytes = await renderProtocolPdf(protocolWithSigs, org, font, logo);
          pdfSha256 = computeSha256(pdfBytes);
        }
      }

      const updated = await protocolsRepo.update(tenantId, protocolId, {
        parties: newParties,
        signatures: newSignatures as LoanProtocol['signatures'],
        status: newStatus,
        pdfSha256,
        updatedAt: now,
        updatedBy: actorId,
      });

      if (!updated) throw new NotFoundError('LoanProtocol', protocolId);

      // Audit (EU compliance): podpis protokolu je kľúčová právna udalosť —
      // kto, kedy, akým spôsobom, z akej IP potvrdil prevzatie/vrátenie majetku.
      // Logujeme KAŽDÝ podpis zvlášť (nie len finálny prechod DRAFT→SIGNED),
      // aby bol zachytený aj podpis prvej strany v čase.
      await fastify.auditLog.record(actor, request, {
        action: 'LOAN_PROTOCOL_SIGNED',
        target: {
          entityType: 'LoanProtocol',
          entityId: protocolId,
          snapshot: {
            protocolNumber: protocol.protocolNumber,
            protocolType: protocol.type,
            loanId: String(protocol.loanId),
            signedSide,
            method: 'CLICK_TO_SIGN',
            transitionedToSigned: bothSigned,
          },
        },
        description:
          signedSide === 'handover'
            ? 'Odovzdávajúca strana podpísala preberací protokol.'
            : 'Preberajúca strana podpísala preberací protokol.',
        metadata: { ipAddress, bothSigned, newStatus },
      });

      return protocolToApiShape(updated);
    },
  );
};

// ---------------------------------------------------------------------------
// Pomocné funkcie
// ---------------------------------------------------------------------------

function assertCanAccessProtocol(
  protocol: WithId<LoanProtocol>,
  actor: { _id: unknown; role: UserRole },
): void {
  const actorId = String(actor._id);
  const isHandover = String(protocol.parties.handover.userId) === actorId;
  const isReceive = String(protocol.parties.receive.userId) === actorId;
  if (!isHandover && !isReceive && !isManagerOrAdmin(actor)) {
    throw new ForbiddenError('Nemáš oprávnenie zobraziť tento protokol.');
  }
}

export function isManagerOrAdmin(actor: { role: UserRole }): boolean {
  // ADR-0029: autoritatívna rola je actor.role (z Membership), nie legacy
  // actor.roles[] (User.roles), ktoré je na produkcii u časti dokumentov `null`
  // (pozri auth.ts) — priamy .includes() na ňom bez tejto opravy hodí
  // TypeError a rozbije /v1/protocols aj /v1/dashboard/summary.
  return roleSatisfies(actor.role, UserRole.ASSET_MANAGER);
}

export function protocolToApiShape(doc: WithId<LoanProtocol>): Record<string, unknown> {
  return { ...doc, _id: String(doc._id) };
}

/**
 * Response-only enrichment prázdnych snapshotov strán.
 *
 * K4 vkladá pri borrowerovi prázdny snapshot (displayName: ''). Kým strana
 * nepodpíše (kedy sa snapshot fixuje), zoznamy by ukazovali prázdne mená.
 * Tu pre response doplníme aktuálne mená z users collection — DB dokument
 * sa NEMENÍ (snapshot fixuje až podpis).
 */
export async function enrichPartySnapshots(
  db: Db,
  protocols: WithId<LoanProtocol>[],
): Promise<Record<string, unknown>[]> {
  const missingUserIds = new Set<string>();
  for (const p of protocols) {
    for (const side of ['handover', 'receive'] as const) {
      const party = p.parties[side];
      if (!party.snapshot.displayName && ObjectId.isValid(String(party.userId))) {
        missingUserIds.add(String(party.userId));
      }
    }
  }

  const nameMap = new Map<string, { displayName: string; email: string }>();
  if (missingUserIds.size > 0) {
    const docs = await db
      .collection('users')
      .find({ _id: { $in: [...missingUserIds].map((id) => new ObjectId(id) as never) } })
      .toArray();
    for (const doc of docs) {
      nameMap.set(String(doc['_id']), {
        displayName: (doc['displayName'] as string | undefined) ?? '',
        email: (doc['email'] as string | undefined) ?? '',
      });
    }
  }

  return protocols.map((p) => {
    const shape = protocolToApiShape(p);
    const parties = structuredClone(p.parties) as LoanProtocol['parties'];
    for (const side of ['handover', 'receive'] as const) {
      const party = parties[side];
      if (!party.snapshot.displayName) {
        const found = nameMap.get(String(party.userId));
        if (found) {
          party.snapshot = { ...party.snapshot, ...found };
        }
      }
    }
    return { ...shape, parties };
  });
}

function computeSha256(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function getClientIp(ip: string): string {
  return ip.replace(/^::ffff:/, '');
}

async function sendPdf(
  reply: FastifyReply,
  bytes: Uint8Array,
  filename: string,
): Promise<FastifyReply> {
  return reply
    .header('Content-Type', 'application/pdf')
    .header('Content-Disposition', `inline; filename="${filename}"`)
    .header('Content-Length', String(bytes.byteLength))
    .header('Cache-Control', 'private, no-cache')
    .send(Buffer.from(bytes));
}

async function loadOrganisation(db: Db, organisationId: string): Promise<Organisation | null> {
  if (!ObjectId.isValid(organisationId)) return null;
  const doc = await db
    .collection('organisations')
    .findOne({ _id: new ObjectId(organisationId) as never });
  return doc as Organisation | null;
}

export default fp(protocolsRoutes, {
  name: 'protocols-routes',
  dependencies: ['mongo', 'auth', 'audit', 'loan-requests-routes'],
});
