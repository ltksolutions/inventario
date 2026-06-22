// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * InvitationsContent — Slice #6c K18.6.
 *
 * Admin panel pre správu pozvaniek:
 *   - Send invitation form (email, roles, optional name)
 *   - Pending invitations table (email, roles, invited by, expires, revoke)
 *   - AccessDenied state for EMPLOYEE / EXTERNAL
 *
 * RBAC: ADMIN + ASSET_MANAGER. ASSET_MANAGER nemôže pozvať ADMIN
 * (backend to odmieta s 400; UI disabluje ADMIN option keď current
 * user nie je ADMIN).
 */

import { Loader2, Mail, RotateCcw, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { LoadingState } from './Spinner';

import type { FormEvent, JSX } from 'react';

import { useCanAdminUsers } from '@/lib/api-hooks';
import { useAuth } from '@/lib/auth-context';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const ALL_ROLES = ['ADMIN', 'ASSET_MANAGER', 'EMPLOYEE', 'EXTERNAL'] as const;
type Role = (typeof ALL_ROLES)[number];

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrátor',
  ASSET_MANAGER: 'Správca majetku',
  EMPLOYEE: 'Zamestnanec',
  EXTERNAL: 'Externý',
};

interface PendingInvitation {
  _id: string;
  email: string;
  role: Role;
  status?: string;
  invitedBy: string;
  invitedAt: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Error message mapping — API error codes/messages → Slovak UI strings
// ---------------------------------------------------------------------------

function mapApiError(raw: string | undefined): string {
  if (!raw) return 'Nastala neočakávaná chyba. Skúste znova.';
  const r = raw.toLowerCase();
  if (r.includes('already_member') || r.includes('already a member'))
    return 'Tento používateľ je už členom organizácie.';
  if (r.includes('only pending') || r.includes('can be resent'))
    return 'Opätovné odoslanie je možné len pre čakajúce pozvánky.';
  if (r.includes('invitation not found') || r.includes('not found'))
    return 'Pozvánka nebola nájdená. Možno už bola použitá alebo odvolaná.';
  if (r.includes('already sent') || r.includes('already exists'))
    return 'Pozvánka pre tento e-mail už existuje.';
  if (r.includes('expired')) return 'Platnosť pozvánky vypršala. Odošlite novú.';
  if (r.includes('cannot invite yourself') || r.includes('yourself'))
    return 'Nemôžete pozvať sami seba.';
  if (r.includes('domain') || r.includes('not allowed'))
    return 'Táto e-mailová doména nie je povolená pre vašu organizáciu.';
  return raw;
}

interface InvitationsResponse {
  data: PendingInvitation[];
  pagination: { total: number; limit: number; skip: number; hasMore: boolean };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function InvitationsContent(): JSX.Element {
  const { user, isLoading } = useAuth();
  const canAdmin = useCanAdminUsers();

  if (isLoading) {
    return <LoadingState className="min-h-48" />;
  }

  if (!canAdmin) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium text-text-primary">Prístup zamietnutý</p>
        <p className="text-xs text-text-secondary">
          Správa pozvaniek je dostupná iba pre Administrátora a Správcu majetku.
        </p>
      </div>
    );
  }

  const isAdmin = user?.role === 'ADMIN';

  return <InvitationsPanel isAdmin={isAdmin} />;
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

function InvitationsPanel({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [q, setQ] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Send form state
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState<Role>('EMPLOYEE');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendSuccess, setSendSuccess] = useState('');

  // Revoke state
  const [revoking, setRevoking] = useState<string | null>(null);
  // Resend state (ADR-0015 — backend POST /v1/invitations/:id/resend už existuje)
  const [resending, setResending] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState('');

  // -------------------------------------------------------------------------
  // Load invitations
  // -------------------------------------------------------------------------
  const load = async (search: string): Promise<void> => {
    setLoading(true);
    setFetchError('');
    try {
      const qs = search ? `?q=${encodeURIComponent(search)}` : '';
      const res = await fetch(`${API_BASE}/v1/invitations${qs}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        setFetchError('Nepodarilo sa načítať pozvánky.');
        return;
      }
      const body = (await res.json()) as InvitationsResponse;
      setInvitations(body.data.filter((inv) => inv.status === 'PENDING' || !inv.status));
      setTotal(body.data.filter((inv) => inv.status === 'PENDING' || !inv.status).length);
    } catch {
      setFetchError('Sieťová chyba. Skúste znova.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load('');
  }, []);

  const handleQChange = (value: string): void => {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void load(value), 300);
  };

  // -------------------------------------------------------------------------
  // Send invitation
  // -------------------------------------------------------------------------
  const handleSend = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSendError('');
    setSendSuccess('');
    setSending(true);

    try {
      const res = await fetch(`${API_BASE}/v1/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: email.toLowerCase().trim(),
          role: selectedRole,
          ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
          ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
        }),
      });

      if (res.ok) {
        setSendSuccess(`Pozvánka bola odoslaná na ${email}.`);
        setEmail('');
        setFirstName('');
        setLastName('');
        setSelectedRole('EMPLOYEE');
        void load(q);
        return;
      }

      const body = (await res.json()) as { message?: string };
      setSendError(mapApiError(body.message));
    } catch {
      setSendError('Sieťová chyba. Skúste znova.');
    } finally {
      setSending(false);
    }
  };

  // -------------------------------------------------------------------------
  // Revoke invitation
  // -------------------------------------------------------------------------
  const handleRevoke = async (id: string, invEmail: string): Promise<void> => {
    if (!confirm(`Naozaj chcete odvolať pozvánku pre ${invEmail}?`)) return;
    setRevoking(id);
    try {
      const res = await fetch(`${API_BASE}/v1/invitations/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        void load(q);
      } else {
        const body = (await res.json()) as { message?: string };
        setFetchError(mapApiError(body.message));
      }
    } catch {
      setFetchError('Sieťová chyba. Skúste znova.');
    } finally {
      setRevoking(null);
    }
  };

  // -------------------------------------------------------------------------
  // Resend invitation (nový token + predĺžená platnosť, znovu odošle e-mail)
  // -------------------------------------------------------------------------
  const handleResend = async (id: string, invEmail: string): Promise<void> => {
    setResending(id);
    setResendSuccess('');
    setFetchError('');
    try {
      const res = await fetch(`${API_BASE}/v1/invitations/${id}/resend`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        setResendSuccess(`Pozvánka bola znovu odoslaná na ${invEmail}.`);
        void load(q);
      } else {
        const body = (await res.json()) as { message?: string };
        setFetchError(mapApiError(body.message));
      }
    } catch {
      setFetchError('Sieťová chyba. Skúste znova.');
    } finally {
      setResending(null);
    }
  };

  // -------------------------------------------------------------------------
  // Role select helper (ADR-0029: single role)
  // -------------------------------------------------------------------------
  const selectRole = (role: Role): void => {
    setSelectedRole(role);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Pozvánky</h1>
        <p className="mt-0.5 text-sm text-text-secondary">
          Pozývajte nových členov do organizácie e-mailom.
        </p>
      </div>

      {/* Send invitation form */}
      <section className="rounded-xl border border-border-subtle bg-surface-card p-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-text-primary">
          <UserPlus aria-hidden="true" className="h-4 w-4 text-brand-accent" />
          Odoslať pozvánku
        </h2>

        {sendSuccess && (
          <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
            {sendSuccess}
          </div>
        )}
        {sendError && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
            {sendError}
          </div>
        )}

        <form onSubmit={(e) => void handleSend(e)} className="space-y-4">
          <div>
            <label htmlFor="inv-email" className="block text-sm font-medium text-text-primary">
              E-mail <span className="text-red-500">*</span>
            </label>
            <input
              id="inv-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jano@futbalsfz.sk"
              className="mt-1 block w-full max-w-sm rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
            />
          </div>

          {/* Optional name */}
          <div className="flex gap-3">
            <div>
              <label htmlFor="inv-first" className="block text-sm font-medium text-text-primary">
                Meno (voliteľné)
              </label>
              <input
                id="inv-first"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Ján"
                className="mt-1 block w-40 rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
              />
            </div>
            <div>
              <label htmlFor="inv-last" className="block text-sm font-medium text-text-primary">
                Priezvisko (voliteľné)
              </label>
              <input
                id="inv-last"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Novák"
                className="mt-1 block w-40 rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
              />
            </div>
          </div>

          {/* Role picker */}
          <div>
            <p className="block text-sm font-medium text-text-primary">
              Rola <span className="text-red-500">*</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {ALL_ROLES.map((role) => {
                const disabled = role === 'ADMIN' && !isAdmin;
                const selected = selectedRole === role;
                return (
                  <button
                    key={role}
                    type="button"
                    disabled={disabled}
                    onClick={() => selectRole(role)}
                    title={
                      disabled ? 'Iba Administrátor môže pozvať ďalšieho Administrátora' : undefined
                    }
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${
                      selected
                        ? 'border-brand-primary bg-brand-primary text-brand-primary-fg'
                        : 'border-border-default bg-surface-page text-text-primary hover:bg-surface-subtle'
                    } ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
                  >
                    {ROLE_LABELS[role]}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="submit"
            disabled={sending}
            className="flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-brand-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            {sending ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Mail aria-hidden="true" className="h-4 w-4" />
            )}
            Odoslať pozvánku
          </button>
        </form>
      </section>

      {/* Pending invitations table */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-text-primary">
            Čakajúce pozvánky
            {total > 0 && (
              <span className="ml-2 rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-normal text-text-secondary">
                {total}
              </span>
            )}
          </h2>
          <input
            type="search"
            value={q}
            onChange={(e) => handleQChange(e.target.value)}
            placeholder="Hľadať e-mail…"
            className="w-52 rounded-lg border border-border-default bg-surface-page px-3 py-1.5 text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
          />
        </div>

        {resendSuccess && (
          <div className="mb-3 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
            {resendSuccess}
          </div>
        )}
        {fetchError && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{fetchError}</div>
        )}

        {loading ? (
          <LoadingState className="min-h-24" label="Načítavam pozvánky…" />
        ) : invitations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-subtle bg-surface-subtle py-10 text-center">
            <p className="text-sm text-text-secondary">Žiadne čakajúce pozvánky.</p>
            <p className="mt-1 text-xs text-text-muted">
              Odošlite pozvánku vyplnením formulára vyššie.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border-subtle">
            <table className="min-w-full divide-y divide-border-subtle text-sm">
              <thead className="bg-surface-subtle">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-muted">
                    E-mail
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-muted">
                    Rola
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-muted">
                    Odoslaná
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-muted">
                    Platná do
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle bg-surface-card">
                {invitations.map((inv) => (
                  <InvitationRow
                    key={inv._id}
                    inv={inv}
                    revoking={revoking === inv._id}
                    resending={resending === inv._id}
                    onRevoke={() => void handleRevoke(inv._id, inv.email)}
                    onResend={() => void handleResend(inv._id, inv.email)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table row
// ---------------------------------------------------------------------------

function InvitationRow({
  inv,
  revoking,
  resending,
  onRevoke,
  onResend,
}: {
  inv: PendingInvitation;
  revoking: boolean;
  resending: boolean;
  onRevoke: () => void;
  onResend: () => void;
}): JSX.Element {
  const expiresAt = new Date(inv.expiresAt);
  const isExpired = expiresAt < new Date();
  const roleLabel = ROLE_LABELS[inv.role] ?? inv.role;

  return (
    <tr className="hover:bg-surface-subtle">
      <td className="px-4 py-3">
        <span className="font-medium text-text-primary">{inv.email}</span>
      </td>
      <td className="px-4 py-3 text-text-secondary">{roleLabel}</td>
      <td className="px-4 py-3 text-text-muted">
        {new Date(inv.invitedAt).toLocaleDateString('sk-SK')}
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs ${isExpired ? 'font-medium text-red-600' : 'text-text-muted'}`}>
          {isExpired ? 'Vypršaná' : expiresAt.toLocaleDateString('sk-SK')}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={onResend}
            disabled={resending || revoking}
            title="Odoslať pozvánku znovu (nový odkaz, predĺžená platnosť)"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-text-secondary transition hover:bg-surface-subtle hover:text-text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            {resending ? (
              <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw aria-hidden="true" className="h-3 w-3" />
            )}
            Odoslať znovu
          </button>
          <button
            type="button"
            onClick={onRevoke}
            disabled={revoking || resending}
            title="Odvolať pozvánku"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-text-secondary transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            {revoking ? (
              <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" className="h-3 w-3" />
            )}
            Odvolať
          </button>
        </div>
      </td>
    </tr>
  );
}
