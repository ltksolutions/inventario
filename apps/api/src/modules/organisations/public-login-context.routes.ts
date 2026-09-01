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
 * Rate-limited 30/min na kľúč (IP + slug/domain) — rovnaká hodnota ako
 * `GET /v1/public/scan/:token`, ale NIE čisto per-IP (nezávislá bezpečnostná
 * revízia ADR-0035 F4): `apps/web/middleware.ts` volá tento endpoint
 * server-to-server z (málo) zdieľaných Vercel edge egress IP adries pre
 * VŠETKY vlastné domény naraz. Čistý per-IP limit by tak jedno "horúce"
 * volanie mohol vyčerpať pre všetkých ostatných tenantov naraz. Kľúč
 * `${ip}:${slug ?? domain}` viaže limit na dvojicu (zdroj, cieľ).
 */

import { HexColorSchema } from '@inventario/shared-types';
import fp from 'fastify-plugin';
import { z } from 'zod';

import { OrganisationsRepository } from './organisations.repository.js';

import type { AuthProvider } from '@inventario/shared-types';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const PublicLoginContextResponseSchema = z
  .object({
    /**
     * ADR-0035 F6: potrebné pre OAuth `?org=<slug>` hint (ADR-0031) na
     * `/tenant-login` — vlastná doména pozná len `domain`, nie `slug`, ale
     * OAuth routing ešte stále pracuje s hint-om `?org=<slug>`. Nie je to
     * citlivý údaj — slug je verejný sám o sebe už v `?org=<slug>` odkazoch.
     */
    slug: z.string(),
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
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest): string => {
            const query = req.query as { slug?: string; domain?: string };
            return `${req.ip}:${query.slug ?? query.domain ?? ''}`;
          },
        },
      },
      schema: {
        tags: ['Public'],
        summary: 'Verejný login-context organizácie podľa slugu alebo vlastnej domény (ADR-0035)',
        // Zámerne verejný endpoint — prázdne `security` to hovorí
        // explicitne. Bez toho Redocly hlási chýbajúcu deklaráciu
        // (pravidlo security-defined) a nedá sa odlíšiť „verejné
        // zámerne" od „zabudli sme".
        security: [],
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
        slug: org.slug,
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
