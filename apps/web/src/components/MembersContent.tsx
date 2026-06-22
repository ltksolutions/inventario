// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * MembersContent — K21 (Slice #9e).
 *
 * Admin panel pre správu členov organizácie:
 *   - Tabuľka aktívnych memberships (displayName, email, roles, status)
 *   - Dialog na zmenu rolí (PATCH /v1/memberships/:id)
 *   - Tlačidlo na odstránenie člena (DELETE /v1/memberships/:id)
 *   - Last-admin warning pri poslednom ADMINovi
 *
 * RBAC: ADMIN only.
 */

import { Loader2, Pencil, Trash2, UserCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { LoadingState } from './Spinner';

import type { JSX } from 'react';

import { useAuth } from '@/lib/auth-context';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

const ALL_ROLES = ['ADMIN', 'ASSET_MANAGER', 'EMPLOYEE', 'EXTERNAL'] as const;
type Role = (typeof ALL_ROLES)[number];

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrátor',
  ASSET_MANAGER: 'Správca majetku',
  EMPLOYEE: 'Zamestnanec',
  EXTERNAL: 'Externý',
};

interface MemberRow {
  _id: string;
  userId: string;
  role: Role;
  status: string;
  isDefault: boolean;
  userEmail: string | null;
  userDisplayName: string | null;
  lastAccessedAt: string | null;
}

interface MembersResponse {
  data: MemberRow[];
  pagination: { total: number; limit: number; skip: number; hasMore: boolean };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function MembersContent(): JSX.Element {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  if (!isAdmin) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium text-text-primary">Prístup zamietnutý</p>
        <p className="text-xs text-text-secondary">
          Správa členov je dostupná iba pre Administrátora.
        </p>
      </div>
    );
  }

  return <MembersPanel currentUserId={user?._id ?? ''} />;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function MembersPanel({ currentUserId }: { currentUserId: string }): JSX.Element {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Edit dialog
  const [editTarget, setEditTarget] = useState<MemberRow | null>(null);
  const [editRole, setEditRole] = useState<Role>('EMPLOYEE');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Delete
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/v1/memberships?limit=200`, { credentials: 'include' });
      if (!res.ok) {
        setError('Nepodarilo sa načítať členov.');
        return;
      }
      const body = (await res.json()) as MembersResponse;
      setMembers(body.data);
      setTotal(body.pagination.total);
    } catch {
      setError('Sieťová chyba. Skúste znova.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openEdit = (m: MemberRow): void => {
    setEditTarget(m);
    setEditRole(m.role);
    setEditError('');
  };

  const handleSave = async (): Promise<void> => {
    if (!editTarget) return;
    setSaving(true);
    setEditError('');
    try {
      const res = await fetch(`${API_BASE}/v1/memberships/${editTarget._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role: editRole }),
      });
      if (res.ok) {
        setEditTarget(null);
        void load();
        return;
      }
      const body = (await res.json()) as { message?: string };
      setEditError(body.message ?? 'Nastala chyba.');
    } catch {
      setEditError('Sieťová chyba. Skúste znova.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (m: MemberRow): Promise<void> => {
    const name = m.userDisplayName ?? m.userEmail ?? m._id;
    if (!confirm(`Naozaj odstrániť člena ${name} z organizácie?`)) return;
    setDeleting(m._id);
    try {
      const res = await fetch(`${API_BASE}/v1/memberships/${m._id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        void load();
        return;
      }
      const body = (await res.json()) as { message?: string };
      setError(body.message ?? 'Nepodarilo sa odstrániť člena.');
    } catch {
      setError('Sieťová chyba. Skúste znova.');
    } finally {
      setDeleting(null);
    }
  };

  const adminCount = members.filter((m) => m.role === 'ADMIN').length;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-text-primary">
          <UserCheck className="h-5 w-5 text-brand-accent" aria-hidden="true" />
          Členovia organizácie
        </h1>
        <p className="mt-0.5 text-sm text-text-secondary">
          Spravujte roly a prístup členov. Každá organizácia musí mať aspoň jedného administrátora.
        </p>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      {loading ? (
        <LoadingState className="min-h-32" label="Načítavam členov…" />
      ) : members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-subtle py-12 text-center">
          <p className="text-sm text-text-secondary">Žiadni členovia.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-subtle">
          <div className="flex items-center justify-between bg-surface-subtle px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-text-muted">
            <span>Celkom: {total}</span>
            <span>Adminov: {adminCount}</span>
          </div>
          <table className="min-w-full divide-y divide-border-subtle text-sm">
            <thead className="bg-surface-subtle">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-muted">
                  Meno
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-muted">
                  Roly
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-muted">
                  Status
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle bg-surface-card">
              {members.map((m) => {
                const isLastAdmin = m.role === 'ADMIN' && adminCount === 1;
                const isSelf = m.userId === currentUserId;
                return (
                  <tr key={m._id} className="hover:bg-surface-subtle">
                    <td className="px-4 py-3">
                      <p className="font-medium text-text-primary">
                        {m.userDisplayName ?? '–'}
                        {isSelf && <span className="ml-1 text-xs text-text-muted">(vy)</span>}
                      </p>
                      <p className="text-xs text-text-muted">{m.userEmail ?? '–'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-medium text-text-secondary">
                        {ROLE_LABELS[m.role] ?? m.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-medium ${
                          m.status === 'ACTIVE' ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {m.status === 'ACTIVE' ? 'Aktívny' : 'Pozastavený'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(m)}
                          title="Upraviť roly"
                          className="rounded-lg p-1.5 text-text-muted transition hover:bg-surface-subtle hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                        >
                          <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(m)}
                          disabled={!!deleting || isLastAdmin}
                          title={
                            isLastAdmin ? 'Posledný admin — nemožno odstrániť' : 'Odstrániť člena'
                          }
                          className="rounded-lg p-1.5 text-text-muted transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                        >
                          {deleting === m._id ? (
                            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit roles dialog */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border-subtle bg-surface-card p-6 shadow-xl">
            <h2 className="mb-1 text-base font-semibold text-text-primary">Upraviť roly</h2>
            <p className="mb-4 text-xs text-text-secondary">
              {editTarget.userDisplayName ?? editTarget.userEmail}
            </p>

            {editError && (
              <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                {editError}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {ALL_ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setEditRole(role)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${
                    editRole === role
                      ? 'border-brand-primary bg-brand-primary text-brand-primary-fg'
                      : 'border-border-default bg-surface-page text-text-primary hover:bg-surface-subtle'
                  }`}
                >
                  {ROLE_LABELS[role]}
                </button>
              ))}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="rounded-lg border border-border-default px-3 py-2 text-sm font-medium text-text-secondary transition hover:bg-surface-subtle"
              >
                Zrušiť
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-brand-primary px-3 py-2 text-sm font-semibold text-brand-primary-fg transition hover:opacity-90 disabled:opacity-60"
              >
                {saving && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
                Uložiť
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
