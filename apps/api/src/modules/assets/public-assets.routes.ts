// SPDX-FileCopyrightText: 2026 Jan Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Public assets routes - ADR-0021 K4.
 *
 * Verejny endpoint pre "lost & found" QR scan:
 *   GET /v1/public/scan/:publicToken
 *
 * Bez autentifikacie. Rate-limited 30/min/IP.
 * Opt-in per tenant: ak Organisation.publicAssetLookup = false, vracia 404
 * (rovnaku odpoved ako "not found" — nerevealizujeme existenciu tokenu).
 *
 * Response: PublicAssetView — EXPLICITNY WHITELIST poli (ADR-0021).
 * Mapper je pole po poli, NIE spread/Pick/Omit z plneho Asset dokumentu.
 * Invariant je pokryty snapshot testom K6.
 */

import fp from 'fastify-plugin';
import { z } from 'zod';

import { AssetsRepository } from '../assets/assets.repository.js';
import { OrganisationsRepository } from '../organisations/organisations.repository.js';

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const PublicAssetResponseSchema = z
  .object({
    organisationName: z.string(),
    organisationLogoUrl: z.string().url().nullable(),
    inventoryNumber: z.string(),
    name: z.string(),
    foundContact: z
      .object({
        email: z.string().nullable(),
        phone: z.string().nullable(),
        message: z.string().nullable(),
      })
      .nullable(),
  })
  .strict();

const NotFoundSchema = z.object({ message: z.string() });

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const publicAssetsRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const assetsRepo = new AssetsRepository(fastify.mongo.db);
  const orgsRepo = new OrganisationsRepository(fastify.mongo.db);

  app.get(
    '/v1/public/scan/:publicToken',
    {
      config: {
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['Public'],
        summary: 'Verejny lost & found lookup po QR tokene (ADR-0021)',
        description:
          'Bez autentifikacie. Vracia minimalne informacie o najdenom majetku. ' +
          '404 ak tenant nema zapnuty publicAssetLookup ALEBO token neexistuje (no oracle).',
        params: z.object({
          publicToken: z.string().min(1).max(128),
        }),
        response: {
          200: PublicAssetResponseSchema,
          404: NotFoundSchema,
        },
      },
    },
    async (request, reply) => {
      const { publicToken } = request.params;

      // Krok 1: najdi asset podla tokenu (cross-tenant, deletedAt=null)
      const asset = await assetsRepo.findByPublicToken(publicToken);
      if (!asset) {
        return reply.status(404).send({ message: 'Not found.' });
      }

      // Krok 2: nacitaj org — skontroluj publicAssetLookup
      const org = await orgsRepo.findById(String(asset.organisationId));
      if (!org || !org.publicAssetLookup) {
        // 404 aj pre disabled — nerevealujeme existenciu tokenu
        return reply.status(404).send({ message: 'Not found.' });
      }

      // Krok 3: zostav PublicAssetView — POLE PO POLI, NIE spread (ADR-0021)
      const view = {
        organisationName: org.displayName,
        organisationLogoUrl: org.brandKit?.logoUrl ?? null,
        inventoryNumber: asset.inventoryNumber,
        name: asset.name,
        foundContact:
          org.foundContactInfo != null
            ? {
                email: org.foundContactInfo.email ?? null,
                phone: org.foundContactInfo.phone ?? null,
                message: org.foundContactInfo.message ?? null,
              }
            : null,
      };

      return reply.status(200).send(view);
    },
  );
};

export default fp(publicAssetsRoutesPlugin, {
  name: 'public-assets-routes',
  dependencies: ['mongo'],
});
