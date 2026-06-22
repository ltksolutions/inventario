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

import {
  CheckCircle2,
  Copy,
  Fingerprint,
  Loader2,
  Mail,
  ShieldCheck,
  ShieldOff,
  Trash2,
  X,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { LoadingState } from './Spinner';

import type { FormEvent, JSX } from 'react';

import { useAuth } from '@/lib/auth-context';
import {
  getDeviceNameFromUA,
  isPasskeysSupported,
  registerPasskey,
  webauthnErrorMessage,
} from '@/lib/webauthn';

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
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const emailChanged = searchParams.get('emailChanged') === 'true';

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
  useEffect(() => {
    void loadStatus();
  }, []);

  // Refresh from server
  const refreshStatus = async (): Promise<void> => {
    setStatusLoaded(false);
    await loadStatus();
  };

  // ---------------------------------------------------------------------------
  // Sub-views
  // ---------------------------------------------------------------------------

  if (loadingStatus || !statusLoaded) {
    return <LoadingState className="min-h-48" />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Bezpečnosť</h1>
        <p className="mt-0.5 text-sm text-text-secondary">
          Správa dvojfaktorového overenia (MFA) a e-mailovej adresy.
        </p>
      </div>

      {emailChanged && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          ✅ E-mailová adresa bola úspešne zmená. Boli ste odhlásený zo všetkých last sessions.
        </div>
      )}

      {/* Email change — len pre LOCAL účty s heslom */}
      {user?.accountType === 'LOCAL' && <EmailChangePanel currentEmail={user.email} />}

      {/* Passkeys */}
      <PasskeysPanel />

      {status?.enabled ? (
        <MfaEnabledPanel status={status} onDisabled={() => void refreshStatus()} />
      ) : (
        <MfaDisabledPanel onEnabled={() => void refreshStatus()} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PasskeysPanel — správa passkey-ov (ADR-0016, Slice #8 K12)
// ---------------------------------------------------------------------------

interface PasskeyRow {
  _id: string;
  deviceName: string;
  transports: string[];
  backedUp: boolean;
  authenticatorAttachment: 'platform' | 'cross-platform' | null;
  createdAt: string;
  lastUsedAt: string | null;
}

function PasskeysPanel(): JSX.Element {
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const supported = isPasskeysSupported();

  const loadPasskeys = async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/auth/passkeys`, { credentials: 'include' });
      if (res.ok) {
        const data = (await res.json()) as { data: PasskeyRow[] };
        setPasskeys(data.data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPasskeys();
  }, []);

  const handleAdd = async (): Promise<void> => {
    setError('');
    setAdding(true);
    try {
      const deviceName = getDeviceNameFromUA();
      await registerPasskey(deviceName);
      await loadPasskeys();
    } catch (err) {
      setError(webauthnErrorMessage(err));
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    setDeletingId(id);
    try {
      await fetch(`${API_BASE}/v1/auth/passkeys/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      await loadPasskeys();
    } finally {
      setDeletingId(null);
    }
  };

  const handleRename = async (id: string): Promise<void> => {
    if (!renameValue.trim()) return;
    try {
      await fetch(`${API_BASE}/v1/auth/passkeys/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ deviceName: renameValue.trim() }),
      });
      setRenamingId(null);
      setRenameValue('');
      await loadPasskeys();
    } catch {
      // ignore
    }
  };

  if (!supported) return <></>;

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-card p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-surface-subtle">
            <Fingerprint className="h-5 w-5 text-text-muted" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Passkey</h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              Prihláste sa bez hesla cez Touch ID, Face ID alebo bezpečnostný klúč. Passkey-y
              fungujú vo všetkých organizáciách, kde ste členom.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={adding}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-semibold text-brand-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60"
        >
          {adding && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}+ Pridať
          passkey
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {loading ? (
        <LoadingState label="Načítavam passkeys…" />
      ) : passkeys.length === 0 ? (
        <p className="mt-4 text-xs text-text-muted">
          Zatiaľ nemáte žiadne passkey-y. Kliknite na „+ Pridať passkey“ pre registráciu.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border-subtle">
          {passkeys.map((pk) => (
            <li key={pk._id} className="py-3">
              {renamingId === pk._id ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="flex-1 rounded border border-border-default bg-surface-page px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-border-focus"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleRename(pk._id);
                      if (e.key === 'Escape') {
                        setRenamingId(null);
                        setRenameValue('');
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void handleRename(pk._id)}
                    className="text-xs font-medium text-brand-primary hover:underline"
                  >
                    Uložiť
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingId(null);
                      setRenameValue('');
                    }}
                    className="text-xs text-text-muted hover:text-text-primary"
                  >
                    Zrušiť
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-text-primary">{pk.deviceName}</p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      Pridané: {new Date(pk.createdAt).toLocaleDateString('sk-SK')}
                      {pk.lastUsedAt && (
                        <>
                          {' '}
                          · Posledné použitie: {new Date(pk.lastUsedAt).toLocaleDateString('sk-SK')}
                        </>
                      )}
                      {pk.backedUp && <> · ☁️ Synced</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingId(pk._id);
                        setRenameValue(pk.deviceName);
                      }}
                      className="text-xs text-text-muted hover:text-text-primary"
                    >
                      Premenovať
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(pk._id)}
                      disabled={deletingId === pk._id}
                      className="rounded p-1 text-text-muted transition hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
                      title="Odstrániť passkey"
                    >
                      {deletingId === pk._id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
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
// EmailChangePanel — zmena e-mailovej adresy (len LOCAL účty)
// ---------------------------------------------------------------------------

function EmailChangePanel({ currentEmail }: { currentEmail: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/auth/change-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newEmail, password }),
      });
      if (res.ok) {
        setSent(true);
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
    <div className="rounded-xl border border-border-subtle bg-surface-card p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-surface-subtle">
          <Mail className="h-5 w-5 text-text-muted" aria-hidden="true" />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">E-mailová adresa</h2>
              <p className="mt-0.5 text-sm text-text-secondary">{currentEmail}</p>
            </div>
            {!open && !sent && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="rounded-lg border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-surface-subtle"
              >
                Zmeniť
              </button>
            )}
          </div>

          {sent && (
            <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              Potvrdzovací e-mail bol odoslaný na <strong>{newEmail}</strong>. Platnosť 1 hodinu.
            </div>
          )}

          {open && !sent && (
            <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-3">
              {error && (
                <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
              )}
              <div>
                <label htmlFor="new-email" className="block text-sm font-medium text-text-primary">
                  Nová e-mailová adresa
                </label>
                <input
                  id="new-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="nova@adresa.sk"
                  className="mt-1 block w-full max-w-sm rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                />
              </div>
              <div>
                <label
                  htmlFor="change-email-pw"
                  className="block text-sm font-medium text-text-primary"
                >
                  Potvrdiť heslom
                </label>
                <input
                  id="change-email-pw"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Vaše aktuálne heslo"
                  className="mt-1 block w-full max-w-sm rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-brand-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60"
                >
                  {loading && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
                  Odoslať potvrdenie
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setError('');
                    setNewEmail('');
                    setPassword('');
                  }}
                  className="rounded-lg border border-border-default px-3 py-2 text-sm font-medium text-text-secondary transition hover:bg-surface-subtle"
                >
                  Zrušiť
                </button>
              </div>
            </form>
          )}
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
