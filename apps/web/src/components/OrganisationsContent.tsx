// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * OrganisationsContent — K22 (Slice #9e).
 *
 * Stránka pre správu vlastných memberships:
 *   - Zoznam organizácií, v ktorých je user členom
 *   - Nastavenie default org (POST /v1/memberships/:id/default)
 *   - Opustenie org (DELETE /v1/memberships/:id) + last-admin guard
 *
 * Dáta pochádzajú z availableOrganisations v auth contexte
 * (GET /v1/auth/me). Po každej akcii sa refresh() zavolá aby
 * sa zoznam aktualizoval.
 */

import { Building2, Loader2, LogOut, Star } from 'lucide-react';
import { useState } from 'react';

import type { JSX } from 'react';

import { useAuth } from '@/lib/auth-context';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrátor',
  ASSET_MANAGER: 'Správca majetku',
  EMPLOYEE: 'Zamestnanec',
  EXTERNAL: 'Externý',
};

export function OrganisationsContent(): JSX.Element {
  const { availableOrganisations, activeMembership, refresh, switchOrg } = useAuth();
  const [settingDefault, setSettingDefault] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const handleSetDefault = async (membershipId: string, orgId: string): Promise<void> => {
    setSettingDefault(membershipId);
    setActionError('');
    try {
      const res = await fetch(`${API_BASE}/v1/memberships/${membershipId}/default`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        // Switch to that org + refresh
        await switchOrg(orgId);
        await refresh();
        return;
      }
      const body = (await res.json()) as { message?: string };
      setActionError(body.message ?? 'Nepodarilo sa nastaviť default organizáciu.');
    } catch {
      setActionError('Sieťová chyba. Skúste znova.');
    } finally {
      setSettingDefault(null);
    }
  };

  const handleLeave = async (membershipId: string, orgName: string): Promise<void> => {
    if (!confirm(`Naozaj chcete opustiť organizáciu ${orgName}?`)) return;
    setLeaving(membershipId);
    setActionError('');
    try {
      const res = await fetch(`${API_BASE}/v1/memberships/${membershipId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        await refresh();
        return;
      }
      const body = (await res.json()) as { message?: string };
      setActionError(body.message ?? 'Nepodarilo sa opustiť organizáciu.');
    } catch {
      setActionError('Sieťová chyba. Skúste znova.');
    } finally {
      setLeaving(null);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-text-primary">
          <Building2 className="h-5 w-5 text-brand-accent" aria-hidden="true" />
          Moje organizácie
        </h1>
        <p className="mt-0.5 text-sm text-text-secondary">
          Organizácie, v ktorých ste členom. Nastavte predvolenú alebo opustite niektorú.
        </p>
      </div>

      {actionError && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{actionError}</div>
      )}

      {availableOrganisations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-subtle py-12 text-center">
          <p className="text-sm text-text-secondary">Nie ste členom žiadnej organizácie.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {availableOrganisations.map((org) => {
            const isActive = org.organisationId === activeMembership?.organisationId;
            const isDefault = org.isDefault;
            const isSettingDefault = settingDefault === org.membershipId;
            const isLeaving = leaving === org.membershipId;

            return (
              <div
                key={org.organisationId}
                className={`rounded-xl border p-4 transition ${
                  isActive
                    ? 'border-brand-primary bg-surface-subtle'
                    : 'border-border-subtle bg-surface-card'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {/* Org avatar */}
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
                      style={{ background: orgColor(org.organisationId) }}
                      aria-hidden="true"
                    >
                      {org.organisationName.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium text-text-primary">
                          {org.organisationName}
                        </p>
                        {isActive && (
                          <span className="rounded-full bg-brand-primary px-1.5 py-0.5 text-[10px] font-semibold text-brand-primary-fg">
                            Aktívna
                          </span>
                        )}
                        {isDefault && (
                          <Star
                            aria-label="Predvolená"
                            className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400"
                          />
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {ROLE_LABELS[org.role] ?? org.role}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {/* Set default */}
                    {!isDefault && (
                      <button
                        type="button"
                        onClick={() => void handleSetDefault(org.membershipId, org.organisationId)}
                        disabled={!!settingDefault || !!leaving}
                        title="Nastaviť ako predvolenú"
                        className="flex items-center gap-1 rounded-lg border border-border-default px-2 py-1 text-xs font-medium text-text-secondary transition hover:bg-surface-subtle disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                      >
                        {isSettingDefault ? (
                          <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
                        ) : (
                          <Star aria-hidden="true" className="h-3 w-3" />
                        )}
                        Predvolená
                      </button>
                    )}

                    {/* Leave */}
                    <button
                      type="button"
                      onClick={() => void handleLeave(org.membershipId, org.organisationName)}
                      disabled={!!leaving || !!settingDefault}
                      title="Opustiť organizáciu"
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-text-muted transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                    >
                      {isLeaving ? (
                        <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
                      ) : (
                        <LogOut aria-hidden="true" className="h-3 w-3" />
                      )}
                      Opustiť
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-text-muted">
        Ak ste posledný administrátor organizácie, nemôžete ju opustiť. Najprv povýšte iného člena
        na Administrátora.
      </p>
    </div>
  );
}

function orgColor(id: string): string {
  const palette = [
    '#1A2D47',
    '#388FC3',
    '#2E7D32',
    '#6A1B9A',
    '#BF360C',
    '#00695C',
    '#4527A0',
    '#AD1457',
  ];
  const seed = parseInt(id.slice(-4), 16);
  return palette[seed % palette.length] ?? '#1A2D47';
}
