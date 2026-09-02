// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Verejné logo organizácie (ADR-0037, nadväzuje na ADR-0028).
 *
 * Logo je verejná vec — je na prihlasovacej stránke tenanta, teda ho vidí
 * každý ešte pred autentifikáciou. Preto NEMÁ zmysel ho chrániť a MÁ zmysel
 * ho nechať cachovať na CDN.
 *
 * POZOR — táto routa je CDN-cachovaná, takže chyba v tenant scope by bola
 * cachovaná chyba: logo jedného tenanta by sa servírovalo pod slugom iného
 * a nedalo by sa to zmazať jedným deployom. Routa preto vracia VÝLUČNE
 * `brandKit.logo` organizácie nájdenej podľa slugu a nič iné — žiadne
 * meno, žiadne ID, žiadne ďalšie polia dokumentu.
 *
 * Prečo z Monga a nie z Blobu: logo je ≤512 KB, ide do zálohy spolu
 * s tenantom a nepotrebuje podpísanú URL. Podrobnosti v ADR-0037.
 */

import { z } from 'zod';

import { bsonBinaryToBuffer } from '../../lib/bson-binary.js';
import { NotFoundError } from '../../plugins/error-handler.js';

import { OrganisationsRepository } from './organisations.repository.js';

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

/** Ako dlho smie CDN držať logo. Deň je kompromis medzi prenosom a rebrandingom. */
const LOGO_CDN_MAX_AGE_SECONDS = 86_400;

const SlugParamsSchema = z
  .object({
    slug: z.string().min(1).max(40),
  })
  .strict();

const publicOrganisationLogoRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const orgsRepo = new OrganisationsRepository(fastify.mongo.db);

  // ŽIADNA response schéma: `fastify-type-provider-zod` používa response
  // schému aj ako runtime serializér a z Bufferu by spravil JSON.
  app.get(
    '/v1/public/organisations/:slug/logo',
    {
      config: {
        rateLimit: { max: 60, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['Public'],
        summary: 'Logo organizácie podľa slugu (verejné, CDN-cachované)',
        // Zámerne verejný endpoint — prázdne `security` to hovorí explicitne,
        // rovnako ako v `public-login-context.routes.ts`.
        security: [],
        params: SlugParamsSchema,
      },
    },
    async (request, reply) => {
      const { slug } = request.params;

      const organisation = await orgsRepo.findBySlug(slug);
      const logo = organisation?.brandKit?.logo;
      if (!logo) throw new NotFoundError('Logo', slug);

      const etag = `W/"logo-${slug}-${organisation.updatedAt}"`;
      reply.header('Cache-Control', `public, s-maxage=${LOGO_CDN_MAX_AGE_SECONDS}`);
      reply.header('ETag', etag);

      // Helmet dáva globálne `Cross-Origin-Resource-Policy: same-origin`.
      // Tu to musí ísť preč: logo sa načítava cez `<img src>` z appky na
      // inej doméne (app.inventario.estate vs. api.inventario.estate) a taká
      // požiadavka je `no-cors` — CORP by ju zablokovala a na prihlasovacej
      // stránke by logo nebolo. Pri Blob URL to nevadilo, tie CORP nemali.
      // Obsah je verejný, takže uvoľnenie nič neodkrýva.
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');

      if (request.headers['if-none-match'] === etag) {
        return reply.status(304).send();
      }

      reply.header('Content-Type', logo.mimeType);
      return reply.send(bsonBinaryToBuffer(logo.data));
    },
  );
};

export default publicOrganisationLogoRoutes;
