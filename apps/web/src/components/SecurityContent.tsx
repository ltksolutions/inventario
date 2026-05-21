// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * SecurityContent — Slice #7 K7.7.
 *
 * /settings/security — MFA management page.
 *
 * States:
 *   1. MFA disabled — show enable button → triggers setup flow
 *   2. MFA setup in progress — show QR code + secret + recovery codes
 *      → user scans, enters first code to confirm
 *   3. MFA enabled — show status, recovery code count, disable option
 *
 * Setup flow (3 steps):
 *   Step 1: POST /v1/auth/mfa/setup → QR + secret + recovery codes shown
 *   Step 2: User enters first TOTP code to confirm
 *   Step 3: POST /v1/auth/mfa/verify-setup → activated
 *
 * Disable flow:
 *   Password re-entry → POST /v1/auth/mfa/disable
 */

import { CheckCircle2, Copy, Loader2, ShieldCheck, ShieldOff, X } from 'lucide-react';
import { useState } from 'react';

import type { FormEvent, JSX } from 'react';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
}

interface SetupData {
  secret: string;
  otpauthUrl: string;
  recoveryCodes: string[];
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SecurityContent(): JSX.Element {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);

  const loadStatus = async (): Promise<void> => {
    if (statusLoaded) return;
    setLoadingStatus(true);
    try {
      const res = await fetch(`${API_BASE}/v1/auth/mfa/status`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = (await res.json()) as MfaStatus;
        setStatus(data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingStatus(false);
      setStatusLoaded(true);
    }
  };

  // Load status on mount
  useState(() => {
    void loadStatus();
  });

  // Refresh from server
  const refreshStatus = async (): Promise<void> => {
    setStatusLoaded(false);
    await loadStatus();
  };

  // ---------------------------------------------------------------------------
  // Sub-views
  // ---------------------------------------------------------------------------

  if (loadingStatus || !statusLoaded) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Bezpečnosť</h1>
        <p className="mt-0.5 text-sm text-text-secondary">Správa dvojfaktorového overenia (MFA).</p>
      </div>

      {status?.enabled ? (
        <MfaEnabledPanel status={status} onDisabled={() => void refreshStatus()} />
      ) : (
        <MfaDisabledPanel onEnabled={() => void refreshStatus()} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MFA disabled panel — shows enable button + setup flow
// ---------------------------------------------------------------------------

function MfaDisabledPanel({ onEnabled }: { onEnabled: () => void }): JSX.Element {
  const [step, setStep] = useState<'idle' | 'setup' | 'confirm' | 'done'>('idle');
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'secret' | 'code' | null>(null);

  const handleSetup = async (): Promise<void> => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/auth/mfa/setup`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        setError(body.message ?? 'Nastala chyba. Skúste znova.');
        return;
      }
      const data = (await res.json()) as SetupData;
      setSetupData(data);
      setStep('setup');
    } catch {
      setError('Sieťová chyba. Skúste znova.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/auth/mfa/verify-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: confirmCode }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        setError(body.message ?? 'Neplatný kód. Skúste znova.');
        setConfirmCode('');
        return;
      }
      setStep('done');
      setTimeout(() => onEnabled(), 1500);
    } catch {
      setError('Sieťová chyba. Skúste znova.');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string, key: 'secret' | 'code'): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  if (step === 'done') {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
        <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-green-600" aria-hidden="true" />
        <p className="font-semibold text-green-800">MFA bolo úspešne aktivované!</p>
      </div>
    );
  }

  if (step === 'setup' && setupData) {
    return (
      <div className="space-y-6">
        {/* Step indicator */}
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-primary text-xs font-bold text-brand-primary-fg">
            1
          </span>
          Naskenujte QR kód v autentifikačnej aplikácii
          <span className="mx-2 text-text-muted">→</span>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-subtle text-xs font-medium text-text-muted">
            2
          </span>
          Potvrďte kódom
        </div>

        {/* QR code via Google Charts API */}
        <div className="rounded-xl border border-border-subtle bg-surface-card p-6">
          <h2 className="mb-4 text-sm font-semibold text-text-primary">
            Krok 1 — Pridajte účet do aplikácie
          </h2>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            {/* QR rendered via Google Charts */}
            <div className="flex-shrink-0 rounded-lg border border-border-subtle bg-white p-2">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(setupData.otpauthUrl)}`}
                alt="QR kód pre MFA"
                width={160}
                height={160}
                className="block"
              />
            </div>
            <div className="flex-1 space-y-3">
              <p className="text-sm text-text-secondary">
                Naskenujte QR kód pomocou <strong>Google Authenticator</strong>,{' '}
                <strong>Authy</strong> alebo inej TOTP aplikácie.
              </p>
              <div>
                <p className="mb-1 text-xs font-medium text-text-muted">
                  Alebo zadajte kľúč ručne:
                </p>
                <div className="flex items-center gap-2 rounded-lg bg-surface-subtle px-3 py-2">
                  <code className="flex-1 break-all font-mono text-xs text-text-primary">
                    {setupData.secret}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyToClipboard(setupData.secret, 'secret')}
                    className="flex-shrink-0 text-text-muted hover:text-text-primary"
                    title="Kopírovať"
                  >
                    {copied === 'secret' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Recovery codes */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="mb-1 text-sm font-semibold text-amber-900">
            ⚠ Záložné kódy — uložte si ich teraz
          </h2>
          <p className="mb-3 text-xs text-amber-800">
            Tieto kódy sa zobrazujú iba raz. Ak stratíte prístup k aplikácii, použite jeden z nich.
            Každý kód funguje iba raz.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {setupData.recoveryCodes.map((code) => (
              <code
                key={code}
                className="rounded bg-white px-2 py-1 text-center font-mono text-xs text-text-primary shadow-sm"
              >
                {code}
              </code>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void copyToClipboard(setupData.recoveryCodes.join('\n'), 'code')}
            className="mt-3 flex items-center gap-1 text-xs text-amber-700 hover:underline"
          >
            {copied === 'code' ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            Kopírovať všetky kódy
          </button>
        </div>

        {/* Confirm step */}
        <div className="rounded-xl border border-border-subtle bg-surface-card p-6">
          <h2 className="mb-3 text-sm font-semibold text-text-primary">
            Krok 2 — Potvrďte aktiváciu
          </h2>
          <p className="mb-4 text-sm text-text-secondary">
            Zadajte 6-miestny kód z autentifikačnej aplikácie.
          </p>

          {error && (
            <div className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
          )}

          <form onSubmit={(e) => void handleConfirm(e)} className="flex gap-3">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              minLength={6}
              maxLength={6}
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="w-32 rounded-lg border border-border-default bg-surface-page px-3 py-2 text-center font-mono text-lg tracking-[0.4em] text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
            />
            <button
              type="submit"
              disabled={loading || confirmCode.length < 6}
              className="flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-brand-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              {loading && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
              Aktivovať MFA
            </button>
          </form>
        </div>

        <button
          type="button"
          onClick={() => setStep('idle')}
          className="text-xs text-text-muted hover:text-text-primary hover:underline"
        >
          ← Zrušiť nastavenie
        </button>
      </div>
    );
  }

  // Idle state — show enable button
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-card p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-surface-subtle">
          <ShieldOff className="h-5 w-5 text-text-muted" aria-hidden="true" />
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-text-primary">Dvojfaktorové overenie (MFA)</h2>
          <p className="mt-1 text-sm text-text-secondary">
            MFA nie je aktivované. Pridajte druhý faktor pre lepšiu ochranu účtu.
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            Funguje s Google Authenticator, Authy, 1Password a inými TOTP aplikáciami.
          </p>
          {error && (
            <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
          )}
          <button
            type="button"
            onClick={() => void handleSetup()}
            disabled={loading}
            className="mt-4 flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-brand-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            {loading && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
            Aktivovať MFA
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MFA enabled panel — shows status + disable option
// ---------------------------------------------------------------------------

function MfaEnabledPanel({
  status,
  onDisabled,
}: {
  status: MfaStatus;
  onDisabled: () => void;
}): JSX.Element {
  const [showDisableForm, setShowDisableForm] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDisable = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/auth/mfa/disable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        onDisabled();
        return;
      }
      const body = (await res.json()) as { message?: string };
      setError(body.message ?? 'Nastala chyba. Skúste znova.');
    } catch {
      setError('Sieťová chyba. Skúste znova.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Status card */}
      <div className="rounded-xl border border-green-200 bg-green-50 p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-green-100">
            <ShieldCheck className="h-5 w-5 text-green-700" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-green-900">MFA je aktívne</h2>
            {status.enabledAt && (
              <p className="mt-0.5 text-xs text-green-800">
                Aktivované: {new Date(status.enabledAt).toLocaleDateString('sk-SK')}
              </p>
            )}
            <p className="mt-1 text-sm text-green-800">
              Zostatok záložných kódov:{' '}
              <span
                className={`font-semibold ${status.recoveryCodesRemaining <= 2 ? 'text-amber-700' : ''}`}
              >
                {status.recoveryCodesRemaining} / 8
              </span>
            </p>
            {status.recoveryCodesRemaining <= 2 && (
              <p className="mt-1 text-xs text-amber-700">
                Odporúčame deaktivovať a znovu aktivovať MFA pre nové záložné kódy.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Disable section */}
      <div className="rounded-xl border border-border-subtle bg-surface-card p-6">
        {!showDisableForm ? (
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Deaktivovať MFA</h2>
              <p className="mt-0.5 text-xs text-text-secondary">
                Na deaktiváciu je potrebné zadať heslo.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowDisableForm(true)}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              Deaktivovať
            </button>
          </div>
        ) : (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">Potvrdiť deaktiváciu</h2>
              <button
                type="button"
                onClick={() => {
                  setShowDisableForm(false);
                  setPassword('');
                  setError('');
                }}
                className="text-text-muted hover:text-text-primary"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>

            {error && (
              <div className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </div>
            )}

            <form onSubmit={(e) => void handleDisable(e)} className="space-y-3">
              <div>
                <label htmlFor="disable-pw" className="block text-sm font-medium text-text-primary">
                  Heslo
                </label>
                <input
                  id="disable-pw"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Vaše heslo"
                  className="mt-1 block w-full max-w-xs rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              >
                {loading && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
                Deaktivovať MFA
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
