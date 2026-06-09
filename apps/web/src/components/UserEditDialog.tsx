// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { USER_ROLE_VALUES } from '@inventario/shared-types';
import { AlertCircle, Save, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { JSX, ReactNode } from 'react';

import { useUpdateMembershipRole, useUpdateUser, useUser } from '@/lib/api-hooks';
import { cn } from '@/lib/cn';

/**
 * Edit user dialog (admin).
 *
 * Loads the full UserDetail via `useUser(id)` so the dialog has
 * fresh data even if the list cache is stale. Two editable surfaces:
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
  onClose: () => void;
}

export function UserEditDialog({ userId, isSelf, onClose }: UserEditDialogProps): JSX.Element {
  const userQuery = useUser(userId);
  const updateUser = useUpdateUser();
  const updateRole = useUpdateMembershipRole();
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  const isPending = updateUser.isPending || updateRole.isPending;
  // Submit-level error: either mutation's failure, surfaced verbatim.
  const mutationError = updateRole.error ?? updateUser.error;

  // Form state — initialised from the fetched user, then user-edited.
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [isActive, setIsActive] = useState(true);
  const [initialised, setInitialised] = useState(false);

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-user-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="relative flex w-full max-w-lg flex-col gap-0 rounded-t-2xl bg-surface-card shadow-xl sm:rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-6 py-4">
          <div>
            <h2 id="edit-user-title" className="text-lg font-semibold text-text-primary">
              Upraviť používateľa
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

        <div className="px-6 py-5">
          {userQuery.isLoading || !initialised ? (
            <LoadingShimmer />
          ) : userQuery.isError ? (
            <ErrorPanel
              message={
                (userQuery.error as Error & { status?: number })?.status === 404
                  ? 'Používateľ nebol nájdený. Pravdepodobne ho už zmazal niekto iný.'
                  : 'Detail používateľa sa nepodarilo načítať. Skúste znova.'
              }
            />
          ) : (
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
          )}

          {mutationError ? (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-lg border border-danger-fg bg-danger-bg p-3 text-sm text-danger-fg"
            >
              <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>{mutationError.message}</span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border-subtle bg-surface-page/50 px-6 py-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            ref={cancelButtonRef}
            onClick={onClose}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-card px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            Zrušiť
          </button>
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
            : 'Deaktivovaný účet nemôže pristupovať do aplikácie, ale jeho história zostane zachovaná.'
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

function LoadingShimmer(): JSX.Element {
  return (
    <div aria-busy="true" aria-label="Načítavam detail" className="space-y-3">
      <div className="h-4 w-24 animate-pulse rounded bg-surface-subtle" />
      <div className="h-14 animate-pulse rounded-lg bg-surface-subtle" />
      <div className="h-14 animate-pulse rounded-lg bg-surface-subtle" />
      <div className="h-14 animate-pulse rounded-lg bg-surface-subtle" />
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
