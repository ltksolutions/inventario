// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * AuthSettingsContent — ADR-0030 D3 + ADR-0031 E6.
 *
 * /settings/auth — Prihlasovanie a domény (ADMIN only).
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

interface MicrosoftOAuthState {
  /** clientId from Azure — plaintext, not secret */
  clientId: string;
  /** New plaintext secret to set. Empty = keep existing. */
  clientSecret: string;
  tenantMode: string;
  /** Whether a secret is already stored (read from API) */
  hasSecret: boolean;
}

interface OrgAuthSettings {
  allowedAuthProviders: AuthProvider[];
  memberJoinPolicy: MemberJoinPolicy;
  autoJoinDomains: string[];
  entraTenantId: string | null;
  /** null = no per-tenant Microsoft app configured (uses platform fallback) */
  microsoftOAuthConfigured: boolean;
  microsoftClientId: string | null;
  microsoftTenantMode: string | null;
  microsoftHasSecret: boolean;
}

// ---------------------------------------------------------------------------
// Labels
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

  // Microsoft OAuth edit state (separate from settings to handle write-only secret)
  const [msOAuth, setMsOAuth] = useState<MicrosoftOAuthState>({
    clientId: '',
    clientSecret: '',
    tenantMode: 'organizations',
    hasSecret: false,
  });
  const [msOAuthEnabled, setMsOAuthEnabled] = useState(false);
  const [removingMsOAuth, setRemovingMsOAuth] = useState(false);

  const loadSettings = async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/organisations/current`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Nepodarilo sa načítať nastavenia.');
      const data = (await res.json()) as Record<string, unknown>;

      const oauthCreds = data['oauthCredentials'] as {
        microsoft?: {
          clientId?: string;
          tenantMode?: string | null;
          hasSecret?: boolean;
        } | null;
      } | null;

      const msConfig = oauthCreds?.microsoft ?? null;
      const hasMsApp = Boolean(msConfig?.clientId);

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
        microsoftOAuthConfigured: hasMsApp,
        microsoftClientId: msConfig?.clientId ?? null,
        microsoftTenantMode: msConfig?.tenantMode ?? null,
        microsoftHasSecret: msConfig?.hasSecret ?? false,
      });

      if (hasMsApp) {
        setMsOAuth({
          clientId: msConfig?.clientId ?? '',
          clientSecret: '',
          tenantMode: msConfig?.tenantMode ?? 'organizations',
          hasSecret: msConfig?.hasSecret ?? false,
        });
        setMsOAuthEnabled(true);
      }
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
      if (current.length <= 1) return;
      setSettings({ ...settings, allowedAuthProviders: current.filter((p) => p !== provider) });
    } else {
      setSettings({ ...settings, allowedAuthProviders: [...current, provider] });
    }
  };

  const handleAddDomain = (): void => {
    if (!settings) return;
    const domain = domainInput.trim().toLowerCase();
    if (!domain) return;
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
      // Build microsoftOAuth patch
      let microsoftOAuthPatch: Record<string, unknown> | null | undefined = undefined;

      if (removingMsOAuth) {
        // Odstrániť vlastnú app
        microsoftOAuthPatch = null;
      } else if (msOAuthEnabled) {
        if (!msOAuth.clientId.trim()) {
          setError('App (client) ID je povinné.');
          setSaving(false);
          return;
        }
        if (!msOAuth.hasSecret && !msOAuth.clientSecret.trim()) {
          setError('Client secret je povinný pri prvom nastavení Microsoft aplikácie.');
          setSaving(false);
          return;
        }
        microsoftOAuthPatch = {
          clientId: msOAuth.clientId.trim(),
          ...(msOAuth.clientSecret.trim() ? { clientSecret: msOAuth.clientSecret.trim() } : {}),
          tenantMode: msOAuth.tenantMode || 'organizations',
        };
      }

      const body: Record<string, unknown> = {
        allowedAuthProviders: settings.allowedAuthProviders,
        memberJoinPolicy: settings.memberJoinPolicy,
        autoJoinDomains: settings.autoJoinDomains,
        entraTenantId: settings.entraTenantId || null,
      };

      if (microsoftOAuthPatch !== undefined) {
        body['microsoftOAuth'] = microsoftOAuthPatch;
      }

      const res = await fetch(`${API_BASE}/v1/organisations/current`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const resBody = (await res.json()) as { message?: string };
        throw new Error(resBody.message ?? 'Nastala chyba pri ukladaní.');
      }

      // Reset secret field after save, update hasSecret
      if (microsoftOAuthPatch === null) {
        setMsOAuthEnabled(false);
        setRemovingMsOAuth(false);
        setMsOAuth({
          clientId: '',
          clientSecret: '',
          tenantMode: 'organizations',
          hasSecret: false,
        });
      } else if (microsoftOAuthPatch) {
        setMsOAuth((prev) => ({ ...prev, clientSecret: '', hasSecret: true }));
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
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {(
                  (process.env['NEXT_PUBLIC_APPLE_ENABLED'] === 'true'
                    ? ['GOOGLE', 'APPLE', 'MICROSOFT', 'EMAIL']
                    : ['GOOGLE', 'MICROSOFT', 'EMAIL']) as AuthProvider[]
                ).map((provider) => {
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
            adresár (overenie <code className="font-mono">tid</code> claimu). UUID nájdete v{' '}
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

        {/* Microsoft aplikácia (ADR-0031 E6) */}
        <div className="rounded-xl border border-border-subtle bg-surface-card p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">
                Microsoft aplikácia (vlastná)
              </h2>
              <p className="mt-0.5 text-xs text-text-secondary">
                Voliteľné: použiť vlastnú Azure App Registration pre Microsoft prihlásenie členov.
                Consent, audit a bezpečnostná izolácia sú potom vo vašom Azure adresári, nie v
                platformovej aplikácii Inventario.
              </p>
            </div>
            <div className="flex-shrink-0">
              {settings.microsoftOAuthConfigured ? (
                <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800">
                  Aktívna
                </span>
              ) : (
                <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-xs font-medium text-text-muted">
                  Platformová app
                </span>
              )}
            </div>
          </div>

          {!msOAuthEnabled && !removingMsOAuth ? (
            <button
              type="button"
              onClick={() => setMsOAuthEnabled(true)}
              className="rounded-lg border border-brand-primary px-3 py-2 text-sm font-medium text-brand-primary transition hover:bg-brand-primary/5"
            >
              {settings.microsoftOAuthConfigured
                ? 'Upraviť aplikáciu'
                : '+ Nastaviť vlastnú aplikáciu'}
            </button>
          ) : removingMsOAuth ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-medium text-red-800">
                Vlastná Microsoft aplikácia bude odstránená.
              </p>
              <p className="mt-1 text-xs text-red-700">
                Po uložení sa Microsoft prihlásenie vráti na platformovú aplikáciu Inventario.
              </p>
              <button
                type="button"
                onClick={() => setRemovingMsOAuth(false)}
                className="mt-2 text-xs text-red-600 hover:underline"
              >
                Zrušiť odstránenie
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="ms-client-id"
                  className="block text-xs font-medium text-text-primary"
                >
                  App (client) ID
                </label>
                <p className="mb-1 text-xs text-text-muted">
                  Z Azure Portal → App registrations → Overview. Nie je tajné.
                </p>
                <input
                  id="ms-client-id"
                  type="text"
                  value={msOAuth.clientId}
                  onChange={(e) => setMsOAuth({ ...msOAuth, clientId: e.target.value })}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  className="w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 font-mono text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                />
              </div>

              <div>
                <label
                  htmlFor="ms-client-secret"
                  className="block text-xs font-medium text-text-primary"
                >
                  Client secret{' '}
                  {msOAuth.hasSecret && (
                    <span className="font-normal text-text-muted">
                      (nastavený — vyplňte len ak chcete zmeniť)
                    </span>
                  )}
                </label>
                <p className="mb-1 text-xs text-text-muted">
                  Z Azure Portal → App registrations → Certificates &amp; secrets. Ukladá sa
                  zašifrovaný, nikdy nie je viditeľný spätne.
                </p>
                <input
                  id="ms-client-secret"
                  type="password"
                  autoComplete="new-password"
                  value={msOAuth.clientSecret}
                  onChange={(e) => setMsOAuth({ ...msOAuth, clientSecret: e.target.value })}
                  placeholder={msOAuth.hasSecret ? '••••••••••••••••••••' : 'Vložte client secret'}
                  className="w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 font-mono text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                />
              </div>

              <div>
                <label
                  htmlFor="ms-tenant-mode"
                  className="block text-xs font-medium text-text-primary"
                >
                  Tenant mode
                </label>
                <select
                  id="ms-tenant-mode"
                  value={msOAuth.tenantMode}
                  onChange={(e) => setMsOAuth({ ...msOAuth, tenantMode: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                >
                  <option value="organizations">organizations — firemné/školské kontá</option>
                  <option value="common">common — firemné aj osobné MS kontá</option>
                  <option value={settings.entraTenantId ?? ''} disabled={!settings.entraTenantId}>
                    {settings.entraTenantId
                      ? `${settings.entraTenantId} — len váš Entra adresár`
                      : 'konkrétny UUID (nastavte Entra Tenant ID vyššie)'}
                  </option>
                </select>
              </div>

              <p className="text-xs text-text-muted">
                Redirect URI pre túto aplikáciu:{' '}
                <code className="font-mono">
                  {API_BASE.replace('/v1', '')}/v1/auth/callback/microsoft
                </code>
                . Musí byť nakonfigurovaná v Azure App Registration.
              </p>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setMsOAuthEnabled(false);
                    setMsOAuth({
                      clientId: settings.microsoftClientId ?? '',
                      clientSecret: '',
                      tenantMode: settings.microsoftTenantMode ?? 'organizations',
                      hasSecret: settings.microsoftHasSecret,
                    });
                  }}
                  className="text-sm text-text-muted hover:text-text-primary"
                >
                  Zrušiť
                </button>
                {settings.microsoftOAuthConfigured && (
                  <button
                    type="button"
                    onClick={() => {
                      setRemovingMsOAuth(true);
                      setMsOAuthEnabled(false);
                    }}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Odstrániť vlastnú aplikáciu
                  </button>
                )}
              </div>
            </div>
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
