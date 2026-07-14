// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { USER_ROLE_VALUES } from '@inventario/shared-types';
import { AlertCircle, Clock, Package, Save, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { LoadingState } from './Spinner';

import type { LoanSummary } from '@/lib/api-hooks';
import type { JSX, ReactNode } from 'react';

import {
  useLoanRequests,
  useLoans,
  useRemoveMembership,
  useUpdateMembershipRole,
  useUpdateUser,
  useUser,
} from '@/lib/api-hooks';
import { cn } from '@/lib/cn';

/**
 * User detail / edit dialog.
 *
 * Osoby/Používatelia merge (2026-07-14): this dialog now serves BOTH
 * roles that can reach the merged "Používatelia" page. `canEdit`
 * (true for ADMIN, false for ASSET_MANAGER) switches between the two:
 *
 *   - canEdit=true  (ADMIN): unchanged edit behaviour — role radio +
 *     isActive toggle + danger zone "Odobrať z organizácie", see below.
 *   - canEdit=false (ASSET_MANAGER): read-only — no mutation hooks are
 *     invoked, role/status are shown as plain text, no danger zone.
 *     The backend enforces this too (PATCH /v1/users/:id and
 *     PATCH/DELETE /v1/memberships/:id are ADMIN-only) — this prop only
 *     controls what the UI *offers*, it isn't the security boundary.
 *
 * Both modes now also show a "Výpožičky tejto osoby" section (current +
 * pending + history), previously only available on the standalone
 * /persons/[id] "osobná karta majetku" page (removed by this merge).
 * Ported from PersonDetailContent — same useLoans/useLoanRequests calls,
 * same current/pending/history split.
 *
 * Loads the full UserDetail via `useUser(id)` so the dialog has
 * fresh data even if the list cache is stale. Two editable surfaces
 * (canEdit=true only):
 *
 *   1. Role — single-select radio (ADR-0029: a member has exactly ONE
 *      Membership.role). Changing it goes through
 *      PATCH /v1/memberships/:id (the users endpoint deliberately
 *      ignores roles — User.roles[] is a legacy stale field).
 *   2. isActive toggle — goes through PATCH /v1/users/:id.
 *
 * Both changes can be combined in one save; the dialog issues the two
 * PATCHes sequentially (role first) and closes only when both succeed.
 *
 * Pre-emptive self-guardrails (when isSelf is true):
 *   - The whole role group is disabled ("Nemôžete si zmeniť vlastnú
 *     rolu") — with a single role, any change on self would be a
 *     self-demote. Backend enforces last-admin too.
 *   - The isActive toggle is disabled ("Nemôžete sa sami deaktivovať").
 *
 * Last-active-admin guardrail is server-side only: we can't detect
 * it client-side without a count query, and the backend already
 * returns a user-friendly message. The dialog surfaces that message
 * verbatim through the error state.
 *
 * Submit semantics:
 *   - Only changed fields are sent; no diff → submit disabled.
 *   - The dialog stays open after a refused mutation so the user
 *     can read the error and adjust.
 */

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrátor',
  ASSET_MANAGER: 'Správca majetku',
  EMPLOYEE: 'Zamestnanec',
  EXTERNAL: 'Externý',
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  ADMIN: 'Plný prístup, správa používateľov.',
  ASSET_MANAGER: 'Eviduje majetok, schvaľuje výpožičky.',
  EMPLOYEE: 'Bežný používateľ — môže si požičať pre seba.',
  EXTERNAL: 'Externý spolupracovník s obmedzeným prístupom.',
};

interface UserEditDialogProps {
  userId: string;
  isSelf: boolean;
  /**
   * ADMIN=true — full edit surface (role, isActive, danger zone).
   * ASSET_MANAGER=false — read-only detail view. See file header.
   */
  canEdit: boolean;
  onClose: () => void;
}

export function UserEditDialog({
  userId,
  isSelf,
  canEdit,
  onClose,
}: UserEditDialogProps): JSX.Element {
  const userQuery = useUser(userId);
  const updateUser = useUpdateUser();
  const updateRole = useUpdateMembershipRole();
  const removeMembership = useRemoveMembership();
  const loansQuery = useLoans({ borrowerId: userId, limit: 200 });
  const pendingQuery = useLoanRequests({
    requesterId: userId,
    beneficiaryId: userId,
    status: 'PENDING',
    limit: 50,
  });
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  const isPending = updateUser.isPending || updateRole.isPending || removeMembership.isPending;
  // Submit-level error: any mutation's failure, surfaced verbatim.
  const mutationError = updateRole.error ?? updateUser.error ?? removeMembership.error;

  // Form state — initialised from the fetched user, then user-edited.
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [isActive, setIsActive] = useState(true);
  const [initialised, setInitialised] = useState(false);
  // Destructive "remove from organisation" flow: 0 = idle, 1 = first confirm,
  // 2 = final confirm (armed only after a 5s cool-off). Two deliberate
  // confirmations + a timer so it can't fire on a reflex double-click.
  const [removeStep, setRemoveStep] = useState<0 | 1 | 2>(0);
  const [removeCountdown, setRemoveCountdown] = useState(0);

  // Initialise form state from fetched user, exactly once. We use a
  // `initialised` flag rather than a JSON.stringify dependency to
  // avoid resetting the user's in-progress edits if the server
  // returns a stale refetch mid-edit.
  useEffect(() => {
    if (userQuery.data && !initialised) {
      setSelectedRole(userQuery.data.roles?.[0] ?? '');
      setIsActive(userQuery.data.isActive);
      setInitialised(true);
    }
  }, [userQuery.data, initialised]);

  // Close on Escape, focus cancel on mount — same patterns as the
  // other dialogs in the codebase.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !isPending) {
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, isPending]);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  // 5-second cool-off before the final "remove from organisation" button arms.
  useEffect(() => {
    if (removeStep !== 2) {
      return;
    }
    setRemoveCountdown(5);
    const interval = setInterval(() => {
      setRemoveCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [removeStep]);

  // membershipId is required for role changes. Null means the backend
  // couldn't resolve an ACTIVE membership — role editing is then
  // disabled with an explanatory hint (data inconsistency, not a
  // normal state).
  const membershipId = userQuery.data?.membershipId ?? null;

  // Compute what (if anything) has changed against the original.
  const patch = useMemo(() => {
    if (!userQuery.data || !initialised) {
      return null;
    }
    const original = userQuery.data;
    const originalRole = original.roles?.[0] ?? '';
    const roleChanged = selectedRole !== '' && selectedRole !== originalRole;
    const activeChanged = isActive !== original.isActive;

    if (!roleChanged && !activeChanged) {
      return null;
    }
    return {
      role: roleChanged ? selectedRole : undefined,
      isActive: activeChanged ? isActive : undefined,
    };
  }, [userQuery.data, initialised, selectedRole, isActive]);

  function onSubmit(): void {
    if (!patch || isPending) {
      return;
    }
    void (async () => {
      try {
        // Role first — it's the more constrained operation (last-admin
        // guardrail). If it's refused, we don't touch isActive either,
        // so the save stays all-or-nothing from the user's view.
        if (patch.role !== undefined && membershipId) {
          await updateRole.mutateAsync({ membershipId, userId, role: patch.role });
        }
        if (patch.isActive !== undefined) {
          await updateUser.mutateAsync({ id: userId, patch: { isActive: patch.isActive } });
        }
        onClose();
      } catch {
        // Error surfaces via mutationError — dialog stays open so the
        // user can read the backend's message and adjust.
      }
    })();
  }

  // Remove the user from the current organisation (DELETE membership).
  // Two-step confirm; backend enforces the last-admin guardrail and the
  // message surfaces verbatim via mutationError.
  function onRemove(): void {
    // Only fires from the final step, after the 5s cool-off has elapsed.
    if (!membershipId || isPending || removeStep !== 2 || removeCountdown > 0) {
      return;
    }
    void (async () => {
      try {
        await removeMembership.mutateAsync({ membershipId, userId });
        onClose();
      } catch {
        // Error surfaces via mutationError; reset the flow so the admin
        // has to re-confirm deliberately.
        setRemoveStep(0);
      }
    })();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-user-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col gap-0 overflow-hidden rounded-t-2xl bg-surface-card shadow-xl sm:rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-6 py-4">
          <div>
            <h2 id="edit-user-title" className="text-lg font-semibold text-text-primary">
              {canEdit ? 'Upraviť používateľa' : 'Detail používateľa'}
            </h2>
            {userQuery.data ? (
              <p className="mt-0.5 text-xs text-text-secondary">
                {userQuery.data.displayName} · {userQuery.data.email}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="Zatvoriť"
            className="rounded-lg p-1.5 text-text-muted transition hover:bg-surface-subtle hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-5">
          {/*
            Order matters: check isError BEFORE the loading/!initialised
            gate. `initialised` only flips once data arrives, so on an
            errored query (e.g. 404) `!initialised` stays true forever —
            putting the loading branch first would leave the dialog stuck
            on the shimmer instead of surfacing the error.
          */}
          {userQuery.isError ? (
            <ErrorPanel
              message={
                (userQuery.error as Error & { status?: number })?.status === 404
                  ? 'Používateľ nebol nájdený. Pravdepodobne ho už zmazal niekto iný.'
                  : 'Detail používateľa sa nepodarilo načítať. Skúste znova.'
              }
            />
          ) : userQuery.isLoading || !initialised ? (
            <LoadingState label="Načítavam detail používateľa…" />
          ) : canEdit ? (
            <DialogBody
              selectedRole={selectedRole}
              isActive={isActive}
              isSelf={isSelf}
              roleEditDisabled={isSelf || membershipId === null}
              membershipMissing={membershipId === null}
              onSelectRole={setSelectedRole}
              onToggleActive={() => {
                if (!isSelf) {
                  setIsActive((v) => !v);
                }
              }}
            />
          ) : userQuery.data ? (
            <ReadOnlySummary roles={userQuery.data.roles} isActive={userQuery.data.isActive} />
          ) : null}

          {mutationError ? (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-lg border border-danger-fg bg-danger-bg p-3 text-sm text-danger-fg"
            >
              <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>{mutationError.message}</span>
            </div>
          ) : null}

          {/*
            Danger zone — remove from organisation. Separated from the normal
            save flow and clearly framed: deactivation (above) is the
            recommended way to off-board; removal only drops membership and
            never deletes the account or its history. Two confirmations + a
            5-second cool-off before the final action arms.
          */}
          {userQuery.data && membershipId && !isSelf && canEdit ? (
            <div className="mt-6 rounded-lg border border-danger-fg/40 bg-danger-bg/40 p-4">
              <h3 className="text-sm font-semibold text-text-primary">Odobrať z organizácie</h3>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                Odoberie používateľa z tejto organizácie. <strong>Nezmaže</strong> jeho účet ani
                históriu (výpožičky, žiadosti, protokoly) — len členstvo, ktoré sa dá obnoviť
                opätovnou pozvánkou. Pri skončení pracovného pomeru je vhodnejšie účet{' '}
                <strong>deaktivovať</strong> (vyššie) — ostane v zozname a história sa zachová.
              </p>

              {removeStep === 0 ? (
                <button
                  type="button"
                  onClick={() => setRemoveStep(1)}
                  disabled={isPending}
                  className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-danger-fg px-3 py-2 text-sm font-medium text-danger-fg transition hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                  Odobrať z organizácie…
                </button>
              ) : removeStep === 1 ? (
                <div className="mt-3 space-y-2">
                  <p className="text-sm font-medium text-text-primary">
                    Naozaj odobrať {userQuery.data.displayName} z organizácie? (krok 1 z 2)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setRemoveStep(2)}
                      disabled={isPending}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-danger-fg px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                    >
                      Pokračovať
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoveStep(0)}
                      disabled={isPending}
                      className="rounded-lg px-3 py-2 text-sm font-medium text-text-secondary transition hover:text-text-primary disabled:opacity-50"
                    >
                      Zrušiť
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="text-sm font-medium text-danger-fg">
                    Posledné potvrdenie (krok 2 z 2) — táto akcia je definitívna.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={onRemove}
                      disabled={isPending || removeCountdown > 0}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-danger-fg px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                      {removeMembership.isPending
                        ? 'Odoberám…'
                        : removeCountdown > 0
                          ? `Počkajte… ${removeCountdown} s`
                          : 'Odobrať definitívne'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoveStep(0)}
                      disabled={removeMembership.isPending}
                      className="rounded-lg px-3 py-2 text-sm font-medium text-text-secondary transition hover:text-text-primary disabled:opacity-50"
                    >
                      Zrušiť
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          <LoansSection loansQuery={loansQuery} pendingQuery={pendingQuery} />
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border-subtle bg-surface-page/50 px-6 py-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            ref={cancelButtonRef}
            onClick={onClose}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-card px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            {canEdit ? 'Zrušiť' : 'Zavrieť'}
          </button>
          {canEdit ? (
            <button
              type="button"
              onClick={onSubmit}
              disabled={patch === null || isPending || !initialised}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
              aria-live="polite"
            >
              <Save aria-hidden="true" className="h-4 w-4" />
              {isPending ? 'Ukladám…' : 'Uložiť zmeny'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog body — role radio group + isActive toggle
// ---------------------------------------------------------------------------

interface DialogBodyProps {
  selectedRole: string;
  isActive: boolean;
  isSelf: boolean;
  /** Disable the whole role group (self-edit or missing membership). */
  roleEditDisabled: boolean;
  /** True when the backend couldn't resolve an ACTIVE membership. */
  membershipMissing: boolean;
  onSelectRole: (role: string) => void;
  onToggleActive: () => void;
}

function DialogBody({
  selectedRole,
  isActive,
  isSelf,
  roleEditDisabled,
  membershipMissing,
  onSelectRole,
  onToggleActive,
}: DialogBodyProps): JSX.Element {
  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="text-sm font-medium text-text-primary">Rola</legend>
        <p className="mt-0.5 text-xs text-text-secondary">
          {membershipMissing
            ? 'Členstvo používateľa sa nepodarilo načítať — rolu teraz nie je možné zmeniť.'
            : isSelf
              ? 'Nemôžete si zmeniť vlastnú rolu. Požiadajte iného administrátora.'
              : 'Každý člen má práve jednu rolu. Zmena sa prejaví okamžite.'}
        </p>
        <ul className="mt-3 space-y-2">
          {USER_ROLE_VALUES.map((role) => {
            const checked = selectedRole === role;
            const inputId = `user-edit-role-${role}`;
            return (
              <li key={role}>
                <label
                  htmlFor={inputId}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border bg-surface-card p-3 transition',
                    checked ? 'border-brand-primary' : 'border-border-subtle',
                    roleEditDisabled
                      ? 'cursor-not-allowed opacity-70'
                      : 'cursor-pointer hover:border-border-default hover:bg-surface-subtle',
                  )}
                >
                  <input
                    id={inputId}
                    type="radio"
                    name="user-edit-role"
                    checked={checked}
                    disabled={roleEditDisabled}
                    onChange={() => {
                      if (!roleEditDisabled) {
                        onSelectRole(role);
                      }
                    }}
                    aria-label={ROLE_LABELS[role] ?? role}
                    className="mt-0.5 h-4 w-4 cursor-pointer border-border-default text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-not-allowed"
                  />
                  <span className="flex flex-1 flex-col">
                    <span className="text-sm font-medium text-text-primary">
                      {ROLE_LABELS[role] ?? role}
                    </span>
                    <span className="text-xs text-text-secondary">
                      {ROLE_DESCRIPTIONS[role] ?? null}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <Field
        label="Aktívny účet"
        hint={
          isSelf
            ? 'Nemôžete sa sami deaktivovať. Požiadajte iného administrátora.'
            : 'Odporúčaný spôsob pri odchode zamestnanca: deaktivovaný účet sa nevie prihlásiť, ale ostáva v zozname a celá história (výpožičky, žiadosti, protokoly) sa zachová. Dá sa kedykoľvek reaktivovať.'
        }
      >
        {/*
          Inline checkbox + label. We attach explicit htmlFor/id rather
          than relying on the implicit-association pattern (input nested
          in label) because the codebase's jsx-a11y config flags the
          implicit form here.
        */}
        <div
          className={cn(
            'inline-flex items-center gap-2',
            isSelf ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
          )}
        >
          <input
            id="user-edit-is-active"
            type="checkbox"
            checked={isActive}
            disabled={isSelf}
            onChange={onToggleActive}
            className="h-4 w-4 rounded border-border-default text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-not-allowed"
          />
          <label
            htmlFor="user-edit-is-active"
            className={cn(
              'text-sm text-text-primary',
              isSelf ? 'cursor-not-allowed' : 'cursor-pointer',
            )}
          >
            Účet je aktívny
          </label>
        </div>
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small layout helpers
// ---------------------------------------------------------------------------

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-text-primary">{label}</span>
      {children}
      {hint ? <span className="text-xs text-text-muted">{hint}</span> : null}
    </div>
  );
}

function ErrorPanel({ message }: { message: string }): JSX.Element {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-danger-fg bg-danger-bg p-3 text-sm text-danger-fg"
    >
      <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Read-only role/status summary (canEdit=false replacement for DialogBody)
// ---------------------------------------------------------------------------

const ROLE_LABELS_READONLY: Record<string, string> = {
  ADMIN: 'Administrátor',
  ASSET_MANAGER: 'Správca majetku',
  EMPLOYEE: 'Zamestnanec',
  EXTERNAL: 'Externý',
};

function ReadOnlySummary({ roles, isActive }: { roles: string[]; isActive: boolean }): JSX.Element {
  const role = roles[0] ?? null;
  return (
    <div className="space-y-3">
      <Field label="Rola">
        <p className="text-sm text-text-primary">
          {role ? (ROLE_LABELS_READONLY[role] ?? role) : '—'}
        </p>
      </Field>
      <Field label="Stav účtu">
        <p className="text-sm text-text-primary">{isActive ? 'Aktívny' : 'Deaktivovaný'}</p>
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Výpožičky tejto osoby — ported from the removed /persons/[id]
// "osobná karta majetku" (PersonDetailContent), compacted for the dialog.
// Shown for both canEdit values (2026-07-14 Osoby/Používatelia merge).
// ---------------------------------------------------------------------------

const LOAN_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Aktívna', className: 'bg-green-50 text-green-700 ring-green-600/20' },
  RETURNED: {
    label: 'Vrátená',
    className: 'bg-surface-subtle text-text-muted ring-border-subtle',
  },
  DAMAGED: { label: 'Poškodená', className: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
  LOST: { label: 'Stratená', className: 'bg-red-50 text-red-700 ring-red-600/20' },
  OVERDUE: { label: 'Po termíne', className: 'bg-red-50 text-red-700 ring-red-600/20' },
};

function formatLoanDate(iso: string | null): string {
  if (iso == null) return 'do odvolania';
  return new Date(iso).toLocaleDateString('sk-SK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function LoansSection({
  loansQuery,
  pendingQuery,
}: {
  loansQuery: ReturnType<typeof useLoans>;
  pendingQuery: ReturnType<typeof useLoanRequests>;
}): JSX.Element {
  const allLoans = loansQuery.data?.data ?? [];
  const currentLoans = allLoans.filter((loan) => loan.status === 'ACTIVE');
  const historyLoans = allLoans.filter((loan) => loan.status !== 'ACTIVE');
  const pendingRequests = pendingQuery.data?.data ?? [];

  return (
    <div className="mt-6 border-t border-border-subtle pt-5">
      <h3 className="text-sm font-semibold text-text-primary">Výpožičky tejto osoby</h3>

      {loansQuery.isLoading ? (
        <p className="mt-2 text-xs text-text-secondary">Načítavam výpožičky…</p>
      ) : loansQuery.isError ? (
        <p className="mt-2 text-xs text-danger-fg">Výpožičky sa nepodarilo načítať.</p>
      ) : (
        <div className="mt-3 space-y-4">
          <LoansMiniList
            heading={`Aktuálny majetok (${currentLoans.length})`}
            loans={currentLoans}
            emptyMessage="Nemá aktuálne v držaní žiadny majetok."
          />
          {pendingRequests.length > 0 ? (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Čakajúce žiadosti ({pendingRequests.length})
              </h4>
              <ul className="mt-1.5 space-y-1">
                {pendingRequests.map((req) => (
                  <li key={req._id} className="text-xs text-text-secondary">
                    {req.items.map((item, idx) => (
                      <span key={`${item.categoryId}-${idx}`}>
                        {idx > 0 ? ', ' : ''}
                        {item.quantityRequested}× {item.categorySnapshot.name}
                      </span>
                    ))}
                    {' — '}
                    {req.purpose}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <LoansMiniList
            heading={`História (${historyLoans.length})`}
            loans={historyLoans}
            emptyMessage="Zatiaľ žiadna história výpožičiek."
          />
        </div>
      )}
    </div>
  );
}

function LoansMiniList({
  heading,
  loans,
  emptyMessage,
}: {
  heading: string;
  loans: readonly LoanSummary[];
  emptyMessage: string;
}): JSX.Element {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{heading}</h4>
      {loans.length === 0 ? (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-text-secondary">
          <Package aria-hidden="true" className="h-3.5 w-3.5" />
          {emptyMessage}
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {loans.map((loan) => {
            const isOverdue = loan.isOverdue && loan.status === 'ACTIVE';
            const statusKey = isOverdue ? 'OVERDUE' : loan.status;
            const statusConfig = LOAN_STATUS_CONFIG[statusKey] ?? {
              label: loan.status,
              className: 'bg-surface-subtle text-text-muted',
            };
            return (
              <li key={loan._id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-text-primary">
                  {loan.items.map((item) => item.snapshot.inventoryNumber).join(', ')}
                </span>
                <span className="text-text-secondary">
                  {formatLoanDate(loan.pickedUpAt)}
                  {loan.status === 'ACTIVE' ? ` → ${formatLoanDate(loan.dueAt)}` : ''}
                </span>
                {isOverdue ? <Clock aria-hidden="true" className="h-3 w-3 text-red-600" /> : null}
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 font-medium ring-1 ring-inset',
                    statusConfig.className,
                  )}
                >
                  {statusConfig.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
