// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Labels routes — HTTP endpoints pre QR štítky (ADR-0027 L4).
 *
 * RBAC: EMPLOYEE+ pre všetky endpointy (čítanie je dovolené každému
 * autentifikovanému členovi tenanta).
 *
 * Cross-tenant izolácia: assets sa načítavajú cez AssetsRepository
 * s `organisationId` z auth tokenu — iný tenant vráti 404.
 *
 * Endpointy:
 *   GET  /v1/labels/sheet?assetIds=id1,id2,...&preset=avery-l7160
 *     → Avery PDF hárok (application/pdf), on-demand.
 *
 *   GET  /v1/assets/:id/label?format=zpl
 *     → ZPL string pre jeden štítok (text/plain), on-demand.
 *
 *   POST /v1/labels/zpl  { assetIds: [...] }
 *     → JSON { labels: [{ assetId, zpl }] } pre dávku štítkov.
 *
 * On-demand princíp (ADR-0021/0022/0027): žiadna persistencia,
 * žiadne ukladanie artefaktov — vždy generujeme zo živých dát.
 */

import fp from 'fastify-plugin';
import { ObjectId } from 'mongodb';
import { z } from 'zod';

import { resolveAppBaseUrl } from '../../lib/app-base-url.js';
import { NotFoundError } from '../../plugins/error-handler.js';
import { AssetsRepository } from '../assets/assets.repository.js';
import { OrganisationsRepository } from '../organisations/organisations.repository.js';
import { loadDefaultFont, loadLogo } from '../protocols/logo-loader.js';

import { LABEL_PRESETS, renderLabelSheetPdf } from './label-sheet-renderer.js';
import { renderLabelZpl } from './label-zpl-renderer.js';

import type { LabelAssetInput } from './label-sheet-renderer.js';
import type { ZplAssetInput } from './label-zpl-renderer.js';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const AssetIdParamSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát ID.'),
});

const SheetQuerySchema = z.object({
  /** Čiarkou oddelené asset IDs (max 200). */
  assetIds: z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    )
    .refine((ids) => ids.length >= 1 && ids.length <= 200, {
      message: 'assetIds musí obsahovať 1–200 ID.',
    })
    .refine((ids) => ids.every((id) => /^[a-f\d]{24}$/i.test(id)), {
      message: 'Každé assetId musí byť 24-znakový hex reťazec.',
    }),
  /** Preset rozloženia hárka. Default avery-l7160. */
  preset: z.enum(['avery-l7160', 'avery-l7163']).default('avery-l7160'),
});

const ZplQuerySchema = z.object({
  format: z.literal('zpl'),
});

const ZplBatchBodySchema = z.object({
  assetIds: z
    .array(z.string().regex(/^[a-f\d]{24}$/i))
    .min(1, 'assetIds musí obsahovať aspoň 1 ID.')
    .max(200, 'assetIds môže obsahovať max 200 ID.'),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const labelsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const assetsRepo = new AssetsRepository(fastify.mongo.db);
  const orgsRepo = new OrganisationsRepository(fastify.mongo.db);

  const canRead = fastify.requireRole(['EMPLOYEE', 'ASSET_MANAGER', 'ADMIN', 'EXTERNAL']);

  // ── GET /v1/labels/sheet ─────────────────────────────────────────────────
  app.get(
    '/v1/labels/sheet',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Labels'],
        summary: 'Avery PDF hárok so štítkami (on-demand)',
        description:
          'Vygeneruje PDF s mriežkou QR štítkov pre zvolené assety. ' +
          'Každý štítok obsahuje QR kód (appBaseUrl/scan/publicToken), inventoryNumber a názov. ' +
          'Preset avery-l7160: 3×8 = 24 štítkov/A4 (default). ' +
          'Preset avery-l7163: 2×7 = 14 štítkov/A4. ' +
          'Vyžaduje nastavený appBaseUrl na Organisation — inak 409.',
        security: [{ bearerAuth: [] }],
        querystring: SheetQuerySchema,
        // Bez response schema — binary stream
      },
    },
    async (request, reply) => {
      const actor = request.currentUser;
      const tenantId = String(actor.organisationId);
      const { assetIds, preset } = request.query;

      // Načítaj org pre appBaseUrl + logo + labelPrinting config
      const orgRaw = await orgsRepo.findById(tenantId);
      if (!orgRaw) throw new NotFoundError('Organisation', tenantId);
      // appBaseUrl: per-tenant → env → default (ADR-0021, z konfigurácie nie z Host).
      const org = { ...orgRaw, appBaseUrl: resolveAppBaseUrl(orgRaw.appBaseUrl) };

      // Načítaj assety — všetky musia patriť tomuto tenantovi
      const labelAssets: LabelAssetInput[] = [];
      for (const assetId of assetIds) {
        if (!ObjectId.isValid(assetId)) continue;
        const asset = await assetsRepo.findById(tenantId, assetId);
        if (!asset) {
          return reply.status(404).send({ message: `Asset '${assetId}' neexistuje.` });
        }
        labelAssets.push({
          _id: String(asset._id),
          inventoryNumber: asset.inventoryNumber,
          name: asset.name,
          publicToken: asset.publicToken,
        });
      }

      if (labelAssets.length === 0) {
        return reply.status(400).send({ message: 'Žiadne platné assety.' });
      }

      // Verifikuj preset (pre type safety — Zod ho už overil)
      const presetKey = preset as keyof typeof LABEL_PRESETS;
      if (!(presetKey in LABEL_PRESETS)) {
        return reply.status(400).send({ message: `Neznámy preset: ${preset}` });
      }

      // Načítaj font + logo (mimo transakcie)
      const [font, logo] = await Promise.all([loadDefaultFont(), loadLogo(org)]);

      // Render PDF
      const pdfBytes = await renderLabelSheetPdf(labelAssets, org, font, logo, presetKey);

      const filename = `stítky-${new Date().toISOString().slice(0, 10)}.pdf`;
      return sendPdf(reply, pdfBytes, filename);
    },
  );

  // ── GET /v1/assets/:id/label?format=zpl ──────────────────────────────────
  app.get(
    '/v1/assets/:id/label',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Labels'],
        summary: 'ZPL string pre jeden štítok (on-demand)',
        description:
          'Vygeneruje ZPL string pre jeden asset. ' +
          'Odovzdajte ho Zebra Browser Print agentovi na doručenie na termotlačiareň. ' +
          'Rozmery a DPI sa berú z Organisation.labelPrinting configu. ' +
          'format=zpl je povinný.',
        security: [{ bearerAuth: [] }],
        params: AssetIdParamSchema,
        querystring: ZplQuerySchema,
        response: {
          200: z.object({ zpl: z.string() }),
        },
      },
    },
    async (request) => {
      const actor = request.currentUser;
      const tenantId = String(actor.organisationId);
      const { id } = request.params;

      const orgRaw = await orgsRepo.findById(tenantId);
      if (!orgRaw) throw new NotFoundError('Organisation', tenantId);
      const org = { ...orgRaw, appBaseUrl: resolveAppBaseUrl(orgRaw.appBaseUrl) };

      const asset = await assetsRepo.findById(tenantId, id);
      if (!asset) throw new NotFoundError('Asset', id);

      const zplInput: ZplAssetInput = {
        inventoryNumber: asset.inventoryNumber,
        name: asset.name,
        publicToken: asset.publicToken,
      };

      const zpl = renderLabelZpl(zplInput, org);
      return { zpl };
    },
  );

  // ── POST /v1/labels/zpl ──────────────────────────────────────────────────
  app.post(
    '/v1/labels/zpl',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Labels'],
        summary: 'ZPL stringy pre dávku štítkov',
        description:
          'Vygeneruje ZPL string pre každý asset v dávke (max 200). ' +
          'Vracia pole { assetId, zpl } — frontend ich odovzdá Browser Print agentovi.',
        security: [{ bearerAuth: [] }],
        body: ZplBatchBodySchema,
        response: {
          200: z.object({
            labels: z.array(z.object({ assetId: z.string(), zpl: z.string() })),
          }),
        },
      },
    },
    async (request) => {
      const actor = request.currentUser;
      const tenantId = String(actor.organisationId);
      const { assetIds } = request.body;

      const orgRaw = await orgsRepo.findById(tenantId);
      if (!orgRaw) throw new NotFoundError('Organisation', tenantId);
      const org = { ...orgRaw, appBaseUrl: resolveAppBaseUrl(orgRaw.appBaseUrl) };

      const labels: Array<{ assetId: string; zpl: string }> = [];

      for (const assetId of assetIds) {
        if (!ObjectId.isValid(assetId)) continue;
        const asset = await assetsRepo.findById(tenantId, assetId);
        if (!asset) continue; // preskočiť nenájdené (batch — nechceme celé zlyhanie)

        const zpl = renderLabelZpl(
          {
            inventoryNumber: asset.inventoryNumber,
            name: asset.name,
            publicToken: asset.publicToken,
          },
          org,
        );
        labels.push({ assetId, zpl });
      }

      return { labels };
    },
  );
};

async function sendPdf(
  reply: FastifyReply,
  bytes: Uint8Array,
  filename: string,
): Promise<FastifyReply> {
  return reply
    .header('Content-Type', 'application/pdf')
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .header('Content-Length', String(bytes.byteLength))
    .header('Cache-Control', 'private, no-cache')
    .send(Buffer.from(bytes));
}

export default fp(labelsRoutes, {
  name: 'labels-routes',
  dependencies: ['mongo', 'auth'],
});
