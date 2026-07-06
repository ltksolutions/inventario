// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { AlertCircle, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { SelectField } from './SelectField';

import type { CategorySummary } from '@/lib/api-hooks';
import type { JSX, ReactNode } from 'react';

import { useCreateCategory } from '@/lib/api-hooks';
import { cn } from '@/lib/cn';

/**
 * Create category modal.
 *
 * MVP form scope: name + description (+ root pri tvorbe hodnoty). Ostatné
 * polia (color, icon, approvers, maxLoanDays, sortOrder) používajú
 * backend defaulty — pri tvorbe sú zriedka potrebné.
 *
 * Dvojúrovňový číselník (2026-06-09): kategórie majú presne 2 úrovne.
 *   - `mode = 'root'`  → vzniká ROOT kategória (skupina), ktorá len
 *     zoskupuje; majetok sa do nej zaradiť nedá. Bez výberu rodiča.
 *   - `mode = 'value'` → vzniká HODNOTA pod zvoleným rootom; sem sa už
 *     zaraďuje majetok. Rodič sa vyberá IBA spomedzi root kategórií
 *     (hodnota nemôže mať vlastné deti).
 *
 * Validation:
 *   - `name` required, 1-200 chars (matches CategorySchema).
 *   - `description` optional, max 1000 chars.
 *   - `parentId` povinný v režime 'value' (výber spomedzi rootov).
 *
 * Accessibility:
 *   - role="dialog" + aria-modal + aria-labelledby on the panel.
 *   - First text input auto-focused via useEffect so keyboard users
 *     can start typing immediately.
 *   - Escape key closes the dialog (handled at the document level so
 *     it fires regardless of which input has focus).
 *   - The close button (X icon) is the only mouse path to dismiss
 *     without submitting. We deliberately do NOT bind a click handler
 *     on the backdrop — a click-anywhere-to-close pattern on a
 *     non-interactive <div> requires a parallel keyboard handler
 *     that essentially duplicates the Escape one, plus a fake
 *     `role` to satisfy jsx-a11y, and the resulting widget acts like
 *     an interactive element to AT but isn't really. Escape + the
 *     visible Close button is the more accessible default.
 */

interface FormValues {
  name: string;
  description: string;
  parentId: string; // root mode: ignored; value mode: id zvoleného rootu
}

interface CategoryCreateDialogProps {
  existingCategories: readonly CategorySummary[];
  /** 'root' = nová skupina (root); 'value' = nová hodnota pod root. */
  mode: 'root' | 'value';
  onClose: () => void;
  onCreated: () => void;
  /** Predvyplnený root (ID) pri tvorbe hodnoty — napr. z hlavičky skupiny. */
  defaultParentId?: string | undefined;
}

export function CategoryCreateDialog({
  existingCategories,
  mode,
  onClose,
  onCreated,
  defaultParentId,
}: CategoryCreateDialogProps): JSX.Element {
  const createCategory = useCreateCategory();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  const isRoot = mode === 'root';

  // Rodič sa vyberá IBA spomedzi root kategórií (hodnota nemôže byť pod
  // hodnotou). Zoradené podľa názvu.
  const rootOptions = existingCategories
    .filter((c) => c.parentId == null)
    .map((c) => ({ id: c._id, label: c.name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'sk'));

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<FormValues>({
    mode: 'onBlur',
    defaultValues: {
      name: '',
      description: '',
      parentId: isRoot ? '' : (defaultParentId ?? rootOptions[0]?.id ?? ''),
    },
  });

  // Focus the name input on mount. We can't pass ref directly to
  // register() output without merging, so we expose this via the
  // register's own ref forwarding.
  const { ref: nameInputRef, ...nameInputProps } = register('name', {
    required: 'Názov je povinný.',
    minLength: { value: 1, message: 'Názov nesmie byť prázdny.' },
    maxLength: { value: 200, message: 'Maximálne 200 znakov.' },
  });

  // Close on Escape — attached at the document level so it fires
  // regardless of which input has focus. Re-attached only when the
  // close handler identity changes (effectively once).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Auto-focus on mount.
  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  function onSubmit(values: FormValues): void {
    setSubmitError(null);

    createCategory.mutate(
      {
        name: values.name.trim(),
        description: values.description.trim() || null,
        parentId: isRoot ? null : values.parentId || null,
      },
      {
        onSuccess: () => onCreated(),
        onError: (err) => setSubmitError(err.message),
      },
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-category-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="relative flex w-full max-w-lg flex-col gap-0 rounded-t-2xl bg-surface-card shadow-xl sm:rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-6 py-4">
          <div>
            <h2 id="create-category-title" className="text-lg font-semibold text-text-primary">
              {isRoot ? 'Nová root kategória' : 'Nová hodnota'}
            </h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              {isRoot
                ? 'Root len zoskupuje — majetok sa zaraďuje do hodnôt pod ním. Slug sa odvodí z názvu.'
                : 'Hodnota patrí pod zvolený root a zaraďuje sa do nej majetok. Slug sa odvodí z názvu.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zatvoriť"
            className="rounded-lg p-1.5 text-text-muted transition hover:bg-surface-subtle hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-6 py-5" noValidate>
          <Field label="Názov" required error={errors.name?.message}>
            <input
              ref={(el) => {
                nameInputRef(el);
                firstInputRef.current = el;
              }}
              type="text"
              placeholder={isRoot ? 'napr. IT majetok' : 'napr. Notebooky'}
              autoComplete="off"
              className={inputClasses()}
              {...nameInputProps}
            />
          </Field>

          {!isRoot ? (
            <Field
              label="Root kategória"
              required
              hint="Hodnota patrí pod jeden root. Hodnotu nie je možné vložiť pod inú hodnotu."
              error={errors.parentId?.message}
            >
              <Controller
                name="parentId"
                control={control}
                rules={{ required: 'Vyber root kategóriu.' }}
                render={({ field }) => (
                  <SelectField
                    label="Root kategória"
                    value={field.value}
                    onChange={field.onChange}
                    options={rootOptions.map((c) => ({ value: c.id, label: c.label }))}
                  />
                )}
              />
            </Field>
          ) : null}

          <Field label="Popis" error={errors.description?.message}>
            <textarea
              rows={3}
              placeholder="Voliteľný popis pre používateľov."
              {...register('description', {
                maxLength: { value: 1000, message: 'Maximálne 1000 znakov.' },
              })}
              className={inputClasses()}
            />
          </Field>

          {submitError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-danger-fg bg-danger-bg p-3 text-sm text-danger-fg"
            >
              <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          ) : null}

          <div className="-mx-6 -mb-5 flex flex-col-reverse gap-2 border-t border-border-subtle bg-surface-page/50 px-6 py-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={createCategory.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-card px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              Zrušiť
            </button>
            <button
              type="submit"
              disabled={!isValid || createCategory.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
              aria-live="polite"
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              {createCategory.isPending ? 'Vytváram…' : 'Vytvoriť'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  required,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  required?: boolean | undefined;
  hint?: string | undefined;
  error?: string | undefined;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline gap-1 text-sm font-medium text-text-secondary">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-danger-fg">
            *
          </span>
        ) : null}
      </span>
      {children}
      {hint ? <span className="text-xs text-text-muted">{hint}</span> : null}
      {error ? (
        <span role="alert" className="text-xs text-danger-fg">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function inputClasses(): string {
  return cn(
    'w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
  );
}
