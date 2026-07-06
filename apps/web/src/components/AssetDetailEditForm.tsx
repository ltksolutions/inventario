// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { ASSET_STATUS_VALUES } from '@inventario/shared-types';
import { AlertCircle, Save, X } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { Combobox } from './Combobox';
import { DateField } from './DateField';
import { SelectField } from './SelectField';
import { TagsCombobox } from './TagsCombobox';

import type {
  AssetDetail,
  AssetUpdatePatch,
  CategorySummary,
  LocationSummary,
} from '@/lib/api-hooks';
import type { JSX, ReactNode } from 'react';

import {
  useAssetConditions,
  useCanManageTaxonomy,
  useCreateAssetConditions,
  useCreateLocation,
  useRenameAssetCondition,
  useRenameCategory,
  useRenameLocation,
  useUpdateAsset,
} from '@/lib/api-hooks';
import { buildGroupedCategoryOptions } from '@/lib/category-tree';
import { cn } from '@/lib/cn';
import { focusFirstInvalidField } from '@/lib/form-scroll';

const STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'Dostupné',
  RESERVED: 'Rezervované',
  BORROWED: 'Zapožičané',
  IN_SERVICE: 'V servise',
  DISPOSED: 'Vyradené',
  LOST: 'Stratené',
};

function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function dateInputToISO(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

interface FormValues {
  name: string;
  description: string;
  categoryId: string | null;
  status: string;
  conditionSlug: string | null;
  locationId: string | null;
  manufacturer: string;
  model: string;
  serialNumber: string;
  acquiredAt: string;
  acquisitionCost: string;
  warrantyUntil: string;
  tags: string[];
  isLoanable: boolean;
  requiresApproval: boolean;
}

interface AssetDetailEditFormProps {
  asset: AssetDetail;
  categories: readonly CategorySummary[];
  locations: readonly LocationSummary[];
  onCancel: () => void;
  onSaved: () => void;
}

export function AssetDetailEditForm({
  asset,
  categories,
  locations,
  onCancel,
  onSaved,
}: AssetDetailEditFormProps): JSX.Element {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const canManage = useCanManageTaxonomy();
  const updateAsset = useUpdateAsset();
  const assetConditionsQuery = useAssetConditions({ limit: 200 });
  const createLocation = useCreateLocation();
  const createAssetCondition = useCreateAssetConditions();
  const renameCategory = useRenameCategory();
  const renameLocation = useRenameLocation();
  const renameAssetCondition = useRenameAssetCondition();

  const locationOptions = locations.map((l) => ({ id: l._id, label: l.name }));
  // Zlúčený číselník: výber kategórie zoskupený podľa root kategórie
  // (root = hlavička skupiny). Rovnaká logika ako v žiadosti aj create.
  const { options: categoryOptions, groupById: categoryGroupById } =
    buildGroupedCategoryOptions(categories);
  const assetConditionOptions = (assetConditionsQuery.data?.data ?? []).map((c) => ({
    id: c.slug,
    label: c.name,
  }));

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, dirtyFields, isDirty },
  } = useForm<FormValues>({
    defaultValues: {
      name: asset.name,
      description: asset.description ?? '',
      categoryId: asset.categoryId,
      status: asset.status,
      conditionSlug: asset.condition,
      locationId: asset.locationId,
      manufacturer: asset.manufacturer ?? '',
      model: asset.model ?? '',
      serialNumber: asset.serialNumber ?? '',
      acquiredAt: isoToDateInput(asset.acquiredAt),
      acquisitionCost: asset.acquisitionCost == null ? '' : String(asset.acquisitionCost),
      warrantyUntil: isoToDateInput(asset.warrantyUntil),
      tags: asset.tags,
      isLoanable: asset.isLoanable,
      requiresApproval: asset.requiresApproval,
    },
  });

  function onSubmit(values: FormValues): void {
    setSubmitError(null);
    const patch: AssetUpdatePatch = {};

    if (dirtyFields.name) patch.name = values.name.trim();
    if (dirtyFields.description) {
      const trimmed = values.description.trim();
      patch.description = trimmed.length === 0 ? null : trimmed;
    }
    if (dirtyFields.categoryId && values.categoryId) patch.categoryId = values.categoryId;
    if (dirtyFields.status) patch.status = values.status;
    if (dirtyFields.conditionSlug && values.conditionSlug) patch.condition = values.conditionSlug;
    if (dirtyFields.locationId && values.locationId) patch.locationId = values.locationId;
    if (dirtyFields.manufacturer) {
      const t = values.manufacturer.trim();
      patch.manufacturer = t.length === 0 ? null : t;
    }
    if (dirtyFields.model) {
      const t = values.model.trim();
      patch.model = t.length === 0 ? null : t;
    }
    if (dirtyFields.serialNumber) {
      const t = values.serialNumber.trim();
      patch.serialNumber = t.length === 0 ? null : t;
    }
    if (dirtyFields.acquiredAt) {
      const iso = dateInputToISO(values.acquiredAt);
      if (iso) patch.acquiredAt = iso;
    }
    if (dirtyFields.acquisitionCost) {
      const t = values.acquisitionCost.trim();
      patch.acquisitionCost = t === '' ? null : Number(t.replace(',', '.'));
    }
    if (dirtyFields.warrantyUntil) {
      patch.warrantyUntil = dateInputToISO(values.warrantyUntil);
    }
    if (dirtyFields.tags) {
      patch.tags = values.tags;
    }
    if (dirtyFields.isLoanable) patch.isLoanable = values.isLoanable;
    if (dirtyFields.requiresApproval) patch.requiresApproval = values.requiresApproval;

    if (Object.keys(patch).length === 0) {
      onSaved();
      return;
    }

    updateAsset.mutate(
      { id: asset._id, patch },
      {
        onSuccess: () => onSaved(),
        onError: (err) => setSubmitError(err.message),
      },
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit, focusFirstInvalidField)}
      className="space-y-6"
      noValidate
    >
      <Section title="Identifikácia">
        <Field
          label="Inventárne číslo"
          hint="Nedá sa zmeniť — slúži ako trvalý identifikátor v evidencii."
        >
          <input
            type="text"
            value={asset.inventoryNumber}
            disabled
            className={inputClasses({ disabled: true })}
          />
        </Field>

        <Field name="name" label="Názov" required error={errors.name?.message}>
          <input
            type="text"
            {...register('name', {
              required: 'Názov je povinný.',
              maxLength: { value: 300, message: 'Maximálne 300 znakov.' },
            })}
            className={inputClasses()}
          />
        </Field>

        <Field
          name="categoryId"
          label="Kategória"
          required
          hint="Hierarchický výber: skupina › podkategória. Nové kategórie sa spravujú v Číselníkoch."
        >
          <Controller
            name="categoryId"
            control={control}
            rules={{ required: true }}
            render={({ field }) => (
              <Combobox
                value={field.value}
                onChange={field.onChange}
                options={categoryOptions}
                groupOf={(o) => categoryGroupById[o.id]}
                visibleLimit={100}
                canCreate={false}
                canRename={canManage}
                onRename={async (id, newLabel) => {
                  await renameCategory.mutateAsync({ id, name: newLabel });
                }}
              />
            )}
          />
        </Field>

        <Field name="serialNumber" label="Sériové číslo">
          <input
            type="text"
            {...register('serialNumber', {
              maxLength: { value: 200, message: 'Maximálne 200 znakov.' },
            })}
            className={inputClasses()}
          />
        </Field>
      </Section>

      <Section title="Stav a lokalita">
        <Field name="status" label="Stav" required>
          <Controller
            name="status"
            control={control}
            rules={{ required: true }}
            render={({ field }) => (
              <SelectField
                label="Stav"
                value={field.value}
                onChange={field.onChange}
                options={ASSET_STATUS_VALUES.map((s) => ({
                  value: s,
                  label: STATUS_LABELS[s] ?? s,
                }))}
              />
            )}
          />
        </Field>

        <Field name="conditionSlug" label="Kondícia" required>
          <Controller
            name="conditionSlug"
            control={control}
            rules={{ required: true }}
            render={({ field }) => (
              <Combobox
                value={field.value}
                onChange={field.onChange}
                options={assetConditionOptions}
                canCreate={canManage}
                canRename={canManage}
                onCreate={async (label) => {
                  const result = await createAssetCondition.mutateAsync({ name: label });
                  return { id: result.slug as string, label: result.name as string };
                }}
                onRename={async (slug, newLabel) => {
                  const entry = assetConditionsQuery.data?.data.find((c) => c.slug === slug);
                  if (entry)
                    await renameAssetCondition.mutateAsync({ id: entry._id, name: newLabel });
                }}
                loading={assetConditionsQuery.isLoading}
              />
            )}
          />
        </Field>

        <Field name="locationId" label="Lokalita" required>
          <Controller
            name="locationId"
            control={control}
            rules={{ required: true }}
            render={({ field }) => (
              <Combobox
                value={field.value}
                onChange={field.onChange}
                options={locationOptions}
                canCreate={canManage}
                canRename={canManage}
                onCreate={async (label) => {
                  const result = await createLocation.mutateAsync({
                    name: label,
                    type: 'EXTERNAL',
                  });
                  return { id: result._id, label: result.name };
                }}
                onRename={async (id, newLabel) => {
                  await renameLocation.mutateAsync({ id, name: newLabel });
                }}
              />
            )}
          />
        </Field>
      </Section>

      <Section title="Výrobca a model">
        <Field name="manufacturer" label="Výrobca">
          <input
            type="text"
            {...register('manufacturer', {
              maxLength: { value: 200, message: 'Maximálne 200 znakov.' },
            })}
            className={inputClasses()}
          />
        </Field>
        <Field name="model" label="Model">
          <input
            type="text"
            {...register('model', {
              maxLength: { value: 200, message: 'Maximálne 200 znakov.' },
            })}
            className={inputClasses()}
          />
        </Field>
      </Section>

      <Section title="Nadobudnutie">
        <Field name="acquiredAt" label="Dátum nadobudnutia" required>
          <Controller
            name="acquiredAt"
            control={control}
            rules={{ required: true }}
            render={({ field }) => (
              <DateField
                label="Dátum nadobudnutia"
                value={field.value}
                onChange={field.onChange}
                required
              />
            )}
          />
        </Field>
        <Field
          name="acquisitionCost"
          label="Nadobúdacia cena (€)"
          hint="Voliteľné. Použite desatinnú bodku alebo čiarku."
        >
          <input
            type="text"
            inputMode="decimal"
            {...register('acquisitionCost', {
              pattern: {
                value: /^$|^\d+([.,]\d{1,2})?$/,
                message: 'Neplatné číslo (napr. 1489,00).',
              },
            })}
            className={inputClasses()}
          />
        </Field>
        <Field name="warrantyUntil" label="Záruka do">
          <Controller
            name="warrantyUntil"
            control={control}
            render={({ field }) => (
              <DateField label="Záruka do" value={field.value} onChange={field.onChange} />
            )}
          />
        </Field>
      </Section>

      <Section title="Popis a tagy">
        <Field name="description" label="Popis">
          <textarea
            rows={4}
            {...register('description', {
              maxLength: { value: 2000, message: 'Maximálne 2000 znakov.' },
            })}
            className={inputClasses()}
          />
        </Field>
        <Field name="tags" label="Tagy">
          <Controller
            name="tags"
            control={control}
            render={({ field }) => <TagsCombobox value={field.value} onChange={field.onChange} />}
          />
        </Field>
      </Section>

      <Section title="Pravidlá výpožičky">
        <Field name="isLoanable" label="Možno zapožičať">
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              {...register('isLoanable')}
              className="h-4 w-4 rounded border-border-default text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            />
            <span>Áno — položku je možné si vypožičať</span>
          </label>
        </Field>
        <Field name="requiresApproval" label="Vyžaduje schválenie">
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              {...register('requiresApproval')}
              className="h-4 w-4 rounded border-border-default text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            />
            <span>Áno — žiadosti musí potvrdiť správca</span>
          </label>
        </Field>
      </Section>

      {submitError ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-danger-fg bg-danger-bg p-4 text-sm text-danger-fg"
        >
          <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span>{submitError}</span>
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t border-border-subtle bg-surface-page/95 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:justify-end sm:rounded-b-xl">
        <button
          type="button"
          onClick={onCancel}
          disabled={updateAsset.isPending}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-card px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          <X aria-hidden="true" className="h-4 w-4" />
          Zrušiť
        </button>
        <button
          type="submit"
          disabled={!isDirty || updateAsset.isPending}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
          aria-live="polite"
        >
          <Save aria-hidden="true" className="h-4 w-4" />
          {updateAsset.isPending ? 'Ukladám…' : 'Uložiť zmeny'}
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="rounded-xl border border-border-subtle bg-surface-card shadow-sm">
      <h2 className="border-b border-border-subtle px-5 py-3 text-sm font-semibold text-text-primary">
        {title}
      </h2>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

function Field({
  name,
  label,
  children,
  required,
  hint,
  error,
}: {
  /**
   * react-hook-form field name — rendered as `data-field` so
   * `focusFirstInvalidField` can locate this wrapper after a failed
   * submit. Omitted for the one read-only Field with no backing form
   * field (inventárne číslo).
   */
  name?: keyof FormValues;
  label: string;
  children: ReactNode;
  required?: boolean | undefined;
  hint?: string | undefined;
  error?: string | undefined;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1" data-field={name}>
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

function inputClasses(opts: { disabled?: boolean } = {}): string {
  return cn(
    'w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
    opts.disabled && 'cursor-not-allowed bg-surface-subtle text-text-muted',
  );
}
