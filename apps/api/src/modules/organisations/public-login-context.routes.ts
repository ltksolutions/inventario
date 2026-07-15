// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Public login-context route — ADR-0035 Fáza 1 (F1).
 *
 * Verejný, neautentifikovaný endpoint, ktorý rieši `docs/TODO.md` #26:
 * `/login` je dnes globálna, tenant-agnostická stránka, ktorá nevie, ku
 * ktorej organizácii prihlasujúci sa používateľ patrí, takže zobrazuje
 * všetky spôsoby prihlásenia bez ohľadu na `allowedAuthProviders`.
 *
 *   GET /v1/public/organisations/login-context?slug=<slug>
 *   GET /v1/public/organisations/login-context?domain=<customDomain>
 *
 * Presne jeden z `slug`/`domain` musí byť zadaný. Vracia EXPLICITNÝ
 * WHITELIST polí (rovnaký vzor ako `PublicAssetView`, ADR-0021) — nikdy
 * spread/Pick/Omit z plného Organisation dokumentu. Nič citlivé sa
 * nevracia: `entraTenantId` samotný nie, len boolean `hasEntraRestriction`.
 * Žiadne interné ID, e-maily, OAuth credentials a pod.
 *
 * 404 pre neexistujúci slug/doménu aj pre zmazanú organizáciu — rovnaká
 * odpoveď v oboch prípadoch (no-oracle, rovnaký vzor ako public scan).
 *
 * Rate-limited 30/min/IP — rovnaká hodnota ako `GET /v1/public/scan/:token`.
 */

import { HexColorSchema } from '@inventario/shared-types';
import fp from 'fastify-plugin';
import { z } from 'zod';

import { OrganisationsRepository } from './organisations.repository.js';

import type { AuthProvider } from '@inventario/shared-types';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const PublicLoginContextResponseSchema = z
  .object({
    displayName: z.string(),
    logoUrl: z.string().url().nullable(),
    brandColors: z
      .object({
        primary: HexColorSchema.nullable(),
        primaryFg: HexColorSchema.nullable(),
        accent: HexColorSchema.nullable(),
        accentFg: HexColorSchema.nullable(),
      })
      .nullable(),
    /** Presne to, čo `LoginPage.tsx` potrebuje na filtrovanie tlačidiel/formulára. */
    allowedAuthProviders: z.array(z.string()),
    /** Len boolean — nikdy samotný entraTenantId (nie je to potrebné a je to interné). */
    hasEntraRestriction: z.boolean(),
  })
  .strict();

const NotFoundSchema = z.object({ message: z.string() });

const QuerySchema = z
  .object({
    slug: z.string().min(1).max(40).optional(),
    domain: z.string().min(1).max(253).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const publicLoginContextRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const orgsRepo = new OrganisationsRepository(fastify.mongo.db);

  app.get(
    '/v1/public/organisations/login-context',
    {
      config: {
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['Public'],
        summary: 'Verejný login-context organizácie podľa slugu alebo vlastnej domény (ADR-0035)',
        description:
          'Bez autentifikácie. Vracia len neškodné dáta (branding + povolené spôsoby ' +
          'prihlásenia) potrebné na to, aby /login mohol zobraziť správne tlačidlá pre ' +
          'danú organizáciu. Presne jeden z query parametrov (slug/domain) musí byť zadaný.',
        querystring: QuerySchema,
        response: {
          200: PublicLoginContextResponseSchema,
          400: NotFoundSchema,
          404: NotFoundSchema,
        },
      },
    },
    async (request, reply) => {
      const { slug, domain } = request.query;

      if ((slug && domain) || (!slug && !domain)) {
        return reply
          .status(400)
          .send({ message: 'Zadajte presne jeden z parametrov slug/domain.' });
      }

      const org = slug
        ? await orgsRepo.findBySlug(slug)
        : await orgsRepo.findByCustomDomain(domain as string);

      if (!org) {
        // findBySlug/findByCustomDomain už filtrujú deletedAt: null, takže
        // táto 404 pokrýva aj zmazanú org bez extra kontroly (no-oracle).
        return reply.status(404).send({ message: 'Not found.' });
      }

      const view = {
        displayName: org.displayName,
        logoUrl: org.brandKit?.logoUrl ?? null,
        brandColors: org.brandKit
          ? {
              primary: org.brandKit.primary ?? null,
              primaryFg: org.brandKit.primaryFg ?? null,
              accent: org.brandKit.accent ?? null,
              accentFg: org.brandKit.accentFg ?? null,
            }
          : null,
        allowedAuthProviders: org.allowedAuthProviders as AuthProvider[],
        hasEntraRestriction: org.entraTenantId != null,
      };

      return reply.status(200).send(view);
    },
  );
};

export default fp(publicLoginContextRoutesPlugin, {
  name: 'public-login-context-routes',
  dependencies: ['mongo'],
});
