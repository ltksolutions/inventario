// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { ASSET_STATUS_VALUES } from '@inventario/shared-types';
import { AlertCircle, ArrowLeft, Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { Combobox } from './Combobox';
import { DateField } from './DateField';
import { SelectField } from './SelectField';
import { TagsCombobox } from './TagsCombobox';

import type { CreateAssetInput } from '@/lib/api-hooks';
import type { JSX, ReactNode } from 'react';

import {
  useAssetConditions,
  useCanEditAssets,
  useCanManageTaxonomy,
  useCategories,
  useCreateAsset,
  useCreateAssetConditions,
  useCreateLocation,
  useLocations,
  useRenameAssetCondition,
  useRenameCategory,
  useRenameLocation,
} from '@/lib/api-hooks';
import { buildGroupedCategoryOptions } from '@/lib/category-tree';
import { cn } from '@/lib/cn';
import { focusFirstInvalidField } from '@/lib/form-scroll';
import { useCurrentOrganisation } from '@/lib/organisations-hooks';

const STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'Dostupné',
  RESERVED: 'Rezervované',
  BORROWED: 'Zapožičané',
  IN_SERVICE: 'V servise',
  DISPOSED: 'Vyradené',
  LOST: 'Stratené',
};

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
  trackingMode: 'SERIALIZED' | 'BULK';
  initialQuantity: number;
}

export function AssetCreateContent(): JSX.Element {
  const router = useRouter();
  const canEdit = useCanEditAssets();
  const canManage = useCanManageTaxonomy();
  const createAsset = useCreateAsset();
  const orgQuery = useCurrentOrganisation();
  const categoriesQuery = useCategories({ limit: 200 });
  const locationsQuery = useLocations({ limit: 200 });
  const assetConditionsQuery = useAssetConditions({ limit: 200 });
  const createLocation = useCreateLocation();
  const createAssetCondition = useCreateAssetConditions();
  const renameCategory = useRenameCategory();
  const renameLocation = useRenameLocation();
  const renameAssetCondition = useRenameAssetCondition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      name: '',
      description: '',
      categoryId: null,
      status: 'AVAILABLE',
      conditionSlug: null,
      locationId: null,
      manufacturer: '',
      model: '',
      serialNumber: '',
      acquiredAt: new Date().toISOString().slice(0, 10),
      acquisitionCost: '',
      warrantyUntil: '',
      tags: [],
      isLoanable: true,
      requiresApproval: false,
      trackingMode: 'SERIALIZED' as const,
      initialQuantity: 0,
    },
  });

  if (!canEdit) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center">
        <p className="text-text-secondary">Nemáte oprávnenie pridávať majetok.</p>
        <Link href="/assets" className="mt-4 inline-block text-sm text-brand-primary underline">
          Späť na zoznam
        </Link>
      </div>
    );
  }

  // Zlúčený číselník: jeden výber kategórie, zoskupený podľa root kategórie
  // (root = bývalý "typ majetku", len hlavička skupiny). Ponúkame podkategórie
  // (root bez detí ostáva vyberateľný). Rovnaká logika ako v žiadosti.
  const { options: categoryOptions, groupById: categoryGroupById } = buildGroupedCategoryOptions(
    categoriesQuery.data?.data ?? [],
  );
  const locations = (locationsQuery.data?.data ?? []).map((l) => ({
    id: l._id,
    label: l.name,
  }));
  const assetConditions = (assetConditionsQuery.data?.data ?? []).map((c) => ({
    id: c.slug,
    label: c.name,
  }));

  function onSubmit(values: FormValues): void {
    setSubmitError(null);

    if (!values.categoryId || !values.locationId || !values.conditionSlug) {
      setSubmitError('Vyplňte všetky povinné polia.');
      return;
    }

    const input: CreateAssetInput = {
      name: values.name.trim(),
      categoryId: values.categoryId,
      locationId: values.locationId,
      status: values.status,
      condition: values.conditionSlug,
      description: values.description.trim() || null,
      serialNumber: values.serialNumber.trim() || null,
      manufacturer: values.manufacturer.trim() || null,
      model: values.model.trim() || null,
      acquisitionCost: values.acquisitionCost
        ? Number(values.acquisitionCost.replace(',', '.'))
        : null,
      warrantyUntil: values.warrantyUntil ? `${values.warrantyUntil}T00:00:00.000Z` : null,
      tags: values.tags,
      isLoanable: values.isLoanable,
      requiresApproval: values.requiresApproval,
      trackingMode: values.trackingMode,
      ...(values.trackingMode === 'BULK' ? { initialQuantity: values.initialQuantity } : {}),
    };
    if (values.acquiredAt) input.acquiredAt = `${values.acquiredAt}T00:00:00.000Z`;

    createAsset.mutate(input, {
      onSuccess: (created) => {
        router.push(`/assets/${created._id}`);
      },
      onError: (err) => {
        setSubmitError(err.message);
      },
    });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-6 flex items-center gap-2 text-sm" aria-label="Drobky">
        <Link
          href="/assets"
          className="inline-flex items-center gap-1 rounded text-text-secondary transition hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Späť na zoznam
        </Link>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">Pridať majetok</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Inventárne číslo bude vygenerované automaticky serverom.
        </p>
      </header>

      {!orgQuery.isLoading && !orgQuery.data?.inventoryNumberFormat && (
        <div
          role="alert"
          className="mb-6 flex items-start gap-3 rounded-xl border border-warning-fg bg-warning-bg p-4 text-sm text-warning-fg"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Nie je nastavený formát inventárneho čísla.</p>
            <p className="mt-0.5">
              Pred pridaním majetku musí administrátor nastaviť prefix a formát číslovania.{' '}
              <Link
                href="/settings/organisation"
                className="font-semibold underline underline-offset-2 hover:opacity-80"
              >
                Prejdí na Nastavenía → Organizácia
              </Link>
            </p>
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit(onSubmit, focusFirstInvalidField)}
        className="space-y-6"
        noValidate
      >
        <Section title="Identifikácia">
          <Field
            name="trackingMode"
            label="Typ sledovania"
            required
            hint="Kusová položka má vlastné inventárne číslo. Množstevná položka sleduje množstvo kusov (lopty, kužele…). Nemenmé po uložení."
          >
            <Controller
              name="trackingMode"
              control={control}
              render={({ field }) => (
                <SelectField
                  label="Typ sledovania"
                  options={[
                    {
                      value: 'SERIALIZED',
                      label: 'Kusová — každý kus má vlastné inventárne číslo',
                    },
                    {
                      value: 'BULK',
                      label: 'Množstevná — hromadná zameniteľná položka (lopty, kužele…)',
                    },
                  ]}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </Field>

          {watch('trackingMode') === 'BULK' && (
            <Field
              name="initialQuantity"
              label="Počiatočné množstvo na sklade"
              required
              hint="Zadaj počačný počet kusov. Neskôr môžeš množstvo meniť cez Sklad → Pohyby."
              error={errors.initialQuantity?.message}
            >
              <input
                type="number"
                min="1"
                step="1"
                {...register('initialQuantity', {
                  valueAsNumber: true,
                  // Explicitný `validate` namiesto `required`/`min` — react-hook-form
                  // s `valueAsNumber: true` vie pri prázdnom/neplatnom vstupe poslať
                  // `NaN`, ktoré `min`/`required` pravidlá TICHO PREPUSTIA (NaN
                  // neprejde žiadnym číselným porovnaním, takže obe kontroly
                  // vyhodnotia "OK"). `Number.isFinite` toto zachytí explicitne.
                  validate: (value) => {
                    if (watch('trackingMode') !== 'BULK') return true;
                    if (!Number.isFinite(value)) return 'Počiatočné množstvo je povinné.';
                    if (value < 1) return 'Množstvo musí byť aspoň 1.';
                    return true;
                  },
                })}
                className={inputCls()}
              />
            </Field>
          )}

          <Field name="name" label="Názov" required error={errors.name?.message}>
            <input
              type="text"
              {...register('name', {
                required: 'Názov je povinný.',
                maxLength: { value: 300, message: 'Maximálne 300 znakov.' },
              })}
              className={inputCls()}
            />
          </Field>

          <Field
            name="categoryId"
            label="Kategória"
            required
            error={errors.categoryId?.message}
            hint="Hierarchický výber: skupina › podkategória. Nové kategórie sa spravujú v Číselníkoch."
          >
            <Controller
              name="categoryId"
              control={control}
              rules={{ required: 'Kategória je povinná.' }}
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
                  loading={categoriesQuery.isLoading}
                />
              )}
            />
          </Field>

          <Field name="serialNumber" label="Sériové číslo">
            <input type="text" {...register('serialNumber')} className={inputCls()} />
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
                  options={assetConditions}
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

          <Field name="locationId" label="Lokalita" required error={errors.locationId?.message}>
            <Controller
              name="locationId"
              control={control}
              rules={{ required: 'Lokalita je povinná.' }}
              render={({ field }) => (
                <Combobox
                  value={field.value}
                  onChange={field.onChange}
                  options={locations}
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
                  loading={locationsQuery.isLoading}
                />
              )}
            />
          </Field>
        </Section>

        <Section title="Výrobca a model">
          <Field name="manufacturer" label="Výrobca">
            <input type="text" {...register('manufacturer')} className={inputCls()} />
          </Field>
          <Field name="model" label="Model">
            <input type="text" {...register('model')} className={inputCls()} />
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
          <Field name="acquisitionCost" label="Nadobúdacia cena (€)">
            <input
              type="text"
              inputMode="decimal"
              {...register('acquisitionCost', {
                pattern: { value: /^$|^\d+([.,]\d{1,2})?$/, message: 'Neplatné číslo.' },
              })}
              placeholder="napr. 1489,00"
              className={inputCls()}
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
            <textarea rows={4} {...register('description')} className={inputCls()} />
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
              <input type="checkbox" {...register('isLoanable')} className="h-4 w-4 rounded" />
              <span>Áno</span>
            </label>
          </Field>
          <Field name="requiresApproval" label="Vyžaduje schválenie">
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                {...register('requiresApproval')}
                className="h-4 w-4 rounded"
              />
              <span>Áno</span>
            </label>
          </Field>
        </Section>

        {submitError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800"
          >
            <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{submitError}</span>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Link
            href="/assets"
            className="rounded-lg border border-border-default bg-surface-card px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-subtle"
          >
            Zrušiť
          </Link>
          <button
            type="submit"
            disabled={isSubmitting || createAsset.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
          >
            <Save aria-hidden="true" className="h-4 w-4" />
            {createAsset.isPending ? 'Ukladám…' : 'Vytvoriť majetok'}
          </button>
        </div>
      </form>
    </div>
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
   * submit. Optional only for the rare Field usage with no backing
   * form field (none currently) — always pass it for real fields.
   */
  name?: keyof FormValues;
  label: string;
  children: ReactNode;
  required?: boolean;
  hint?: string | undefined;
  error?: string | undefined;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1" data-field={name}>
      <span className="flex items-baseline gap-1 text-sm font-medium text-text-secondary">
        {label}
        {required && (
          <span aria-hidden="true" className="text-red-500">
            *
          </span>
        )}
      </span>
      {children}
      {hint && <span className="text-xs text-text-muted">{hint}</span>}
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </label>
  );
}

function inputCls(): string {
  return cn(
    'w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary placeholder:text-text-muted',
    'focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
  );
}
