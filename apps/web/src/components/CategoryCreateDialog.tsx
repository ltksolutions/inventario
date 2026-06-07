// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { AlertCircle, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';

import type { CategorySummary } from '@/lib/api-hooks';
import type { JSX, ReactNode } from 'react';

import { useCreateCategory } from '@/lib/api-hooks';
import { categoryPath } from '@/lib/category-tree';
import { cn } from '@/lib/cn';

/**
 * Create category modal.
 *
 * MVP form scope: name + description + parent. Other fields (color,
 * icon, approvers, maxLoanDays, sortOrder) use backend defaults —
 * they're rarely needed at creation time, and editing them later will
 * live in the (yet-to-be-built) edit form.
 *
 * Zlúčený číselník (2026-06-08): kategórie sú jeden strom. Bez rodiča
 * vzniká ROOT kategória — skupina/„typ majetku", ktorá len zoskupuje
 * (majetok sa do nej zaradiť nedá). S rodičom vzniká podkategória, do
 * ktorej sa už majetok zaraďuje.
 *
 * Validation:
 *   - `name` required, 1-200 chars (matches CategorySchema).
 *   - `description` optional, max 1000 chars.
 *   - `parentId` optional; the select lists existing categories.
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
  parentId: string; // empty string = no parent (root category)
}

interface CategoryCreateDialogProps {
  existingCategories: readonly CategorySummary[];
  onClose: () => void;
  onCreated: () => void;
  /** Predvyplnený rodič (ID) — napr. z aktívnej skupiny v Číselníkoch. */
  defaultParentId?: string | undefined;
}

export function CategoryCreateDialog({
  existingCategories,
  onClose,
  onCreated,
  defaultParentId,
}: CategoryCreateDialogProps): JSX.Element {
  const createCategory = useCreateCategory();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isValid },
  } = useForm<FormValues>({
    mode: 'onBlur',
    defaultValues: {
      name: '',
      description: '',
      parentId: defaultParentId ?? '',
    },
  });

  const byId = new Map(existingCategories.map((c) => [c._id, c]));
  const parentOptions = existingCategories
    .map((c) => ({ id: c._id, label: categoryPath(c, byId) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'sk'));
  const isRoot = watch('parentId') === '';

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
        parentId: values.parentId || null,
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
              Nová kategória
            </h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              Slug sa odvodí z názvu automaticky. Ostatné polia môžeš upraviť neskôr.
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
              placeholder="napr. Notebooky"
              autoComplete="off"
              className={inputClasses()}
              {...nameInputProps}
            />
          </Field>

          <Field
            label="Nadradená kategória"
            hint={
              isRoot
                ? 'Bez rodiča vznikne nová skupina (root) — slúži len na zoskupenie, majetok sa zaraďuje do podkategórií.'
                : 'Nová kategória bude podkategóriou zvoleného rodiča.'
            }
          >
            <select {...register('parentId')} className={inputClasses()}>
              <option value="">— Žiadna (nová skupina) —</option>
              {parentOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

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
