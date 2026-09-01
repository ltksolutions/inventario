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

/**
 * Normalizácia voľného textu (Popis, Účel, Poznámka, Dôvod zamietnutia...).
 *
 * Rieši typický problém pri vložení textu skopírovaného z webovej stránky
 * alebo iného dokumentu — rozbité zalomenia riadkov a neviditeľné znaky,
 * ktoré kazia layout aj tlač (protokoly, PDF):
 *   1. nedeliteľná medzera (U+00A0) → normálna medzera
 *   2. CRLF → LF
 *   3. orezanie medzier/tabulátorov na konci každého riadku
 *   4. 3 a viac prázdnych riadkov za sebou → max 1 prázdny riadok
 *   5. orezanie okrajových medzier/riadkov na začiatku a konci celého textu
 *
 * Zámerne NEODSTRAŇUJE jednotlivé zalomenia riadkov (odseky, zoznamy) —
 * čistí len nadbytočné/neviditeľné znaky, nie zámerné formátovanie textu.
 * Použité aj priamo (bez Zod) v deploy-time migrácii pre backfill existujúcich dát.
 */
export function normalizeFreeText(value: string): string {
  return value
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Voľné textové pole (Popis, Účel, Poznámka...) s normalizáciou pri uložení
 * cez `normalizeFreeText`. Validácia dĺžky beží AŽ PO normalizácii cez
 * `.pipe()` (rovnaký vzor ako `TagSchema`).
 *
 * Vracia „holú" string schému bez `.nullable()`/`.optional()`/`.default()` —
 * tie sa reťazia na volajúcej strane podľa konkrétneho poľa (rovnako ako
 * predtým s `z.string()`), aby sa nemenila existujúca sémantika jednotlivých
 * polí (niektoré sú nullable+default, iné optional, iné povinné).
 */
export function freeText(
  max: number,
  opts: { min?: number; minMessage?: string; maxMessage?: string } = {},
) {
  const min = opts.min ?? 0;
  return z
    .string()
    .transform((val) => normalizeFreeText(val))
    .pipe(
      z
        .string()
        .min(min, opts.minMessage ?? `Text musí mať aspoň ${min} znakov.`)
        .max(max, opts.maxMessage ?? `Text môže mať najviac ${max} znakov.`),
    );
}

/**
 * Binárny obsah uložený priamo v Mongu ako BinData (ADR-0037).
 *
 * `z.custom` a nie `z.instanceof(Buffer)`: tento balík importuje aj web,
 * kde globálny `Buffer` neexistuje. `Buffer` rozširuje `Uint8Array`, takže
 * ten istý test platí na oboch stranách.
 */
export const BinaryDataSchema = z.custom<Uint8Array>((value) => value instanceof Uint8Array, {
  message: 'Očakáva sa binárny obsah (Buffer/Uint8Array).',
});

export type BinaryData = z.infer<typeof BinaryDataSchema>;

/**
 * Malý rasterový obrázok uložený v dokumente — náhľad prílohy alebo logo
 * organizácie (ADR-0037).
 *
 * Do dokumentu patria len MALÉ obrázky: náhľad ~300 KB, logo ≤512 KB. Idú
 * tak do zálohy spolu s dátami, ktoré popisujú, a nepotrebujú podpísanú URL.
 * Originály sem NEPATRIA — strop dokumentu je 16 MB a binárka v doméne vlečie
 * megabajty v každom výpise, ktorý zabudne `projection`.
 */
export const StoredImageSchema = z.object({
  data: BinaryDataSchema,
  mimeType: z.string().regex(/^image\/(jpeg|png|webp|svg\+xml)$/, 'Nepodporovaný formát obrázka.'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sizeBytes: z.number().int().positive(),
});

export type StoredImage = z.infer<typeof StoredImageSchema>;
