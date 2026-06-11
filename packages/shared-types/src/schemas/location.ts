// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { z } from 'zod';

import { LocationType } from '../enums/location-type.js';

import {
  BaseDocumentSchema,
  ObjectIdSchema,
  OrganisationScopedSchema,
  SoftDeleteSchema,
} from './common.js';

/**
 * Lokalita = fyzické miesto, kde sa majetok nachádza.
 *
 * Typy lokalít sú definované v `LocationType` enum (viď `enums/location-type.ts`).
 */
export const LocationSchema = BaseDocumentSchema.merge(SoftDeleteSchema)
  .merge(OrganisationScopedSchema)
  .extend({
    /** Názov lokality. */
    name: z.string().min(1).max(200).trim(),

    /**
     * Slug pre URL (auto-generated z name pri POST, ak nie je dodaný).
     * Príklad: "Centrála Bratislava" → "centrala-bratislava".
     */
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug musí byť lowercase s pomlčkami.')
      .max(200),

    /** Typ lokality. */
    type: z.enum(Object.values(LocationType) as [string, ...string[]]) as z.ZodType<LocationType>,

    /** Voliteľná adresa. */
    address: z
      .object({
        street: z.string().max(200).optional(),
        city: z.string().max(100).optional(),
        postalCode: z.string().max(20).optional(),
        country: z.string().length(2).default('SK'), // ISO 3166-1 alpha-2
      })
      .nullable()
      .default(null),

    /** GPS súradnice (voliteľné). */
    coordinates: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .nullable()
      .default(null),

    /** ID nadradenej lokality (pre hierarchiu: sklad → konkrétna polica). */
    parentId: ObjectIdSchema.nullable().default(null),

    /** Voliteľný popis (otváracie hodiny, kontakt, špeciálne pravidlá). */
    description: z.string().max(2000).nullable().default(null),

    /** ID správcu lokality. */
    managerId: ObjectIdSchema.nullable().default(null),

    /** Či je lokalita aktívna. */
    isActive: z.boolean().default(true),
  });

export type Location = z.infer<typeof LocationSchema>;

export const CreateLocationSchema = LocationSchema.omit({
  _id: true,
  organisationId: true, // Server-provided from authenticated context
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
});

export type CreateLocationInput = z.infer<typeof CreateLocationSchema>;

/**
 * Patch schéma pre update lokality. Všetky polia voliteľné — caller posiela
 * iba tie, ktoré chce zmeniť. `slug` je voliteľné v PATCH (na rozdiel od
 * povinnosti v `LocationSchema`) — keď nie je v body, zostáva ako predtým.
 *
 * Audit + identity polia (`_id`, `organisationId`, `createdAt`, `createdBy`,
 * `updatedAt`, `updatedBy`, `deletedAt`, `deletedBy`) sú vylúčené —
 * spravuje ich server.
 */
export const UpdateLocationSchema = LocationSchema.omit({
  _id: true,
  organisationId: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
}).partial();

export type UpdateLocationInput = z.infer<typeof UpdateLocationSchema>;
