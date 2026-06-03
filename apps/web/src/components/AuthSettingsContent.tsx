// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * AuthSettingsContent — ADR-0030 D3.
 *
 * /settings/auth — Prihlasovanie a domény (ADMIN only).
 *
 * Umožňuje tenant adminovi konfigurovať:
 *   - allowedAuthProviders: ktoré spôsoby prihlásenia sú povolené pre členov
 *   - memberJoinPolicy: INVITE_ONLY / DOMAIN_RESTRICTED / OPEN
 *   - autoJoinDomains: firemné domény pre DOMAIN_RESTRICTED policy
 *   - entraTenantId: Entra ID adresár pre obmedzenie Microsoft loginov
 *
 * Všetky zmeny sa ukladajú cez PATCH /v1/organisations/current.
 * Pozvánka má vždy prednosť — doménové nastavenia len zužujú kto smie
 * pozvánku prijať a akým kontom (ADR-0030).
 */

import { KeyRound, Loader2, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { FormEvent, JSX } from 'react';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AuthProvider = 'GOOGLE' | 'APPLE' | 'MICROSOFT' | 'EMAIL';
type MemberJoinPolicy = 'INVITE_ONLY' | 'DOMAIN_RESTRICTED' | 'OPEN';

interface OrgAuthSettings {
  allowedAuthProviders: AuthProvider[];
  memberJoinPolicy: MemberJoinPolicy;
  autoJoinDomains: string[];
  entraTenantId: string | null;
}

// ---------------------------------------------------------------------------
// Provider labels
// ---------------------------------------------------------------------------

const PROVIDER_LABELS: Record<AuthProvider, string> = {
  GOOGLE: 'Google',
  APPLE: 'Apple',
  MICROSOFT: 'Microsoft',
  EMAIL: 'E-mail + heslo',
};

const POLICY_LABELS: Record<MemberJoinPolicy, { label: string; description: string }> = {
  INVITE_ONLY: {
    label: 'Len pozvaní (odporúčané)',
    description: 'Nový člen sa môže pripojiť iba cez platnú pozvánku admina.',
  },
  DOMAIN_RESTRICTED: {
    label: 'Firemná doména (auto-join)',
    description:
      'Používatelia s e-mailom v povolených doménach sa môžu pripojiť bez individuálnej pozvánky.',
  },
  OPEN: {
    label: 'Otvorené (nebezpečné)',
    description: 'Ktokoľvek s platným kontom sa môže pridať. Odporúčame len pre testovacie orgy.',
  },
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AuthSettingsContent(): JSX.Element {
  const [settings, setSettings] = useState<OrgAuthSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Domain input state
  const [domainInput, setDomainInput] = useState('');

  const loadSettings = async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/organisations/current`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Nepodarilo sa načítať nastavenia.');
      const data = (await res.json()) as Record<string, unknown>;
      setSettings({
        allowedAuthProviders: (data['allowedAuthProviders'] as AuthProvider[]) ?? [
          'GOOGLE',
          'APPLE',
          'MICROSOFT',
          'EMAIL',
        ],
        memberJoinPolicy: (data['memberJoinPolicy'] as MemberJoinPolicy) ?? 'INVITE_ONLY',
        autoJoinDomains: (data['autoJoinDomains'] as string[]) ?? [],
        entraTenantId: (data['entraTenantId'] as string | null) ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nastala chyba.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const handleToggleProvider = (provider: AuthProvider): void => {
    if (!settings) return;
    const current = settings.allowedAuthProviders;
    if (current.includes(provider)) {
      if (current.length <= 1) return; // musí ostať aspoň jeden
      setSettings({ ...settings, allowedAuthProviders: current.filter((p) => p !== provider) });
    } else {
      setSettings({ ...settings, allowedAuthProviders: [...current, provider] });
    }
  };

  const handleAddDomain = (): void => {
    if (!settings) return;
    const domain = domainInput.trim().toLowerCase();
    if (!domain) return;
    // Jednoduchá validácia — backend validuje presnejšie
    if (
      !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)
    ) {
      setError(`Neplatná doména: ${domain}. Príklad: sfz.sk`);
      return;
    }
    if (settings.autoJoinDomains.includes(domain)) return;
    setSettings({ ...settings, autoJoinDomains: [...settings.autoJoinDomains, domain] });
    setDomainInput('');
  };

  const handleRemoveDomain = (domain: string): void => {
    if (!settings) return;
    setSettings({
      ...settings,
      autoJoinDomains: settings.autoJoinDomains.filter((d) => d !== domain),
    });
  };

  const handleSave = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!settings) return;
    setError('');
    setSuccess(false);
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/v1/organisations/current`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          allowedAuthProviders: settings.allowedAuthProviders,
          memberJoinPolicy: settings.memberJoinPolicy,
          autoJoinDomains: settings.autoJoinDomains,
          entraTenantId: settings.entraTenantId || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? 'Nastala chyba pri ukladaní.');
      }
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nastala chyba.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" aria-hidden="true" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Prihlasovanie a domény</h1>
        <p className="mt-0.5 text-sm text-text-secondary">
          Nastavenie spôsobov prihlásenia a doménovej politiky pre členov organizácie.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          ✅ Nastavenia boli uložené.
        </div>
      )}

      <form onSubmit={(e) => void handleSave(e)} className="space-y-6">
        {/* Spôsoby prihlásenia */}
        <div className="rounded-xl border border-border-subtle bg-surface-card p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-surface-subtle">
              <ShieldCheck className="h-5 w-5 text-text-muted" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-text-primary">
                Povolené spôsoby prihlásenia
              </h2>
              <p className="mt-0.5 text-xs text-text-secondary">
                Vyberte, akými kontami sa môžu členovia prihlásiť. Aspoň jeden musí ostať povolený.
                Pri registrácii novej organizácie sú dostupné všetky štyri rovnocenne.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {(['GOOGLE', 'APPLE', 'MICROSOFT', 'EMAIL'] as AuthProvider[]).map((provider) => {
                  const enabled = settings.allowedAuthProviders.includes(provider);
                  const isLast = settings.allowedAuthProviders.length === 1 && enabled;
                  return (
                    <button
                      key={provider}
                      type="button"
                      onClick={() => handleToggleProvider(provider)}
                      disabled={isLast}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
                        enabled
                          ? 'border-brand-primary bg-brand-primary/5 text-brand-primary'
                          : 'border-border-default bg-surface-page text-text-muted hover:border-border-focus hover:text-text-primary'
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <span
                        className={`h-4 w-4 flex-shrink-0 rounded-full border-2 ${
                          enabled
                            ? 'border-brand-primary bg-brand-primary'
                            : 'border-border-default'
                        }`}
                      />
                      {PROVIDER_LABELS[provider]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Politika členstva */}
        <div className="rounded-xl border border-border-subtle bg-surface-card p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-surface-subtle">
              <KeyRound className="h-5 w-5 text-text-muted" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-text-primary">
                Politika pridávania členov
              </h2>
              <p className="mt-0.5 text-xs text-text-secondary">
                Určuje, ako sa nový člen môže pridať do organizácie. Pozvánka od admina má vždy
                prednosť.
              </p>
              <div className="mt-4 space-y-2">
                {(['INVITE_ONLY', 'DOMAIN_RESTRICTED', 'OPEN'] as MemberJoinPolicy[]).map(
                  (policy) => {
                    const info = POLICY_LABELS[policy];
                    const selected = settings.memberJoinPolicy === policy;
                    const inputId = `policy-${policy}`;
                    return (
                      <label
                        key={policy}
                        htmlFor={inputId}
                        aria-label={info.label}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                          selected
                            ? 'border-brand-primary bg-brand-primary/5'
                            : 'border-border-default hover:border-border-focus'
                        }`}
                      >
                        <input
                          id={inputId}
                          type="radio"
                          name="memberJoinPolicy"
                          value={policy}
                          checked={selected}
                          onChange={() => setSettings({ ...settings, memberJoinPolicy: policy })}
                          className="mt-0.5 accent-brand-primary"
                        />
                        <span>
                          <span className="block text-sm font-medium text-text-primary">
                            {info.label}
                          </span>
                          <span className="block text-xs text-text-secondary">
                            {info.description}
                          </span>
                        </span>
                      </label>
                    );
                  },
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Povolené domény */}
        {settings.memberJoinPolicy === 'DOMAIN_RESTRICTED' && (
          <div className="rounded-xl border border-border-subtle bg-surface-card p-6">
            <h2 className="mb-1 text-sm font-semibold text-text-primary">
              Povolené firemné domény
            </h2>
            <p className="mb-4 text-xs text-text-secondary">
              Používatelia s e-mailom v týchto doménach sa môžu pripojiť aj bez individuálnej
              pozvánky. Príklad: <code className="font-mono">sfz.sk</code>
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={domainInput}
                onChange={(e) => {
                  setDomainInput(e.target.value);
                  setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddDomain();
                  }
                }}
                placeholder="priklad.sk"
                className="flex-1 rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
              />
              <button
                type="button"
                onClick={handleAddDomain}
                className="rounded-lg border border-brand-primary px-3 py-2 text-sm font-medium text-brand-primary transition hover:bg-brand-primary/5"
              >
                Pridať
              </button>
            </div>
            {settings.autoJoinDomains.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {settings.autoJoinDomains.map((domain) => (
                  <span
                    key={domain}
                    className="flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-subtle px-3 py-1 text-xs font-medium text-text-primary"
                  >
                    @{domain}
                    <button
                      type="button"
                      onClick={() => handleRemoveDomain(domain)}
                      className="text-text-muted hover:text-red-600"
                      title="Odstrániť doménu"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Entra Tenant ID */}
        <div className="rounded-xl border border-border-subtle bg-surface-card p-6">
          <h2 className="mb-1 text-sm font-semibold text-text-primary">
            Microsoft Entra ID — firemný adresár (voliteľné)
          </h2>
          <p className="mb-3 text-xs text-text-secondary">
            Ak je vyplnené, Microsoft prihlásenie členov sa obmedzí na konkrétny firemný Entra
            adresár (overenie <code className="font-mono">tid</code> claimu). Bez tohto nastavenia
            je Microsoft login otvorený pre akékoľvek Microsoft konto. UUID nájdete v{' '}
            <a
              href="https://portal.azure.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-primary hover:underline"
            >
              Azure Portal → Entra ID → Overview
            </a>
            .
          </p>
          <input
            type="text"
            value={settings.entraTenantId ?? ''}
            onChange={(e) =>
              setSettings({ ...settings, entraTenantId: e.target.value.trim() || null })
            }
            placeholder="00000000-0000-0000-0000-000000000000"
            className="w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 font-mono text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
            pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
            title="UUID formát: 00000000-0000-0000-0000-000000000000"
          />
          {settings.entraTenantId && (
            <p className="mt-2 text-xs text-amber-700">
              ⚠ Po nastavení sa len členovia z tohto Entra adresára budú môcť prihlásiť cez
              Microsoft. Overte správnosť UUID pred uložením.
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-brand-primary px-5 py-2.5 text-sm font-semibold text-brand-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            Uložiť nastavenia
          </button>
        </div>
      </form>
    </div>
  );
}
