// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * OrganisationSettingsContent — /settings/organisation
 *
 * Tenant ADMIN spravuje VLASTNÚ organizáciu:
 *   - Základné údaje (názov, kontakt)
 *   - QR kontakt na vrátenie (ADR-0021)
 *   - Branding (ADR-0028 v2): logo upload + výber palety + font
 *   - Fakturačné a právne údaje (IČO, DIČ, IČ DPH, sídlo, IBAN...)
 *   - Náhľad aktuálneho plánu + CTA "Požiadať o vyšší plán"
 *
 * RBAC: celá stránka je ADMIN-only (gating cez useCanAdminUsers, ktorý
 * vracia true len pre ADMIN rolu). Backend PATCH /v1/organisations/current
 * je tiež ADMIN-only — frontend gating je len UX vrstva.
 *
 * Branding (ADR-0028 v2):
 *   - Logo: file upload do Vercel Blob cez useUploadLogo (samostatný request,
 *     nie súčasť PATCH). Po úspechu sa logoUrl objaví v org dátach.
 *   - Farby: výber z 10 WCAG-overených paliet (presetId). Žiadne voľné hex.
 *   - Font: výber z enum (system-ui, Inter, Open Sans, Roboto, Lato).
 *   Preset/font/logo dostupné všetkým plánom (žiadny Pro+ gating).
 */

import {
  BRAND_PRESETS,
  FONT_OPTIONS,
  getBrandPreset,
  type FontOptionId,
} from '@inventario/shared-types';
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  Loader2,
  Mail,
  Palette,
  Save,
  ShieldOff,
  Upload,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { SelectField } from './SelectField';

import type { JSX, ReactNode } from 'react';

import { useCanAdminUsers, useMe } from '@/lib/api-hooks';
import {
  useCurrentOrganisation,
  useUpdateCurrentOrganisation,
  useUploadLogo,
  type AddressInfo,
  type BillingInfo,
} from '@/lib/organisations-hooks';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAN_LABELS: Record<string, string> = {
  FREE: 'Free',
  PRO: 'Pro',
  ENTERPRISE: 'Enterprise',
};

const PLAN_DESCRIPTIONS: Record<string, string> = {
  FREE: 'Základné funkcie pre malé tímy.',
  PRO: 'Väčšie limity, prioritná podpora.',
  ENTERPRISE: 'SSO, vlastná doména, SLA, dedikovaná podpora.',
};

/** Pár najčastejších krajín pre dropdown. Default SK. */
const COUNTRY_OPTIONS = [
  { value: 'SK', label: 'Slovensko' },
  { value: 'CZ', label: 'Česko' },
  { value: 'AT', label: 'Rakúsko' },
  { value: 'PL', label: 'Poľsko' },
  { value: 'HU', label: 'Maďarsko' },
  { value: 'DE', label: 'Nemecko' },
];

const UPGRADE_EMAIL = 'obchod@ltk.solutions';

/** Max veľkosť loga (musí súhlasiť s backendom — LOGO_MAX_BYTES). */
const LOGO_MAX_BYTES = 512 * 1024;

const EMPTY_ADDRESS: AddressInfo = {
  street: '',
  city: '',
  postalCode: '',
  countryCode: 'SK',
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function OrganisationSettingsContent(): JSX.Element {
  const canAdmin = useCanAdminUsers();
  const meQuery = useMe();

  if (meQuery.isLoading) return <PageSkeleton />;
  if (!canAdmin) return <AccessDenied />;

  return <OrganisationSettingsPanel />;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function OrganisationSettingsPanel(): JSX.Element {
  const query = useCurrentOrganisation();
  const update = useUpdateCurrentOrganisation();
  const uploadLogo = useUploadLogo();

  // Form state — mirrors the editable subset
  const [displayName, setDisplayName] = useState('');
  const [primaryContactEmail, setPrimaryContactEmail] = useState('');
  const [legalName, setLegalName] = useState('');
  const [ico, setIco] = useState('');
  const [dic, setDic] = useState('');
  const [isVatPayer, setIsVatPayer] = useState(false);
  const [icDph, setIcDph] = useState('');
  const [businessRegistration, setBusinessRegistration] = useState('');
  const [iban, setIban] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [registeredAddress, setRegisteredAddress] = useState<AddressInfo>(EMPTY_ADDRESS);
  const [hasMailingAddress, setHasMailingAddress] = useState(false);
  const [mailingAddress, setMailingAddress] = useState<AddressInfo>(EMPTY_ADDRESS);

  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // foundContactInfo state (ADR-0021)
  const [foundEmail, setFoundEmail] = useState('');
  const [foundPhone, setFoundPhone] = useState('');
  const [foundMessage, setFoundMessage] = useState('');

  // appBaseUrl — základná URL pre QR kódy / štítky (ADR-0021)
  const [appBaseUrl, setAppBaseUrl] = useState('');
  // publicAssetLookup — verejný lost & found lookup po naskenovaní QR (ADR-0021)
  const [publicAssetLookup, setPublicAssetLookup] = useState(false);

  // labelPrinting — tlač QR štítkov na Zebra termálnej tlačiarni (ADR-0027).
  // zplEnabled prepína mode PDF_SHEET ↔ ZEBRA_ZPL; zvyšné polia sú
  // relevantné len pre ZEBRA_ZPL (rozmery/DPI/sýtosť termálnej tlače).
  const [zplEnabled, setZplEnabled] = useState(false);
  const [zplLabelWidthMm, setZplLabelWidthMm] = useState(50);
  const [zplLabelHeightMm, setZplLabelHeightMm] = useState(25);
  const [zplDpi, setZplDpi] = useState<203 | 300>(203);
  const [zplDarkness, setZplDarkness] = useState(20);

  // Inventory number format state (ADR-0021)
  const [invPrefix, setInvPrefix] = useState('');
  const [invPadding, setInvPadding] = useState(4);
  const [invIncludeYear, setInvIncludeYear] = useState(true);
  const [invResetYearly, setInvResetYearly] = useState(true);

  // Protocol number format state (ADR-0022)
  const [protPrefix, setProtPrefix] = useState('');
  const [protPadding, setProtPadding] = useState(6);
  const [protInitialSeq, setProtInitialSeq] = useState(1);

  // Branding state (ADR-0028 v2): presetId + font enum
  const [presetId, setPresetId] = useState<string | null>(null);
  const [fontFamilySans, setFontFamilySans] = useState<FontOptionId>('system-ui');

  // Logo upload state (samostatný request, mimo hlavného PATCH)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoError, setLogoError] = useState<string | null>(null);

  // Hydrate form once the org loads
  const org = query.data;
  useEffect(() => {
    if (!org) return;
    setDisplayName(org.displayName);
    setPrimaryContactEmail(org.primaryContactEmail ?? '');
    const b = org.billing;
    setLegalName(b?.legalName ?? '');
    setIco(b?.ico ?? '');
    setDic(b?.dic ?? '');
    setIsVatPayer(b?.isVatPayer ?? false);
    setIcDph(b?.icDph ?? '');
    setBusinessRegistration(b?.businessRegistration ?? '');
    setIban(b?.iban ?? '');
    setBillingEmail(b?.billingEmail ?? '');
    setRegisteredAddress(b?.registeredAddress ?? EMPTY_ADDRESS);
    setHasMailingAddress(b?.mailingAddress != null);
    setMailingAddress(b?.mailingAddress ?? EMPTY_ADDRESS);
    // foundContactInfo hydration (ADR-0021)
    setFoundEmail(org.foundContactInfo?.email ?? '');
    setFoundPhone(org.foundContactInfo?.phone ?? '');
    setFoundMessage(org.foundContactInfo?.message ?? '');
    // appBaseUrl hydration (ADR-0021)
    setAppBaseUrl(org.appBaseUrl ?? '');
    setPublicAssetLookup(org.publicAssetLookup ?? false);
    // labelPrinting hydration (ADR-0027)
    setZplEnabled(org.labelPrinting?.mode === 'ZEBRA_ZPL');
    setZplLabelWidthMm(org.labelPrinting?.zplLabelWidthMm ?? 50);
    setZplLabelHeightMm(org.labelPrinting?.zplLabelHeightMm ?? 25);
    setZplDpi(org.labelPrinting?.zplDpi === 300 ? 300 : 203);
    setZplDarkness(org.labelPrinting?.zplDarkness ?? 20);
    // inventoryNumberFormat hydration (ADR-0021)
    setInvPrefix(org.inventoryNumberFormat?.prefix ?? '');
    setInvPadding(org.inventoryNumberFormat?.padding ?? 4);
    setInvIncludeYear(org.inventoryNumberFormat?.includeYear ?? true);
    setInvResetYearly(org.inventoryNumberFormat?.resetYearly ?? true);
    // protocolSettings.numberFormat hydration (ADR-0022)
    setProtPrefix(org.protocolSettings?.numberFormat?.prefix ?? '');
    setProtPadding(org.protocolSettings?.numberFormat?.padding ?? 6);
    setProtInitialSeq(org.protocolSettings?.numberFormat?.initialSeq ?? 1);
    // brandKit hydration (ADR-0028 v2)
    setPresetId(org.brandKit?.presetId ?? null);
    const f = org.brandKit?.fontFamilySans;
    setFontFamilySans(isFontOptionId(f) ? f : 'system-ui');
  }, [org]);

  if (query.isLoading) return <PageSkeleton />;
  if (query.isError || !org) {
    return <ErrorPanel message="Organizáciu sa nepodarilo načítať. Skús to znova." />;
  }

  const currentLogoUrl = org.brandKit?.logoUrl ?? null;

  function buildBilling(): BillingInfo {
    const addr = (a: AddressInfo): AddressInfo | null =>
      a.street.trim() || a.city.trim() || a.postalCode.trim()
        ? {
            street: a.street.trim(),
            city: a.city.trim(),
            postalCode: a.postalCode.trim(),
            countryCode: a.countryCode,
          }
        : null;

    return {
      legalName: legalName.trim() || null,
      ico: ico.trim() || null,
      dic: dic.trim() || null,
      isVatPayer,
      icDph: isVatPayer ? icDph.trim() || null : null,
      businessRegistration: businessRegistration.trim() || null,
      iban: iban.trim() || null,
      billingEmail: billingEmail.trim() || null,
      registeredAddress: addr(registeredAddress),
      mailingAddress: hasMailingAddress ? addr(mailingAddress) : null,
    };
  }

  /**
   * Zostaví brandKit payload pre PATCH. presetId + font; hex polia naplní
   * backend z presetu. logoUrl sa NEPOSIELA tu — rieši ho samostatný
   * upload endpoint. Zachováme existujúce logoUrl z org dát.
   */
  function buildBrandKit(): {
    presetId: string | null;
    logoUrl: string | null;
    faviconUrl: string | null;
    primary: string | null;
    primaryFg: string | null;
    accent: string | null;
    accentFg: string | null;
    logoDot: string | null;
    fontFamilySans: string | null;
  } {
    // Ak je vybraný preset, hex polia naplní backend — pošleme len presetId.
    // Posielame aj existujúce logoUrl, nech ho PATCH neprepíše na null.
    return {
      presetId,
      logoUrl: org!.brandKit?.logoUrl ?? null,
      faviconUrl: org!.brandKit?.faviconUrl ?? null,
      primary: null,
      primaryFg: null,
      accent: null,
      accentFg: null,
      logoDot: null,
      fontFamilySans: fontFamilySans === 'system-ui' ? null : fontFamilySans,
    };
  }

  /**
   * Zostaví labelPrinting payload pre PATCH (ADR-0027). Ak nikdy nebolo
   * konfigurované (org.labelPrinting === null) a prepínac ostáva vypnutý,
   * neposielame nič (žiadna zmena voči PDF_SHEET defaultu). Inak posielame
   * celý objekt — pdfPreset/finderText zachováme z existujúceho configu
   * (táto stránka pre ne nemá vlastné UI polia).
   */
  function buildLabelPrinting(): {
    mode: 'PDF_SHEET' | 'ZEBRA_ZPL';
    pdfPreset: 'avery-l7160' | 'avery-l7163';
    finderText: { enabled: boolean; text: string };
    zplLabelWidthMm: number;
    zplLabelHeightMm: number;
    zplDpi: 203 | 300;
    zplDarkness: number;
  } | null {
    const existing = org!.labelPrinting;
    if (!zplEnabled && existing == null) return null;
    return {
      mode: zplEnabled ? 'ZEBRA_ZPL' : 'PDF_SHEET',
      pdfPreset: existing?.pdfPreset ?? 'avery-l7160',
      finderText: existing?.finderText ?? {
        enabled: false,
        text: 'Našli ste ma? Naskenujte a pomôžte ma vrátiť.',
      },
      zplLabelWidthMm,
      zplLabelHeightMm,
      zplDpi,
      zplDarkness,
    };
  }

  function handleLogoFile(file: File): void {
    setLogoError(null);
    // Client-side pred-validácia (backend re-validuje magic bytes + veľkosť).
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError(`Logo je príliš veľké. Maximálna veľkosť je ${LOGO_MAX_BYTES / 1024} KB.`);
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setLogoError('Povolené sú len PNG, JPEG a WEBP.');
      return;
    }
    uploadLogo.mutate(file, {
      onError: (err) => setLogoError(err.message),
    });
  }

  function handleSave(): void {
    setFormError(null);
    setSaved(false);

    // Light client-side checks — backend re-validates everything.
    if (isVatPayer && !icDph.trim()) {
      setFormError('Pri platiteľovi DPH je IČ DPH povinné.');
      return;
    }
    if (ico.trim() && !/^\d{8}$/.test(ico.trim())) {
      setFormError('IČO musí mať presne 8 číslic.');
      return;
    }
    if (dic.trim() && !/^\d{10}$/.test(dic.trim())) {
      setFormError('DIČ musí mať presne 10 číslic.');
      return;
    }
    if (invPrefix.trim() && !/^[A-Z]{1,5}$/.test(invPrefix.trim())) {
      setFormError('Prefix inventárneho čísla musí byť 1–5 veľkých ASCII písmen (napr. "SFZ").');
      return;
    }
    if (protPrefix.trim() && !/^[A-Z]{1,5}$/.test(protPrefix.trim())) {
      setFormError('Prefix čísla protokolu musí byť 1–5 veľkých ASCII písmen (napr. "PROT").');
      return;
    }
    if (appBaseUrl.trim()) {
      try {
        const u = new URL(appBaseUrl.trim());
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
      } catch {
        setFormError(
          'Základná URL aplikácie musí byť platná adresa (napr. https://app.inventario.estate).',
        );
        return;
      }
    }

    update.mutate(
      {
        displayName: displayName.trim() || org!.displayName,
        primaryContactEmail: primaryContactEmail.trim() || null,
        billing: buildBilling(),
        foundContactInfo:
          foundEmail.trim() || foundPhone.trim() || foundMessage.trim()
            ? {
                email: foundEmail.trim() || null,
                phone: foundPhone.trim() || null,
                message: foundMessage.trim() || null,
              }
            : null,
        brandKit: buildBrandKit(),
        inventoryNumberFormat: invPrefix.trim()
          ? {
              prefix: invPrefix.trim().toUpperCase(),
              padding: invPadding,
              includeYear: invIncludeYear,
              resetYearly: invResetYearly,
            }
          : null,
        protocolSettings: {
          // paperSize zachovávame z existujúcich nastavení, aby $set neprišiel o hodnotu
          paperSize: query.data?.protocolSettings?.paperSize ?? 'A4',
          numberFormat: protPrefix.trim()
            ? {
                prefix: protPrefix.trim().toUpperCase(),
                padding: protPadding,
                initialSeq: protInitialSeq,
              }
            : null,
        },
        appBaseUrl: appBaseUrl.trim() || null,
        publicAssetLookup,
        labelPrinting: buildLabelPrinting(),
      },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
        },
        onError: (err) => setFormError(err.message),
      },
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary sm:text-3xl">
          <Building2 aria-hidden="true" className="h-7 w-7 text-brand-accent" />
          Organizácia
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Fakturačné údaje a plán vašej organizácie. Tieto údaje sa použijú na vystavenie faktúr.
        </p>
      </header>

      {/* Plan card */}
      <PlanCard plan={org.plan} />

      {/* Billing form */}
      <div className="mt-6 space-y-6">
        <Section title="Základné údaje">
          <Field label="Názov organizácie">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={inputCls()}
            />
          </Field>
          <Field label="Kontaktný e-mail" hint="Hlavný kontakt pre administratívu.">
            <input
              type="email"
              value={primaryContactEmail}
              onChange={(e) => setPrimaryContactEmail(e.target.value)}
              placeholder="kontakt@organizacia.sk"
              className={inputCls()}
            />
          </Field>
        </Section>

        <Section title="QR kódy a štítky">
          <Field
            label="Základná URL aplikácie"
            hint="Povinné pre QR kódy a tlač štítkov. QR zakóduje {URL}/scan/{token}. Napr. https://app.inventario.estate"
          >
            <input
              type="url"
              value={appBaseUrl}
              onChange={(e) => setAppBaseUrl(e.target.value)}
              placeholder="https://app.inventario.estate"
              className={inputCls()}
            />
          </Field>

          <label className="flex items-start gap-3 rounded-lg border border-border-subtle bg-surface-subtle p-3 text-sm font-medium text-text-primary">
            <input
              type="checkbox"
              checked={zplEnabled}
              onChange={(e) => setZplEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-default text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            />
            <span>
              Tlačiť štítky na Zebra termálnej tlačiarni (ZPL)
              <span className="mt-0.5 block text-xs font-normal text-text-secondary">
                Ak je zapnuté, na detaile majetku (a pri dávkovej tlači) sa objaví tlačidlo „Tlačiť
                na Zebra“ vedľa „Tlačiť štítok (PDF)“ — pošle ZPL priamo na lokálneho agenta Zebra
                Browser Print (musí byť nainštalovaný na PC pri tlačiarni). Vypnuté = štandardná
                tlač na PDF hárok (funguje na bežnej kancelárskej tlačiarni).
              </span>
            </span>
          </label>

          {zplEnabled && (
            <div className="grid gap-4 rounded-lg border border-border-subtle p-4 sm:grid-cols-2">
              <Field label="Šírka štítka (mm)" hint="Typicky 50 mm pre štandardné Zebra štítky.">
                <input
                  type="number"
                  min={10}
                  max={200}
                  value={zplLabelWidthMm}
                  onChange={(e) =>
                    setZplLabelWidthMm(Math.max(10, Math.min(200, Number(e.target.value))))
                  }
                  className={inputCls()}
                />
              </Field>
              <Field label="Výška štítka (mm)" hint="Typicky 25 mm pre štandardné Zebra štítky.">
                <input
                  type="number"
                  min={10}
                  max={200}
                  value={zplLabelHeightMm}
                  onChange={(e) =>
                    setZplLabelHeightMm(Math.max(10, Math.min(200, Number(e.target.value))))
                  }
                  className={inputCls()}
                />
              </Field>
              <Field
                label="Rozlíšenie tlačovej hlavy (DPI)"
                hint="ZD420 = 203 dpi (default). ZD620 a niektoré ZT série = 300 dpi."
              >
                <select
                  value={zplDpi}
                  onChange={(e) => setZplDpi(Number(e.target.value) === 300 ? 300 : 203)}
                  className={inputCls()}
                >
                  <option value={203}>203 dpi</option>
                  <option value={300}>300 dpi</option>
                </select>
              </Field>
              <Field
                label="Sýtosť tlače"
                hint="0–30. Vyššia hodnota = tmavší výtlačok. Default 20."
              >
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={zplDarkness}
                  onChange={(e) =>
                    setZplDarkness(Math.max(0, Math.min(30, Number(e.target.value))))
                  }
                  className={inputCls()}
                />
              </Field>
            </div>
          )}

          <label className="flex items-start gap-3 rounded-lg border border-border-subtle bg-surface-subtle p-3 text-sm font-medium text-text-primary">
            <input
              type="checkbox"
              checked={publicAssetLookup}
              onChange={(e) => setPublicAssetLookup(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-default text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            />
            <span>
              Verejný lookup po naskenovaní QR (lost &amp; found)
              <span className="mt-0.5 block text-xs font-normal text-text-secondary">
                Ak je zapnuté, po naskenovaní QR sa komukoľvek (bez prihlásenia) zobrazí verejná
                stránka s názvom organizácie, inventárnym číslom, názvom majetku a kontaktom na
                vrátenie nižšie. Vypnuté = sken vráti „nenašiel sa".
              </span>
            </span>
          </label>

          <p className="-mt-1 text-xs text-text-secondary">
            Nasledujúce informácie sa zobrazia na verejnej stránke po naskenovaní QR kódu nálezcom.
            Odporúčame organizačný kontakt, nie osobný. Nechajte prázdne, ak nechcete zverejniť
            kontakt.
          </p>
          <Field label="E-mail" hint="napr. majetok@organizacia.sk">
            <input
              type="email"
              value={foundEmail}
              onChange={(e) => setFoundEmail(e.target.value)}
              placeholder="majetok@organizacia.sk"
              className={inputCls()}
            />
          </Field>
          <Field label="Telefón" hint="napr. +421900000000">
            <input
              type="tel"
              value={foundPhone}
              onChange={(e) => setFoundPhone(e.target.value)}
              placeholder="+421900000000"
              className={inputCls()}
            />
          </Field>
          <Field
            label="Správa pre nálezcu"
            hint="Krátka inštrukcia, napr. Kontaktujte nás na vrátenie. Ďakujeme!"
          >
            <textarea
              rows={3}
              value={foundMessage}
              onChange={(e) => setFoundMessage(e.target.value)}
              placeholder="Kontaktujte nás — radi vám poradíme, ako majetok vrátiť. Ďakujeme!"
              className={inputCls() + ' resize-none'}
            />
          </Field>
        </Section>

        {/* Inventárne číslovanie (ADR-0021) */}
        <Section title="Inventárne číslovanie">
          <p className="-mt-1 text-xs text-text-secondary">
            Formát inventárneho čísla sa generuje automaticky pri pridaní majetku. Príklad: prefix
            „SFZ“, padding 4, rok zapnutý → „SFZ-2026-0001“.
          </p>
          <Field
            label="Prefix"
            required
            hint='1–5 veľkých ASCII písmen. Napr. "SFZ", "INV", "MOB".'
          >
            <input
              type="text"
              value={invPrefix}
              onChange={(e) => setInvPrefix(e.target.value.toUpperCase())}
              placeholder="SFZ"
              maxLength={5}
              className={inputCls()}
            />
          </Field>
          <Field
            label="Počet cifier"
            hint="Počet cifier poradia (doplnených nulami). Napr. 4 → 0001."
          >
            <select
              value={invPadding}
              onChange={(e) => setInvPadding(Number(e.target.value))}
              className={inputCls()}
            >
              {[3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n} cifier (napr. {'0'.repeat(n - 1)}1)
                </option>
              ))}
            </select>
          </Field>
          <Field label="Zahrnúť rok">
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={invIncludeYear}
                onChange={(e) => setInvIncludeYear(e.target.checked)}
                className="h-4 w-4 rounded border-border-default text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              />
              <span>Rok zaradenia súčasťou čísla (napr. SFZ-2026-0001)</span>
            </label>
          </Field>
          {invIncludeYear && (
            <Field label="Reset poradia každý rok">
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={invResetYearly}
                  onChange={(e) => setInvResetYearly(e.target.checked)}
                  className="h-4 w-4 rounded border-border-default text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                />
                <span>Nový rok začína od 0001</span>
              </label>
            </Field>
          )}
          {invPrefix.trim() && (
            <div className="rounded-lg bg-surface-subtle px-4 py-3 text-sm text-text-secondary">
              Náhľad:{' '}
              <span className="font-mono font-semibold text-text-primary">
                {invPrefix.trim().toUpperCase()}
                {invIncludeYear ? `-${new Date().getFullYear()}` : ''}-
                {String(1).padStart(invPadding, '0')}
              </span>
            </div>
          )}
        </Section>

        {/* Číslovanie protokolov (ADR-0022) */}
        <Section title="Číslovanie protokolov">
          <p className="-mt-1 text-xs text-text-secondary">
            Formát čísla preberacieho protokolu. Systémový default: prefix „PROT", 6 cifier, od 1.
            Príklad: „PROT-2026-000001". Nechajte prázdne pre ponechanie systémového defaultu.
          </p>
          <Field label="Prefix" hint='1–5 veľkých ASCII písmen. Napr. "PROT", "SFZ", "PREV".'>
            <input
              type="text"
              value={protPrefix}
              onChange={(e) => setProtPrefix(e.target.value.toUpperCase())}
              placeholder="PROT"
              maxLength={5}
              className={inputCls()}
            />
          </Field>
          <Field
            label="Počet cifier"
            hint="Počet cifier poradia (doplnených nulami). Napr. 6 → 000001."
          >
            <select
              value={protPadding}
              onChange={(e) => setProtPadding(Number(e.target.value))}
              className={inputCls()}
            >
              {[3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n} cifier (napr. {'0'.repeat(n - 1)}1)
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Počiatočná hodnota sekvencie"
            hint="Od akého čísla začína nový rok. Default 1. Zmena nemá efekt, ak protokoly v danom roku už existujú."
          >
            <input
              type="number"
              min={1}
              max={999999}
              value={protInitialSeq}
              onChange={(e) => setProtInitialSeq(Math.max(1, Number(e.target.value)))}
              className={inputCls()}
            />
          </Field>
          {protPrefix.trim() && (
            <div className="rounded-lg bg-surface-subtle px-4 py-3 text-sm text-text-secondary">
              Náhľad:{' '}
              <span className="font-mono font-semibold text-text-primary">
                {protPrefix.trim().toUpperCase()}-{new Date().getFullYear()}-
                {String(protInitialSeq).padStart(protPadding, '0')}
              </span>
            </div>
          )}
        </Section>

        {/* Branding (ADR-0028 v2) */}
        <section className="rounded-xl border border-border-subtle bg-surface-card shadow-sm">
          <h2 className="border-b border-border-subtle px-5 py-3 text-sm font-semibold text-text-primary flex items-center gap-2">
            <Palette aria-hidden="true" className="h-4 w-4 text-brand-accent" />
            Branding
          </h2>
          <div className="space-y-5 p-5">
            <p className="-mt-1 text-xs text-text-secondary">
              Logo, farebná paleta a font sú dostupné pre všetky plány.
            </p>

            {/* Logo upload */}
            <div className="space-y-2">
              <span className="text-sm font-medium text-text-secondary">Logo</span>
              <div className="flex items-center gap-4">
                {/* Náhľad aktuálneho loga */}
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface-subtle">
                  {currentLogoUrl ? (
                    <img
                      src={currentLogoUrl}
                      alt="Logo organizácie"
                      className="h-full w-full rounded-lg object-contain p-1"
                    />
                  ) : (
                    <Building2 aria-hidden="true" className="h-6 w-6 text-text-muted" />
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleLogoFile(file);
                      // reset, nech sa dá nahrať ten istý súbor znova
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadLogo.isPending}
                    className="inline-flex items-center gap-2 rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm font-medium text-text-primary shadow-sm transition hover:bg-surface-subtle disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                  >
                    {uploadLogo.isPending ? (
                      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload aria-hidden="true" className="h-4 w-4" />
                    )}
                    {currentLogoUrl ? 'Zmeniť logo' : 'Nahrať logo'}
                  </button>
                  <span className="text-xs text-text-muted">
                    PNG, JPEG alebo WEBP, max 512 KB. Odporúčame 256×256 px.
                  </span>
                </div>
              </div>
              {logoError && (
                <p className="flex items-center gap-1.5 text-xs text-danger-fg">
                  <AlertCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                  {logoError}
                </p>
              )}
            </div>

            {/* Farebná paleta */}
            <div className="space-y-2">
              <span className="text-sm font-medium text-text-secondary">Farebná paleta</span>
              <div
                role="radiogroup"
                aria-label="Farebná paleta"
                className="grid grid-cols-2 gap-2 sm:grid-cols-3"
              >
                {BRAND_PRESETS.map((preset) => {
                  const selected = presetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setPresetId(preset.id)}
                      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${
                        selected
                          ? 'border-brand-accent ring-1 ring-brand-accent'
                          : 'border-border-subtle hover:border-border-default'
                      }`}
                    >
                      {/* Swatch — primary + accent */}
                      <span className="flex shrink-0 overflow-hidden rounded-md border border-border-subtle">
                        <span
                          className="h-7 w-4"
                          style={{ background: preset.primary }}
                          aria-hidden="true"
                        />
                        <span
                          className="h-7 w-4"
                          style={{ background: preset.accent }}
                          aria-hidden="true"
                        />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">
                        {preset.name}
                      </span>
                      {selected && (
                        <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-accent" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Náhľad CTA */}
            {presetId && <PresetPreview presetId={presetId} />}

            {/* Font */}
            <div className="max-w-xs">
              <SelectField
                label="Font"
                value={fontFamilySans}
                onChange={(v) => setFontFamilySans(isFontOptionId(v) ? v : 'system-ui')}
                options={FONT_OPTIONS.map((f) => ({ value: f.id, label: f.label }))}
              />
            </div>
          </div>
        </section>

        <Section title="Fakturačné a právne údaje">
          <Field label="Obchodné meno" hint="Právny názov subjektu tak, ako má byť na faktúre.">
            <input
              type="text"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="napr. Mesto Pezinok / TJ Sokol, o. z."
              className={inputCls()}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="IČO">
              <input
                type="text"
                inputMode="numeric"
                value={ico}
                onChange={(e) => setIco(e.target.value)}
                placeholder="12345678"
                className={inputCls()}
              />
            </Field>
            <Field label="DIČ">
              <input
                type="text"
                inputMode="numeric"
                value={dic}
                onChange={(e) => setDic(e.target.value)}
                placeholder="2023456789"
                className={inputCls()}
              />
            </Field>
          </div>

          <Field label="Platiteľ DPH">
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={isVatPayer}
                onChange={(e) => setIsVatPayer(e.target.checked)}
                className="h-4 w-4 rounded border-border-default text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              />
              <span>Subjekt je platiteľom DPH</span>
            </label>
          </Field>

          {isVatPayer && (
            <Field label="IČ DPH" required hint="Formát SK + 10 číslic.">
              <input
                type="text"
                value={icDph}
                onChange={(e) => setIcDph(e.target.value)}
                placeholder="SK2023456789"
                className={inputCls()}
              />
            </Field>
          )}

          <Field label="Zápis v registri" hint="OR alebo ŽR — voliteľné.">
            <input
              type="text"
              value={businessRegistration}
              onChange={(e) => setBusinessRegistration(e.target.value)}
              placeholder="napr. OR OS BA I, odd. Sro, vl. č. 12345/B"
              className={inputCls()}
            />
          </Field>

          <Field label="IBAN" hint="Pre prípadné dobropisy.">
            <input
              type="text"
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              placeholder="SK89 0000 0000 0000 0000 0000"
              className={inputCls()}
            />
          </Field>

          <Field label="Fakturačný e-mail" hint="Kam posielať faktúry, ak sa líši od kontaktu.">
            <input
              type="email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
              placeholder="fakturacia@organizacia.sk"
              className={inputCls()}
            />
          </Field>
        </Section>

        <Section title="Sídlo">
          <AddressFields value={registeredAddress} onChange={setRegisteredAddress} />
        </Section>

        <Section title="Korešpondenčná adresa">
          <Field label="Iná ako sídlo">
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={hasMailingAddress}
                onChange={(e) => setHasMailingAddress(e.target.checked)}
                className="h-4 w-4 rounded border-border-default text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              />
              <span>Korešpondenčná adresa sa líši od sídla</span>
            </label>
          </Field>
          {hasMailingAddress && (
            <AddressFields value={mailingAddress} onChange={setMailingAddress} />
          )}
        </Section>

        {formError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger-fg bg-danger-bg p-4 text-sm text-danger-fg"
          >
            <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        {saved && (
          <div className="flex items-center gap-2 rounded-lg border border-success-fg bg-success-bg p-4 text-sm text-success-fg">
            <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>Zmeny boli uložené.</span>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={update.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-brand-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            {update.isPending ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Save aria-hidden="true" className="h-4 w-4" />
            )}
            Uložiť zmeny
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preset preview — CTA náhľad vybranej palety
// ---------------------------------------------------------------------------

function PresetPreview({ presetId }: { presetId: string }): JSX.Element | null {
  const preset = getBrandPreset(presetId);
  if (!preset) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-text-secondary">Náhľad</p>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold shadow-sm"
          style={{ background: preset.primary, color: preset.primaryFg }}
        >
          Primárne CTA
        </span>
        <span
          className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold shadow-sm"
          style={{ background: preset.accent, color: preset.accentFg }}
        >
          Akcentové CTA
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan card
// ---------------------------------------------------------------------------

function PlanCard({ plan }: { plan: string }): JSX.Element {
  const label = PLAN_LABELS[plan] ?? plan;
  const description = PLAN_DESCRIPTIONS[plan] ?? '';
  const canUpgrade = plan !== 'ENTERPRISE';

  const mailtoHref = `mailto:${UPGRADE_EMAIL}?subject=${encodeURIComponent(
    'Žiadosť o vyšší plán — Inventario',
  )}&body=${encodeURIComponent(
    `Dobrý deň,\n\nmáme záujem o prechod na vyšší plán (aktuálne: ${label}).\n\nĎakujeme.`,
  )}`;

  return (
    <section className="rounded-xl border border-border-subtle bg-surface-card p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-secondary">Aktuálny plán</span>
            <span className="inline-flex rounded-full bg-brand-primary/10 px-2.5 py-0.5 text-xs font-semibold text-brand-primary">
              {label}
            </span>
          </div>
          {description && <p className="mt-1 text-sm text-text-secondary">{description}</p>}
        </div>
        {canUpgrade && (
          <a
            href={mailtoHref}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border-default bg-surface-card px-4 py-2 text-sm font-semibold text-text-primary shadow-sm transition hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            <Mail aria-hidden="true" className="h-4 w-4" />
            Požiadať o vyšší plán
          </a>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Address fields
// ---------------------------------------------------------------------------

function AddressFields({
  value,
  onChange,
}: {
  value: AddressInfo;
  onChange: (next: AddressInfo) => void;
}): JSX.Element {
  return (
    <>
      <Field label="Ulica a číslo">
        <input
          type="text"
          value={value.street}
          onChange={(e) => onChange({ ...value, street: e.target.value })}
          placeholder="Trnavská cesta 123"
          className={inputCls()}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mesto">
          <input
            type="text"
            value={value.city}
            onChange={(e) => onChange({ ...value, city: e.target.value })}
            placeholder="Bratislava"
            className={inputCls()}
          />
        </Field>
        <Field label="PSČ">
          <input
            type="text"
            value={value.postalCode}
            onChange={(e) => onChange({ ...value, postalCode: e.target.value })}
            placeholder="831 04"
            className={inputCls()}
          />
        </Field>
      </div>
      <Field label="Krajina">
        <SelectField
          label="Krajina"
          value={value.countryCode}
          onChange={(v) => onChange({ ...value, countryCode: v })}
          options={COUNTRY_OPTIONS}
          className="w-full sm:w-64"
        />
      </Field>
    </>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** Type guard pre font enum ID. */
function isFontOptionId(value: string | null | undefined): value is FontOptionId {
  return value != null && FONT_OPTIONS.some((f) => f.id === value);
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="rounded-xl border border-border-subtle bg-surface-card shadow-sm">
      <h2 className="border-b border-border-subtle px-5 py-3 text-sm font-semibold text-text-primary">
        {title}
      </h2>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
  required,
  hint,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  hint?: string;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline gap-1 text-sm font-medium text-text-secondary">
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger-fg">
            *
          </span>
        )}
      </span>
      {children}
      {hint && <span className="text-xs text-text-muted">{hint}</span>}
    </label>
  );
}

function inputCls(): string {
  return 'w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function PageSkeleton(): JSX.Element {
  return (
    <div aria-busy="true" aria-label="Načítavam" className="mx-auto max-w-3xl">
      <div className="mb-6 h-8 w-48 animate-pulse rounded bg-surface-subtle" />
      <div className="h-24 animate-pulse rounded-xl bg-surface-subtle" />
      <div className="mt-6 h-64 animate-pulse rounded-xl bg-surface-subtle" />
    </div>
  );
}

function ErrorPanel({ message }: { message: string }): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl">
      <div
        role="alert"
        className="flex items-start gap-2 rounded-xl border border-danger-fg bg-danger-bg p-4 text-sm text-danger-fg"
      >
        <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span>{message}</span>
      </div>
    </div>
  );
}

function AccessDenied(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl rounded-xl border border-dashed border-border-default bg-surface-card p-10 text-center">
      <ShieldOff aria-hidden="true" className="mx-auto h-8 w-8 text-text-muted" />
      <p className="mt-3 text-sm font-medium text-text-primary">
        Na túto stránku majú prístup iba administrátori organizácie.
      </p>
    </div>
  );
}
