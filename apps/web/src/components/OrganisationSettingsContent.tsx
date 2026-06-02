// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * OrganisationSettingsContent — /settings/organisation
 *
 * Tenant ADMIN spravuje VLASTNÚ organizáciu:
 *   - Fakturačné a právne údaje (IČO, DIČ, IČ DPH, sídlo, IBAN...)
 *   - Náhľad aktuálneho plánu + CTA "Požiadať o vyšší plán"
 *
 * RBAC: celá stránka je ADMIN-only (gating cez useCanAdminUsers, ktorý
 * vracia true len pre ADMIN rolu). Backend PATCH /v1/organisations/current
 * je tiež ADMIN-only — frontend gating je len UX vrstva.
 *
 * Dáta:
 *   - useCurrentOrganisation() — GET /v1/organisations/current
 *   - useUpdateCurrentOrganisation() — PATCH (SAFE subset: displayName,
 *     primaryContactEmail, billing)
 *
 * Plán + upgrade:
 *   Platby zatiaľ nie sú napojené. Tlačidlo "Požiadať o vyšší plán"
 *   otvorí mailto: na LTK s predvyplneným predmetom. Keď pribudne
 *   billing provider, nahradíme za reálny upgrade flow.
 */

import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Loader2,
  Lock,
  Mail,
  Palette,
  Save,
  ShieldOff,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { SelectField } from './SelectField';

import type { JSX, ReactNode } from 'react';

import { useCanAdminUsers, useMe } from '@/lib/api-hooks';
import {
  useCurrentOrganisation,
  useUpdateCurrentOrganisation,
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
  PRO: 'Vlastný branding, väčšie limity, prioritná podpora.',
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

/**
 * WCAG 2.1 kontrast ratio — frontend verzia (identický algoritmus s backendom contrast.ts).
 * Vstup: #RRGGBB hex stringy. Výstup: pomer zaokrºhlený na 2 des. miesta.
 */
function hexContrast(hex1: string, hex2: string): number {
  function linear(hex2ch: string): number {
    const c = parseInt(hex2ch, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function lum(hex: string): number {
    const h = hex.replace('#', '');
    return (
      0.2126 * linear(h.slice(0, 2)) +
      0.7152 * linear(h.slice(2, 4)) +
      0.0722 * linear(h.slice(4, 6))
    );
  }
  const l1 = lum(hex1);
  const l2 = lum(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

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

  // Branding state (ADR-0028)
  const [logoUrl, setLogoUrl] = useState('');
  const [primary, setPrimary] = useState('');
  const [primaryFg, setPrimaryFg] = useState('');
  const [accent, setAccent] = useState('');
  const [accentFg, setAccentFg] = useState('');
  const [logoDot, setLogoDot] = useState('');
  const [fontFamilySans, setFontFamilySans] = useState('');
  const [logoPreviewError, setLogoPreviewError] = useState(false);

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
    // brandKit hydration (ADR-0028)
    setLogoUrl(org.brandKit?.logoUrl ?? '');
    setPrimary(org.brandKit?.primary ?? '');
    setPrimaryFg(org.brandKit?.primaryFg ?? '');
    setAccent(org.brandKit?.accent ?? '');
    setAccentFg(org.brandKit?.accentFg ?? '');
    setLogoDot(org.brandKit?.logoDot ?? '');
    setFontFamilySans(org.brandKit?.fontFamilySans ?? '');
    setLogoPreviewError(false);
  }, [org]);

  if (query.isLoading) return <PageSkeleton />;
  if (query.isError || !org) {
    return <ErrorPanel message="Organizáciu sa nepodarilo načítať. Skús to znova." />;
  }

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

  /** Zostaví brandKit payload pre PATCH. Null = vynulovať celý brand kit. */
  function buildBrandKit(): {
    logoUrl: string | null;
    faviconUrl: string | null;
    primary: string | null;
    primaryFg: string | null;
    accent: string | null;
    accentFg: string | null;
    logoDot: string | null;
    fontFamilySans: string | null;
  } {
    return {
      logoUrl: logoUrl.trim() || null,
      faviconUrl: null, // v2: upload do Blob
      primary: primary.trim() || null,
      primaryFg: primaryFg.trim() || null,
      accent: accent.trim() || null,
      accentFg: accentFg.trim() || null,
      logoDot: logoDot.trim() || null,
      fontFamilySans: fontFamilySans.trim() || null,
    };
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

        <Section title="QR kódy — kontakt na vrátenie">
          <p className="-mt-1 text-xs text-text-secondary">
            Tieto informácie sa zobrazia na verejnej stránke po naskenovaní QR kódu nálezcom.
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

        {/* Branding (ADR-0028) */}
        <section className="rounded-xl border border-border-subtle bg-surface-card shadow-sm">
          <h2 className="border-b border-border-subtle px-5 py-3 text-sm font-semibold text-text-primary flex items-center gap-2">
            <Palette aria-hidden="true" className="h-4 w-4 text-brand-accent" />
            Branding
          </h2>
          <div className="space-y-4 p-5">
            <p className="-mt-1 text-xs text-text-secondary">
              Logo je dostupné pre všetky plány. Farby a font sú dostupné v pláne Pro.
            </p>

            {/* Logo URL */}
            <Field
              label="Logo URL"
              hint="HTTPS, PNG/JPEG/WEBP, odpoŕúčame 256×256 px. SVG nie je podporované (PDF limitačia)."
            >
              <input
                type="url"
                value={logoUrl}
                onChange={(e) => {
                  setLogoUrl(e.target.value);
                  setLogoPreviewError(false);
                }}
                placeholder="https://example.com/logo.png"
                className={inputCls()}
              />
            </Field>

            {/* Logo náhľad */}
            {logoUrl.trim() && !logoPreviewError && (
              <div className="flex items-center gap-3">
                <img
                  src={logoUrl.trim()}
                  alt="Náhľad loga"
                  className="h-12 w-auto max-w-[160px] rounded border border-border-subtle object-contain p-1"
                  onError={() => setLogoPreviewError(true)}
                />
                <span className="text-xs text-text-secondary">Náhľad</span>
              </div>
            )}
            {logoUrl.trim() && logoPreviewError && (
              <p className="text-xs text-danger-fg">
                Logo sa nepodarilo načítať — skontrolujte URL.
              </p>
            )}

            {/* Farby + font — Pro gating */}
            {org.plan === 'FREE' ? (
              <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4">
                <p className="flex items-center gap-2 text-sm text-text-secondary">
                  <Lock aria-hidden="true" className="h-4 w-4 shrink-0" />
                  Vlastné farby a font sú dostupné v pláne{' '}
                  <strong className="text-text-primary">Pro</strong>.
                </p>
                <a
                  href={`mailto:${UPGRADE_EMAIL}?subject=${encodeURIComponent('Záujem o plán Pro — Inventario')}`}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-brand-accent hover:underline"
                >
                  <Mail aria-hidden="true" className="h-3.5 w-3.5" />
                  Požiadať o Pro
                </a>
              </div>
            ) : (
              <>
                {/* Primárna farba */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Primárna farba" hint="Hex, napr. #003d7a">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={primary || '#1a2d47'}
                        onChange={(e) => setPrimary(e.target.value)}
                        className="h-9 w-10 cursor-pointer rounded border border-border-default bg-surface-card p-0.5"
                        aria-label="Vybrať primárnu farbu"
                      />
                      <input
                        type="text"
                        value={primary}
                        onChange={(e) => setPrimary(e.target.value)}
                        placeholder="#1a2d47"
                        className={inputCls() + ' font-mono'}
                      />
                    </div>
                  </Field>
                  <Field label="Text na primárnej" hint="Hex, napr. #ffffff">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={primaryFg || '#ffffff'}
                        onChange={(e) => setPrimaryFg(e.target.value)}
                        className="h-9 w-10 cursor-pointer rounded border border-border-default bg-surface-card p-0.5"
                        aria-label="Vybrať farbu textu na primárnej"
                      />
                      <input
                        type="text"
                        value={primaryFg}
                        onChange={(e) => setPrimaryFg(e.target.value)}
                        placeholder="#ffffff"
                        className={inputCls() + ' font-mono'}
                      />
                    </div>
                  </Field>
                </div>
                {/* Kontrast indikátor pre primárny pár */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted">Kontrast primárna/text:</span>
                  <ContrastBadge fg={primaryFg} bg={primary} />
                </div>

                {/* Akcentová farba */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Akcentová farba" hint="Hex, napr. #388fc3">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={accent || '#388fc3'}
                        onChange={(e) => setAccent(e.target.value)}
                        className="h-9 w-10 cursor-pointer rounded border border-border-default bg-surface-card p-0.5"
                        aria-label="Vybrať akcentovú farbu"
                      />
                      <input
                        type="text"
                        value={accent}
                        onChange={(e) => setAccent(e.target.value)}
                        placeholder="#388fc3"
                        className={inputCls() + ' font-mono'}
                      />
                    </div>
                  </Field>
                  <Field label="Text na akcente" hint="Hex, napr. #ffffff">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={accentFg || '#ffffff'}
                        onChange={(e) => setAccentFg(e.target.value)}
                        className="h-9 w-10 cursor-pointer rounded border border-border-default bg-surface-card p-0.5"
                        aria-label="Vybrať farbu textu na akcente"
                      />
                      <input
                        type="text"
                        value={accentFg}
                        onChange={(e) => setAccentFg(e.target.value)}
                        placeholder="#ffffff"
                        className={inputCls() + ' font-mono'}
                      />
                    </div>
                  </Field>
                </div>
                {/* Kontrast indikátor pre akcentový pár */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted">Kontrast akcentová/text:</span>
                  <ContrastBadge fg={accentFg} bg={accent} />
                </div>

                {/* Logo dot + font */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Logo dot" hint="Farba bodky v logu, napr. #388fc3">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={logoDot || accent || '#388fc3'}
                        onChange={(e) => setLogoDot(e.target.value)}
                        className="h-9 w-10 cursor-pointer rounded border border-border-default bg-surface-card p-0.5"
                        aria-label="Vybrať farbu logo dot"
                      />
                      <input
                        type="text"
                        value={logoDot}
                        onChange={(e) => setLogoDot(e.target.value)}
                        placeholder="#388fc3"
                        className={inputCls() + ' font-mono'}
                      />
                    </div>
                  </Field>
                  <Field label="Font" hint="Napr. 'Open Sans', system-ui, sans-serif">
                    <input
                      type="text"
                      value={fontFamilySans}
                      onChange={(e) => setFontFamilySans(e.target.value)}
                      placeholder="'Open Sans', system-ui, sans-serif"
                      className={inputCls()}
                    />
                  </Field>
                </div>

                {/* Náhľad CTA tlačidla */}
                {(primary || accent) && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-text-secondary">Náhľad</p>
                    <div className="flex flex-wrap items-center gap-3">
                      {primary && primaryFg && (
                        <span
                          className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold shadow-sm"
                          style={{ background: primary, color: primaryFg }}
                        >
                          Primárne CTA
                        </span>
                      )}
                      {accent && accentFg && (
                        <span
                          className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold shadow-sm"
                          style={{ background: accent, color: accentFg }}
                        >
                          Akcentové CTA
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
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

/**
 * ContrastBadge — WCAG 2.1 AA indikátor (ADR-0028 B8).
 * Zobrazí pomer kontrastu + zelený/červený badge.
 * Renderu sa len keď sú oba hex stringy platné.
 */
function ContrastBadge({ fg, bg }: { fg: string; bg: string }): JSX.Element | null {
  if (!HEX_RE.test(fg) || !HEX_RE.test(bg)) return null;
  const ratio = hexContrast(fg, bg);
  const passes = ratio >= 4.5;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${
        passes ? 'bg-success-bg text-success-fg' : 'bg-danger-bg text-danger-fg'
      }`}
      title={`WCAG AA: ${passes ? 'splňa' : 'nesplňa'} (${ratio}:1, minimum 4.5:1)`}
    >
      {passes ? '✓' : '✗'} {ratio}:1
    </span>
  );
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
