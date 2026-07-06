// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { z } from 'zod';

/**
 * MongoDB ObjectId vo formáte 24-znakového hex stringu.
 *
 * V API a JSON serializácii ho posielame ako string. V dátovej vrstve
 * Mongo driver ho automaticky konvertuje na BSON ObjectId.
 */
export const ObjectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Neplatný formát ObjectId (očakáva sa 24 hex znakov).')
  .describe('MongoDB ObjectId (24 hex znakov)');

export type ObjectId = z.infer<typeof ObjectIdSchema>;

/**
 * ISO 8601 timestamp ako string. Vždy v UTC, formát `YYYY-MM-DDTHH:mm:ss.sssZ`.
 *
 * Mongo driver pri serializácii konvertuje JS `Date` ↔ string.
 */
export const TimestampSchema = z
  .string()
  .datetime({ offset: true })
  .describe('ISO 8601 timestamp v UTC');

export type Timestamp = z.infer<typeof TimestampSchema>;

/**
 * Audit polia, ktoré má každý dokument.
 *
 * `createdAt` / `updatedAt` — automaticky nastavované repository vrstvou.
 * `createdBy` / `updatedBy` — ID používateľa, ktorý záznam vytvoril/zmenil.
 *   Pre systémové akcie (seedy, batch joby) je hodnota "SYSTEM".
 */
export const AuditFieldsSchema = z.object({
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  createdBy: z.union([ObjectIdSchema, z.literal('SYSTEM')]),
  updatedBy: z.union([ObjectIdSchema, z.literal('SYSTEM')]),
});

export type AuditFields = z.infer<typeof AuditFieldsSchema>;

/**
 * Identifikačné polia spoločné pre väčšinu dokumentov.
 */
export const BaseDocumentSchema = z
  .object({
    _id: ObjectIdSchema,
  })
  .merge(AuditFieldsSchema);

export type BaseDocument = z.infer<typeof BaseDocumentSchema>;

/**
 * Soft delete podpora — pre dokumenty, ktoré sa nemažú fyzicky.
 */
export const SoftDeleteSchema = z.object({
  deletedAt: TimestampSchema.nullable().default(null),
  deletedBy: z
    .union([ObjectIdSchema, z.literal('SYSTEM')])
    .nullable()
    .default(null),
});

export type SoftDelete = z.infer<typeof SoftDeleteSchema>;

/**
 * Multi-tenant scoping mixin.
 *
 * Every domain document (asset, category, location, user, audit log)
 * carries an `organisationId` referencing exactly one Organisation.
 * Backend repositories filter on this field automatically via
 * `OrganisationScopedRepository`, so no query can accidentally span
 * tenants. See ADR-0010 for the multi-tenant rationale.
 *
 * The `Organisation` collection itself does NOT use this mixin — it is
 * the root of the tenancy graph and has no parent tenant.
 */
export const OrganisationScopedSchema = z.object({
  /** ID of the tenant this document belongs to. Required on every domain document. */
  organisationId: ObjectIdSchema,
});

export type OrganisationScoped = z.infer<typeof OrganisationScopedSchema>;

/**
 * Slovenský telefón vo formáte +421 9XX XXX XXX alebo 09XX XXX XXX.
 *
 * Normalizácia na +421 formát sa robí v parsovacej fáze (pre konzistenciu v DB).
 */
export const PhoneSchema = z
  .string()
  .regex(
    /^(\+421|0)\s?9\d{2}\s?\d{3}\s?\d{3}$/,
    'Telefón musí byť vo formáte +421 9XX XXX XXX alebo 09XX XXX XXX.',
  )
  .transform((val) => {
    // Normalizuj na +421 formát bez medzier
    const digits = val.replace(/\s/g, '');
    if (digits.startsWith('0')) {
      return `+421${digits.slice(1)}`;
    }
    return digits;
  })
  .describe('Slovenský mobilný telefón');

export type Phone = z.infer<typeof PhoneSchema>;

/**
 * E-mail s normalizáciou na lowercase.
 */
export const EmailSchema = z
  .string()
  .email('Neplatný formát e-mailovej adresy.')
  .toLowerCase()
  .max(255, 'E-mail je príliš dlhý (max 255 znakov).');

export type Email = z.infer<typeof EmailSchema>;

/**
 * Poštová adresa. Re-použiteľná pre sídlo firmy, korešpondenčnú adresu
 * a do budúcna pre dodacie adresy a pod.
 *
 * `countryCode` je ISO 3166-1 alpha-2 (napr. "SK", "CZ", "AT"), default "SK".
 * Štruktúra zodpovedá slovenskej adresnej konvencii (ulica + číslo zvlášť
 * od mesta a PSČ), ale je dostatočne všeobecná pre EU adresy.
 */
export const AddressSchema = z
  .object({
    /** Ulica a popisné/orientačné číslo. Napr. "Trnavská cesta 123". */
    street: z.string().min(1, 'Ulica je povinná.').max(200).trim(),
    /** Mesto / obec. */
    city: z.string().min(1, 'Mesto je povinné.').max(120).trim(),
    /** PSČ. Free-form max 16 znakov — neviažeme na SK formát kvôli EU adresám. */
    postalCode: z.string().min(1, 'PSČ je povinné.').max(16).trim(),
    /** ISO 3166-1 alpha-2 kód krajiny. Default "SK". */
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/, 'Kód krajiny musí byť ISO 3166-1 alpha-2 (napr. SK).')
      .default('SK'),
  })
  .strict();

export type Address = z.infer<typeof AddressSchema>;

/**
 * Slovenské IČO — 8 číslic.
 */
export const IcoSchema = z
  .string()
  .regex(/^\d{8}$/, 'IČO musí mať presne 8 číslic.')
  .describe('IČO (8 číslic)');

export type Ico = z.infer<typeof IcoSchema>;

/**
 * Slovenské DIČ — 10 číslic.
 */
export const DicSchema = z
  .string()
  .regex(/^\d{10}$/, 'DIČ musí mať presne 10 číslic.')
  .describe('DIČ (10 číslic)');

export type Dic = z.infer<typeof DicSchema>;

/**
 * IČ DPH — "SK" + 10 číslic. Iba pre platiteľov DPH.
 *
 * Normalizácia: odstráni medzery, zveľkopísmení predponu SK.
 */
export const IcDphSchema = z
  .string()
  .transform((val) => val.replace(/\s/g, '').toUpperCase())
  .pipe(z.string().regex(/^SK\d{10}$/, 'IČ DPH musí byť vo formáte SK + 10 číslic.'))
  .describe('IČ DPH (SK + 10 číslic)');

export type IcDph = z.infer<typeof IcDphSchema>;

/**
 * IBAN — medzinárodný formát bankového účtu.
 *
 * Validuje sa formát (2 písmená krajiny + 2 kontrolné číslice + BBAN),
 * nie mod-97 kontrolný súčet — tú prípadnú validáciu doplníme pri
 * generovaní faktúr ak bude treba. Normalizácia: bez medzier, uppercase.
 */
export const IbanSchema = z
  .string()
  .transform((val) => val.replace(/\s/g, '').toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, 'Neplatný formát IBAN.'))
  .describe('IBAN (bez medzier, uppercase)');

export type Iban = z.infer<typeof IbanSchema>;

/**
 * Hex farba vo formáte #RRGGBB (6 číslic, bez skrateného #RGB).
 *
 * Používa sa pre brand-kit farby (`primary`, `accent`, `logoDot`, ...).
 * Validácia je case-insensitive (`#1a2d47` aj `#1A2D47` sú platné),
 * ale DB ukladá hodnoty tak ako prídu — UI by mal posielať lowercase.
 *
 * Príklady platných hodnôt: `#1A2D47`, `#ffffff`, `#388fc3`.
 */
export const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Farba musí byť hex #RRGGBB (napr. #1A2D47).')
  .describe('Hex farba #RRGGBB');

export type HexColor = z.infer<typeof HexColorSchema>;

/**
 * Tag (štítok) na majetku — voľný text s vynútenou normalizáciou na
 * serveri, aby rovnaký tag napísaný rôzne (veľkosť písmen, medzery)
 * nevytváral duplicitné varianty naprieč majetkami.
 *
 * Normalizácia (transform, aplikuje sa VŽDY, nielen kozmeticky v UI):
 *   1. orezanie medzier na začiatku/konci (`trim`)
 *   2. zbalenie viacnásobných medzier vnútri na jednu (`"a   b" → "a b"`)
 *   3. prevod na malé písmená (`toLowerCase`)
 *
 * Viacslovné tagy (napr. "športové vybavenie") sú zámerne povolené —
 * jeden tag s medzerou, nie pomlčky/podčiarkovníky.
 *
 * Validácia dĺžky (1–50 znakov) beží AŽ PO normalizácii cez `.pipe()`.
 */
export const TagSchema = z
  .string()
  .transform((val) => val.trim().replace(/\s+/g, ' ').toLowerCase())
  .pipe(z.string().min(1, 'Tag nesmie byť prázdny.').max(50, 'Tag môže mať najviac 50 znakov.'))
  .describe('Normalizovaný tag (trim, zbalené medzery, malé písmená)');

export type Tag = z.infer<typeof TagSchema>;
