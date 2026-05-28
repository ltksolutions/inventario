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
import { TagsCombobox } from './TagsCombobox';

import type { CreateAssetInput } from '@/lib/api-hooks';
import type { JSX, ReactNode } from 'react';

import {
  useAssetConditions,
  useAssetTypes,
  useCanEditAssets,
  useCanManageTaxonomy,
  useCategories,
  useCreateAsset,
  useCreateAssetConditions,
  useCreateAssetTypes,
  useCreateCategory,
  useCreateLocation,
  useLocations,
  useRenameAssetCondition,
  useRenameAssetType,
  useRenameCategory,
  useRenameLocation,
} from '@/lib/api-hooks';
import { cn } from '@/lib/cn';

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
  typeSlug: string | null;
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

export function AssetCreateContent(): JSX.Element {
  const router = useRouter();
  const canEdit = useCanEditAssets();
  const canManage = useCanManageTaxonomy();
  const createAsset = useCreateAsset();
  const categoriesQuery = useCategories({ limit: 200 });
  const locationsQuery = useLocations({ limit: 200 });
  const assetTypesQuery = useAssetTypes({ limit: 200 });
  const assetConditionsQuery = useAssetConditions({ limit: 200 });
  const createCategory = useCreateCategory();
  const createLocation = useCreateLocation();
  const createAssetType = useCreateAssetTypes();
  const createAssetCondition = useCreateAssetConditions();
  const renameCategory = useRenameCategory();
  const renameLocation = useRenameLocation();
  const renameAssetType = useRenameAssetType();
  const renameAssetCondition = useRenameAssetCondition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      name: '',
      description: '',
      typeSlug: null,
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

  const categories = (categoriesQuery.data?.data ?? []).map((c) => ({
    id: c._id,
    label: c.name,
  }));
  const locations = (locationsQuery.data?.data ?? []).map((l) => ({
    id: l._id,
    label: l.name,
  }));
  const assetTypes = (assetTypesQuery.data?.data ?? []).map((t) => ({
    id: t.slug,
    label: t.name,
  }));
  const assetConditions = (assetConditionsQuery.data?.data ?? []).map((c) => ({
    id: c.slug,
    label: c.name,
  }));

  function onSubmit(values: FormValues): void {
    setSubmitError(null);

    if (!values.typeSlug || !values.categoryId || !values.locationId || !values.conditionSlug) {
      setSubmitError('Vyplňte všetky povinné polia.');
      return;
    }

    const input: CreateAssetInput = {
      name: values.name.trim(),
      type: values.typeSlug,
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

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <Section title="Identifikácia">
          <Field label="Názov" required error={errors.name?.message}>
            <input
              type="text"
              {...register('name', {
                required: 'Názov je povinný.',
                maxLength: { value: 300, message: 'Maximálne 300 znakov.' },
              })}
              className={inputCls()}
            />
          </Field>

          <Field label="Typ majetku" required>
            <Controller
              name="typeSlug"
              control={control}
              rules={{ required: true }}
              render={({ field }) => (
                <Combobox
                  value={field.value}
                  onChange={field.onChange}
                  options={assetTypes}
                  canCreate={canManage}
                  canRename={canManage}
                  onCreate={async (label) => {
                    const result = await createAssetType.mutateAsync({ name: label });
                    return { id: result.slug as string, label: result.name as string };
                  }}
                  onRename={async (slug, newLabel) => {
                    const entry = assetTypesQuery.data?.data.find((t) => t.slug === slug);
                    if (entry) await renameAssetType.mutateAsync({ id: entry._id, name: newLabel });
                  }}
                  loading={assetTypesQuery.isLoading}
                />
              )}
            />
          </Field>

          <Field label="Kategória" required error={errors.categoryId?.message}>
            <Controller
              name="categoryId"
              control={control}
              rules={{ required: 'Kategória je povinná.' }}
              render={({ field }) => (
                <Combobox
                  value={field.value}
                  onChange={field.onChange}
                  options={categories}
                  canCreate={canManage}
                  canRename={canManage}
                  onCreate={async (label) => {
                    const result = await createCategory.mutateAsync({
                      name: label,
                      assetType: 'OTHER',
                    });
                    return { id: result._id, label: result.name };
                  }}
                  onRename={async (id, newLabel) => {
                    await renameCategory.mutateAsync({ id, name: newLabel });
                  }}
                  loading={categoriesQuery.isLoading}
                />
              )}
            />
          </Field>

          <Field label="Sériové číslo">
            <input type="text" {...register('serialNumber')} className={inputCls()} />
          </Field>
        </Section>

        <Section title="Stav a lokalita">
          <Field label="Stav" required>
            <select {...register('status', { required: true })} className={inputCls()}>
              {ASSET_STATUS_VALUES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s] ?? s}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Kondícia" required>
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

          <Field label="Lokalita" required error={errors.locationId?.message}>
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
                      type: 'OTHER',
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
          <Field label="Výrobca">
            <input type="text" {...register('manufacturer')} className={inputCls()} />
          </Field>
          <Field label="Model">
            <input type="text" {...register('model')} className={inputCls()} />
          </Field>
        </Section>

        <Section title="Nadobudnutie">
          <Field label="Dátum nadobudnutia" required>
            <input
              type="date"
              {...register('acquiredAt', { required: true })}
              className={inputCls()}
            />
          </Field>
          <Field label="Nadobúdacia cena (€)">
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
          <Field label="Záruka do">
            <input type="date" {...register('warrantyUntil')} className={inputCls()} />
          </Field>
        </Section>

        <Section title="Popis a štítky">
          <Field label="Popis">
            <textarea rows={4} {...register('description')} className={inputCls()} />
          </Field>
          <Field label="Štítky">
            <Controller
              name="tags"
              control={control}
              render={({ field }) => <TagsCombobox value={field.value} onChange={field.onChange} />}
            />
          </Field>
        </Section>

        <Section title="Pravidlá výpožičky">
          <Field label="Možno zapožičať">
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input type="checkbox" {...register('isLoanable')} className="h-4 w-4 rounded" />
              <span>Áno</span>
            </label>
          </Field>
          <Field label="Vyžaduje schválenie">
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
  label,
  children,
  required,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  hint?: string | undefined;
  error?: string | undefined;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
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
