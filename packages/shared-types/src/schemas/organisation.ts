import { z } from 'zod';

import { FONT_OPTION_IDS } from '../brand-presets.js';
import { AuthProvider, MemberJoinPolicy, RegistrationMethod } from '../enums/auth-provider.js';
import { OrganisationPlan, OrganisationStatus } from '../enums/organisation-status.js';

import {
  AddressSchema,
  BaseDocumentSchema,
  DicSchema,
  EmailSchema,
  HexColorSchema,
  IbanSchema,
  IcDphSchema,
  IcoSchema,
  ObjectIdSchema,
  PhoneSchema,
  SoftDeleteSchema,
} from './common.js';

/**
 * Organisation = tenant in the multi-tenant Inventario platform.
 *
 * Every domain document (asset, category, location, user, audit log)
 * carries an `organisationId` field referencing exactly one Organisation.
 * The backend enforces tenant scoping via `OrganisationScopedRepository`
 * so no query can accidentally span tenants.
 *
 * See ADR-0010 for multi-tenant rationale. See BRAND.md §8 for the
 * per-tenant brand customisation model. See
 * `@inventario/design-tokens/src/brand-kit.schema.json` for the brand
 * kit payload shape.
 *
 * # Identity sources
 *
 * - **Slug** is the tenant's URL identifier and matches the `data-tenant`
 *   attribute used by design-tokens for runtime brand override. Lowercase
 *   ASCII letters, digits, hyphens. Must be globally unique.
 *
 * - **Entra tenant id** is the Microsoft Entra ID directory id (the `tid`
 *   claim on issued JWTs). Used to map an incoming SSO request to its
 *   Organisation during JIT tenant provisioning. Optional — LOCAL-account
 *   tenants do not have one.
 *
 * # Branding
 *
 * `brandKit` is an embedded object matching the brand-kit JSON schema
 * shipped in `@inventario/design-tokens`. It is rendered into runtime CSS
 * overrides for the tenant. Empty / null means "use Inventario defaults".
 */
export const OrganisationBrandKitSchema = z
  .object({
    /**
     * ID vybraného presetu (ADR-0028 v2). Len UI skratka — backend podľa
     * neho NAPLNÍ primary/primaryFg/accent/accentFg/logoDot. Null = farby
     * neboli nastavené cez preset (alebo legacy custom hodnoty).
     */
    presetId: z.string().max(64).nullable().default(null),
    logoUrl: z.string().url().nullable().default(null),
    faviconUrl: z.string().url().nullable().default(null),
    primary: HexColorSchema.nullable().default(null),
    primaryFg: HexColorSchema.nullable().default(null),
    accent: HexColorSchema.nullable().default(null),
    accentFg: HexColorSchema.nullable().default(null),
    logoDot: HexColorSchema.nullable().default(null), // ADR-0028: default = accent at runtime
    /**
     * Font (ADR-0028 v2) — enum z povolených hodnôt (FONT_OPTION_IDS).
     * Nie voľný string: zabraňuje výberu fontu ktorý sa nenačíta.
     * Null = system-ui default.
     */
    fontFamilySans: z.enum(FONT_OPTION_IDS).nullable().default(null),
  })
  .strict();

export type OrganisationBrandKit = z.infer<typeof OrganisationBrandKitSchema>;

/**
 * Fakturačné a právne údaje tenanta (slovenský / EU kontext).
 *
 * Tieto údaje sú potrebné na vystavenie faktúr. Pre FREE plan môžu
 * zostať prázdne (null) — vyžadujú sa až pri prechode na platený plan,
 * čo presadzuje aplikačná logika (onboarding / billing flow), nie schéma
 * samotná. Schéma teda dovoľuje čiastočné vyplnenie a celý objekt nullable.
 *
 * Poznámka k DPH: `isVatPayer` je zdroj pravdy pre to, či sa na faktúre
 * uplatňuje DPH. `icDph` je povinné iba keď `isVatPayer === true` — túto
 * krížovú validáciu robí billing flow, aby schéma zostala kompozitná.
 */
export const OrganisationBillingSchema = z
  .object({
    /**
     * Obchodné (právne) meno subjektu tak, ako má byť na faktúre.
     * Líši sa od `displayName` — napr. displayName "Inventario" vs
     * legalName "LTK Solutions, s. r. o.".
     */
    legalName: z.string().max(200).trim().nullable().default(null),

    /** IČO (8 číslic). */
    ico: IcoSchema.nullable().default(null),

    /** DIČ (10 číslic). */
    dic: DicSchema.nullable().default(null),

    /** Či je subjekt platiteľom DPH. Riadi uplatnenie DPH na faktúre. */
    isVatPayer: z.boolean().default(false),

    /** IČ DPH (SK + 10 číslic). Povinné len pri platiteľovi DPH (rieši billing flow). */
    icDph: IcDphSchema.nullable().default(null),

    /**
     * Zápis v registri — Obchodný register alebo Živnostenský register.
     * Free-form, napr. "OR OS BA I, odd. Sro, vl. č. 12345/B".
     */
    businessRegistration: z.string().max(300).trim().nullable().default(null),

    /** IBAN pre prípadné dobropisy / vrátenia. Citlivý údaj. */
    iban: IbanSchema.nullable().default(null),

    /**
     * Fakturačný e-mail — kam sa posielajú faktúry. Môže sa líšiť od
     * `primaryContactEmail` (napr. účtovné odd. vs admin tenanta).
     */
    billingEmail: EmailSchema.nullable().default(null),

    /** Sídlo subjektu — fakturačná adresa. */
    registeredAddress: AddressSchema.nullable().default(null),

    /** Korešpondenčná adresa, ak sa líši od sídla. Null = použi sídlo. */
    mailingAddress: AddressSchema.nullable().default(null),
  })
  .strict();

export type OrganisationBilling = z.infer<typeof OrganisationBillingSchema>;

/**
 * Konfigurácia formátu inventárneho čísla — per tenant (ADR-0021 rozhodnutie 7).
 *
 * Server generátor (`assets.service.ts`) z tohto zloží `inventoryNumber`:
 *   includeYear=true:  `{prefix}-{YYYY}-{seq.padStart(padding)}`  napr. "SFZ-2026-0042"
 *   includeYear=false: `{prefix}-{seq.padStart(padding)}`         napr. "SFZ-0042"
 *
 * `prefix` je **jediný zdroj prefixu** — nie je per-request override (rozhodnuté
 * 2026-06-01: solo nasadenie per tenant, jeden kód stačí). `resetYearly` určuje,
 * či sa poradie počíta v rámci roka (true) alebo globálne za celý tenant (false).
 *
 * Pozn.: `padding` má strop 8, aby config nemohol vyrobiť číslo, ktoré regex
 * `inventoryNumber` (\d{3,8}) odmietne.
 */
export const InventoryNumberFormatSchema = z
  .object({
    /** Prefix čísla — 1–5 veľkých ASCII písmen (napr. "SFZ", "LT", "MOB"). */
    prefix: z
      .string()
      .regex(/^[A-Z]{1,5}$/, 'Prefix musí byť 1–5 veľkých ASCII písmen (napr. "SFZ").'),

    /** Počet cifier poradia (zero-padded). 3–8 — strop viazaný na regex `inventoryNumber`. */
    padding: z.number().int().min(1).max(8).default(4),

    /** Či je rok zaradenia súčasťou čísla (PREFIX-ROK-PORADIE vs PREFIX-PORADIE). */
    includeYear: z.boolean().default(true),

    /** Či sa poradie resetuje každý rok (zmysel len pri includeYear=true). */
    resetYearly: z.boolean().default(true),
  })
  .strict();

export type InventoryNumberFormat = z.infer<typeof InventoryNumberFormatSchema>;

/**
 * Kontakt zobrazený vo verejnom „lost & found" pohľade po sken QR (ADR-0021).
 *
 * ⚠️ GDPR: tento kontakt je **verejne viditeľný** komukoľvek, kto naskenuje QR
 * majetku (ak má tenant zapnutý `publicAssetLookup`). Preto **silne odporúčame
 * funkčný / organizačný kontakt** (napr. `najdene@organizacia.sk`, recepcia,
 * správca majetku ako rola) — NIE osobný telefón/email konkrétnej osoby.
 * Tenant je prevádzkovateľ a zodpovedá za to, čo sem vloží; schéma to
 * nevynucuje tvrdo, len navedie cez UI hint.
 */
export const FoundContactInfoSchema = z
  .object({
    /** E-mail na nahlásenie nálezu. Odporúčaný organizačný (napr. najdene@…), nie osobný. */
    email: EmailSchema.nullable().default(null),

    /** Telefón na nahlásenie nálezu. Odporúčaná recepcia/správca, nie osobné číslo. */
    phone: PhoneSchema.nullable().default(null),

    /** Vlastný text pre nálezcu (napr. „Vráťte prosím na recepcii, ďakujeme"). */
    message: z.string().max(500).nullable().default(null),
  })
  .strict();

export type FoundContactInfo = z.infer<typeof FoundContactInfoSchema>;

/**
 * Konfigurácia preberacích protokolov — per tenant (ADR-0022).
 *
 * Používa sa pri vzniku `LoanProtocol` (fulfil / direct loan / return): hodnoty sa
 * **kopírujú do snapshotu** na zázname protokolu, render ich číta odtiaľ — NIE zo živého
 * nastavenia. Tým ostane už vystavený protokol nemenný aj keď tenant neskôr zmení default
 * (kritické pre determinizmus renderu a `pdfSha256`).
 *
 * Logo a identita v hlavičke sa berú z `brandKit.logoUrl` + `billing` (nie odtiaľto).
 * Font je fixný default (DejaVu Sans, embedovaný v API) — zatiaľ bez per-tenant voľby.
 */
export const OrganisationProtocolSettingsSchema = z
  .object({
    /** Veľkosť papiera pre generované protokoly. Default A4 (EU). */
    paperSize: z.enum(['A4', 'LETTER']).default('A4'),
  })
  .strict();

export type OrganisationProtocolSettings = z.infer<typeof OrganisationProtocolSettingsSchema>;

/**
 * Konfigurácia tlače QR štítkov — per tenant (ADR-0027).
 *
 * Default: `null` = PDF_SHEET mód (Avery hárok, funguje na každej tlačiarni).
 * Zebra ZPL je opt-in: tenant nastaví `mode: 'ZEBRA_ZPL'` a vyplní ZPL parametre.
 *
 * `finderText` je per-tenant sprievodný text pod QR pre nálezcu. Default vypnutý.
 * Dáva zmysel len keď má tenant zapnutý `publicAssetLookup` (ADR-0021) — UI to
 * naznačí, ale nevynúti tvrdo.
 */
export const OrganisationLabelSettingsSchema = z
  .object({
    /**
     * Výstupný formát štítkov.
     * PDF_SHEET = Avery-style hárok (default, funguje na každej tlačiarni).
     * ZEBRA_ZPL = natívny ZPL pre termotlačiarne (Zebra ZD420 a pod.).
     */
    mode: z.enum(['PDF_SHEET', 'ZEBRA_ZPL']).default('PDF_SHEET'),

    /**
     * Preset rozloženia Avery hárka (platné len pre PDF_SHEET).
     * avery-l7160: 3×8 = 24 štítkov na A4, 63.5×38.1 mm — najčastejší pre kancelárske štítky.
     * avery-l7163: 2×7 = 14 štítkov na A4, 99.1×38.1 mm — väčšie štítky.
     */
    pdfPreset: z.enum(['avery-l7160', 'avery-l7163']).default('avery-l7160'),

    /**
     * Šírka ZPL štítka v mm (platné len pre ZEBRA_ZPL).
     * Typicky 50 mm pre štandardné Zebra štítky (50×25 mm).
     */
    zplLabelWidthMm: z.number().int().min(10).max(200).default(50),

    /**
     * Výška ZPL štítka v mm (platné len pre ZEBRA_ZPL).
     * Typicky 25 mm pre štandardné Zebra štítky (50×25 mm).
     */
    zplLabelHeightMm: z.number().int().min(10).max(200).default(25),

    /**
     * Rozlíšenie termohlavy v DPI (platné len pre ZEBRA_ZPL).
     * ZD420 = 203 dpi (default). ZD620 a niektoré ZT série = 300 dpi.
     */
    zplDpi: z.union([z.literal(203), z.literal(300)]).default(203),

    /**
     * Sýtosť termotlače 0–30 (platné len pre ZEBRA_ZPL).
     * Vyššia hodnota = tmavší výtlačok. Default 20 (mierne nad stredom).
     */
    zplDarkness: z.number().int().min(0).max(30).default(20),

    /**
     * Sprievodný text pre nálezcu — zobrazí sa pod QR na štítku.
     * Platí pre PDF aj ZPL výstup.
     * Default: vypnutý. Odporúča sa zapnúť spolu s `publicAssetLookup`.
     */
    finderText: z
      .object({
        /** Či sa text zobrazuje na štítku. Default false. */
        enabled: z.boolean().default(false),
        /** Text zobrazený pod QR. Tenant môže zmeniť jazyk/tón. */
        text: z.string().max(120).default('Našli ste ma? Naskenujte a pomôžte ma vrátiť.'),
      })
      .default({ enabled: false, text: 'Našli ste ma? Naskenujte a pomôžte ma vrátiť.' }),
  })
  .strict();

export type OrganisationLabelSettings = z.infer<typeof OrganisationLabelSettingsSchema>;

export const OrganisationSchema = BaseDocumentSchema.merge(SoftDeleteSchema).extend({
  /**
   * Tenant display name. Free-form, shown in UI alongside the wordmark.
   * Examples: "Inventario", "Slovenský futbalový zväz", "Mesto Bratislava".
   */
  displayName: z.string().min(1, 'Display name is required.').max(200).trim(),

  /**
   * Stable slug for the tenant. Used as `data-tenant` value, in URLs,
   * and as the unique business key. Lowercase ASCII letters, digits,
   * hyphens. 2-40 chars.
   */
  slug: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/,
      'Slug must be lowercase ASCII letters, digits, and hyphens, 2-40 chars.',
    )
    .min(2)
    .max(40),

  /** Microsoft Entra ID directory id (the `tid` JWT claim). Null for LOCAL-only tenants. */
  entraTenantId: z.string().uuid().nullable().default(null),

  /** Optional custom domain (Pro/Enterprise plans). */
  customDomain: z
    .string()
    .max(253)
    .regex(
      /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/,
      'Custom domain must be a valid lowercase fully-qualified domain name.',
    )
    .nullable()
    .default(null),

  /** Lifecycle status. */
  status: z.enum(
    Object.values(OrganisationStatus) as [string, ...string[]],
  ) as z.ZodType<OrganisationStatus>,

  /** Subscription plan. */
  plan: z.enum(
    Object.values(OrganisationPlan) as [string, ...string[]],
  ) as z.ZodType<OrganisationPlan>,

  /** Primary billing / admin contact for the tenant. */
  primaryContactEmail: EmailSchema.nullable().default(null),

  /** Per-tenant brand kit. Null means "use Inventario defaults". */
  brandKit: OrganisationBrandKitSchema.nullable().default(null),

  /**
   * Fakturačné a právne údaje (IČO, DIČ, IČ DPH, sídlo, IBAN, ...).
   * Null pre FREE tenantov ktorí ešte nevyplnili billing. Pri prechode
   * na platený plan billing flow vyžaduje vyplnenie povinných polí.
   * Viď `OrganisationBillingSchema`.
   */
  billing: OrganisationBillingSchema.nullable().default(null),

  /**
   * Free-form settings bag for per-tenant feature flags and config.
   * Currently unused; will fill in once Slice #4 frontend and admin
   * onboarding settle on what tenants need to configure.
   */
  settings: z.record(z.string(), z.unknown()).default({}),

  // -----------------------------------------------------------------
  // QR kódy + verejný lost & found + inventárne číslovanie (ADR-0021)
  // -----------------------------------------------------------------

  /**
   * Základ URL tenant aplikácie pre QR kódy a `/scan/` odkazy (ADR-0021 rozhodnutie 6).
   *
   * QR kód zakóduje `${appBaseUrl}/scan/${asset.publicToken}`. Doména sa beré
   * VÝLUČNE odtiaľto — NIKDY z `Host`/`X-Forwarded-Host` hlavičky (proxy/preview
   * závislé a atacker-controlled). Kritické pre forky (ADR-0010): self-hosted
   * fork má vlastnú doménu, inak by tlačil štítky s cudzou (pôvodnou) doménou.
   *
   * Povinné pri onboardingu tenanta (väzba na `customDomain`). Null = QR/scan
   * funkcie ešte nie sú použiteľné (render endpoint vráti chybu).
   */
  appBaseUrl: z
    .string()
    .url('appBaseUrl musí byť platná URL (napr. https://inventario.sfz.sk).')
    .nullable()
    .default(null),

  /**
   * Opt-in pre verejný „lost & found" lookup (ADR-0021 rozhodnutie 4).
   * Default `false` — ak vypnuté, `/scan/:token` bez auth ide na login a
   * `GET /public/scan/:token` vracia 404 (nepotvrdzuje existenciu). Tenant
   * zapne podľa vlastného rizikového profilu.
   */
  publicAssetLookup: z.boolean().default(false),

  /**
   * Kontakt zobrazený vo verejnom found-it pohľade. Null = bez kontaktu
   * (zobrazí sa len „patrí organizácii X"). Viď `FoundContactInfoSchema`
   * (GDPR poznámka: odporúčaný organizačný kontakt).
   */
  foundContactInfo: FoundContactInfoSchema.nullable().default(null),

  /**
   * Konfigurácia formátu inventárneho čísla (ADR-0021 rozhodnutie 7). Null =
   * použi default `{ prefix: ?, padding: 4, includeYear: true, resetYearly: true }`
   * — prefix však nemá rozumný globálny default, takže onboarding tenanta ho
   * vyžaduje. Viď `InventoryNumberFormatSchema`.
   */
  inventoryNumberFormat: InventoryNumberFormatSchema.nullable().default(null),

  /**
   * Konfigurácia preberacích protokolov (ADR-0022). Null = default
   * `{ paperSize: 'A4' }`. Viď `OrganisationProtocolSettingsSchema`. Hodnoty sa
   * kopírujú do snapshotu na `LoanProtocol` pri jeho vzniku (nemennosť + determinizmus).
   */
  protocolSettings: OrganisationProtocolSettingsSchema.nullable().default(null),

  /**
   * Konfigurácia tlače QR štítkov (ADR-0027). Null = default
   * `{ mode: 'PDF_SHEET', pdfPreset: 'avery-l7160', ... }` — Avery hárok na
   * každej tlačiarni. Viď `OrganisationLabelSettingsSchema`.
   */
  labelPrinting: OrganisationLabelSettingsSchema.nullable().default(null),

  // -----------------------------------------------------------------
  // Auth + member policy (ADR-0013)
  // -----------------------------------------------------------------

  /**
   * Which auth providers are allowed for this tenant's users.
   * Default: all providers. Enterprise tenants may restrict to e.g.
   * only Microsoft (M365 companies) or only Google (Google Workspace schools).
   *
   * Enforced at login/invite callback — if the user's provider is not
   * in this list, they get a clear error message.
   */
  allowedAuthProviders: z
    .array(z.enum(Object.values(AuthProvider) as [string, ...string[]]) as z.ZodType<AuthProvider>)
    .default([AuthProvider.GOOGLE, AuthProvider.APPLE, AuthProvider.MICROSOFT, AuthProvider.EMAIL]),

  /**
   * How new members join this organisation.
   * - INVITE_ONLY (default): only users with a valid invite can join
   * - DOMAIN_RESTRICTED: users with matching email domain auto-join
   * - OPEN: anyone with the org's join link can register
   *
   * Self-serve registration always creates NEW orgs (first user = ADMIN).
   * This policy governs joining EXISTING orgs.
   */
  memberJoinPolicy: z
    .enum(Object.values(MemberJoinPolicy) as [string, ...string[]])
    .default(MemberJoinPolicy.INVITE_ONLY) as z.ZodType<MemberJoinPolicy>,

  /**
   * Email domains that trigger auto-join when memberJoinPolicy is
   * DOMAIN_RESTRICTED. Example: ['mestopezinok.sk', 'pezinok.eu'].
   * Ignored for other policies.
   */
  autoJoinDomains: z.array(z.string().toLowerCase().trim()).default([]),

  // -----------------------------------------------------------------
  // Registration + onboarding (ADR-0013)
  // -----------------------------------------------------------------

  /** UserId of the person who registered this organisation. Null for legacy/manual orgs. */
  registeredBy: ObjectIdSchema.nullable().default(null),

  /** How was this org created. */
  registrationMethod: z
    .enum(Object.values(RegistrationMethod) as [string, ...string[]])
    .default(RegistrationMethod.MANUAL) as z.ZodType<RegistrationMethod>,

  /** When the onboarding wizard was completed. Null = still onboarding. */
  onboardingCompletedAt: z.string().datetime().nullable().default(null),

  // -----------------------------------------------------------------
  // DPA (GDPR Data Processing Agreement)
  // -----------------------------------------------------------------

  /** Timestamp when the DPA was accepted during registration. */
  dpaAcceptedAt: z.string().datetime().nullable().default(null),

  /** UserId who accepted the DPA. */
  dpaAcceptedBy: ObjectIdSchema.nullable().default(null),
});

export type Organisation = z.infer<typeof OrganisationSchema>;

/**
 * Input shape for creating an organisation through the admin API or
 * during JIT tenant provisioning on first SSO login.
 */
export const CreateOrganisationSchema = OrganisationSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
}).extend({
  status: z
    .enum(Object.values(OrganisationStatus) as [string, ...string[]])
    .default(OrganisationStatus.ACTIVE) as z.ZodType<OrganisationStatus>,
  plan: z
    .enum(Object.values(OrganisationPlan) as [string, ...string[]])
    .default(OrganisationPlan.FREE) as z.ZodType<OrganisationPlan>,
});

export type CreateOrganisationInput = z.infer<typeof CreateOrganisationSchema>;

/**
 * Update shape for admin edits. Slug and entraTenantId are deliberately
 * NOT updatable — they are stable identifiers used by JWT claim
 * resolution and URL routing. Renaming a tenant means migrating data.
 */
export const UpdateOrganisationSchema = OrganisationSchema.omit({
  _id: true,
  slug: true,
  entraTenantId: true,
  registeredBy: true, // immutable — who created the org
  registrationMethod: true, // immutable — how it was created
  dpaAcceptedAt: true, // immutable — audit trail
  dpaAcceptedBy: true, // immutable — audit trail
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  deletedBy: true,
}).partial();

export type UpdateOrganisationInput = z.infer<typeof UpdateOrganisationSchema>;
