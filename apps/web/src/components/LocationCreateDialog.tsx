// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { LOCATION_TYPE_VALUES } from '@inventario/shared-types';
import { AlertCircle, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { SelectField } from './SelectField';

import type { LocationSummary } from '@/lib/api-hooks';
import type { JSX, ReactNode } from 'react';

import { useCreateLocation } from '@/lib/api-hooks';
import { cn } from '@/lib/cn';

/**
 * Create location modal.
 *
 * MVP form scope: name + type + description + parent. Other backend
 * fields (address, coordinates, managerId, sortOrder, slug) use
 * backend defaults — address + coordinates rarely matter at creation
 * time for small pilots, managerId needs a users picker we don't
 * have yet, and slug is derived from name. They all become editable
 * via the (yet-to-be-built) edit form, matching the categories MVP
 * approach exactly.
 *
 * Validation:
 *   - `name` required, 1-200 chars (matches LocationSchema).
 *   - `type` required, must be one of LOCATION_TYPE_VALUES.
 *   - `description` optional, max 2000 chars (location descriptions
 *     run longer than category ones — they describe physical sites).
 *   - `parentId` optional; the select lists existing locations.
 *
 * Accessibility:
 *   Same patterns as CategoryCreateDialog — role="dialog",
 *   aria-modal, aria-labelledby, auto-focused first input, Escape
 *   closes, visible close button is the only mouse-dismiss path.
 *   See CategoryCreateDialog for the rationale (backdrop-click
 *   dismiss is deliberately omitted).
 */

interface FormValues {
  name: string;
  type: string;
  description: string;
  parentId: string; // empty string = no parent (root location)
}

const LOCATION_TYPE_LABELS: Record<string, string> = {
  HEADQUARTERS: 'Sídlo',
  BRANCH: 'Pobočka',
  WAREHOUSE: 'Hlavný sklad',
  OFFICE: 'Kancelária',
  STADIUM: 'Štadión / areál',
  TRAINING_CENTER: 'Tréningové centrum',
  EXTERNAL: 'Externé miesto',
  IN_TRANSIT: 'V preprave',
};

interface LocationCreateDialogProps {
  existingLocations: readonly LocationSummary[];
  onClose: () => void;
  onCreated: () => void;
}

export function LocationCreateDialog({
  existingLocations,
  onClose,
  onCreated,
}: LocationCreateDialogProps): JSX.Element {
  const createLocation = useCreateLocation();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<FormValues>({
    mode: 'onBlur',
    defaultValues: {
      name: '',
      type: 'OFFICE',
      description: '',
      parentId: '',
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

    createLocation.mutate(
      {
        name: values.name.trim(),
        type: values.type,
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
      aria-labelledby="create-location-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="relative flex w-full max-w-lg flex-col gap-0 rounded-t-2xl bg-surface-card shadow-xl sm:rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-6 py-4">
          <div>
            <h2 id="create-location-title" className="text-lg font-semibold text-text-primary">
              Nová lokalita
            </h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              Slug sa odvodí z názvu automaticky. Adresu a manažéra môžeš doplniť neskôr.
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
              placeholder="napr. Hlavný sklad Bratislava"
              autoComplete="off"
              className={inputClasses()}
              {...nameInputProps}
            />
          </Field>

          <Field label="Typ lokality" required>
            <Controller
              name="type"
              control={control}
              rules={{ required: true }}
              render={({ field }) => (
                <SelectField
                  label="Typ lokality"
                  value={field.value}
                  onChange={field.onChange}
                  options={LOCATION_TYPE_VALUES.map((t) => ({
                    value: t,
                    label: LOCATION_TYPE_LABELS[t] ?? t,
                  }))}
                />
              )}
            />
          </Field>

          <Field
            label="Nadradená lokalita"
            hint="Nepovinné. Vyber, ak nová lokalita patrí pod existujúcu (napr. kancelária v štadióne)."
          >
            <Controller
              name="parentId"
              control={control}
              render={({ field }) => (
                <SelectField
                  label="Nadradená lokalita"
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: '', label: '— Žiadna (root) —' },
                    ...existingLocations.map((l) => ({ value: l._id, label: l.name })),
                  ]}
                />
              )}
            />
          </Field>

          <Field label="Popis" error={errors.description?.message}>
            <textarea
              rows={3}
              placeholder="Voliteľný popis (napr. otváracie hodiny, prístup, kontaktná osoba)."
              {...register('description', {
                maxLength: { value: 2000, message: 'Maximálne 2000 znakov.' },
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
              disabled={createLocation.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-card px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              Zrušiť
            </button>
            <button
              type="submit"
              disabled={!isValid || createLocation.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
              aria-live="polite"
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              {createLocation.isPending ? 'Vytváram…' : 'Vytvoriť'}
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
