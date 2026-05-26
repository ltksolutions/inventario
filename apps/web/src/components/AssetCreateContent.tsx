// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import {
  ASSET_CONDITION_VALUES,
  ASSET_STATUS_VALUES,
  ASSET_TYPE_VALUES,
} from '@inventario/shared-types';
import { AlertCircle, ArrowLeft, Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import type { CreateAssetInput } from '@/lib/api-hooks';
import type { JSX, ReactNode } from 'react';

import { useCanEditAssets, useCategories, useCreateAsset, useLocations } from '@/lib/api-hooks';
import { cn } from '@/lib/cn';

const STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'Dostupné',
  RESERVED: 'Rezervované',
  BORROWED: 'Zapožičané',
  IN_SERVICE: 'V servise',
  DISPOSED: 'Vyradené',
  LOST: 'Stratené',
};

const CONDITION_LABELS: Record<string, string> = {
  NEW: 'Nové',
  EXCELLENT: 'Vynikajúce',
  GOOD: 'Dobré',
  FAIR: 'Použiteľné',
  POOR: 'Opotrebované',
  UNUSABLE: 'Nepoužiteľné',
};

const TYPE_LABELS: Record<string, string> = {
  IT: 'IT majetok',
  SPORTS_GEAR: 'Športová výstroj',
  TRAINING_EQUIPMENT: 'Tréningové vybavenie',
  OFFICE_EQUIPMENT: 'Kancelárske vybavenie',
  MEDIA: 'Médiá a video',
  COMMUNICATION: 'Komunikácia',
  OTHER: 'Iné',
};

interface FormValues {
  name: string;
  description: string;
  type: string;
  categoryId: string;
  status: string;
  condition: string;
  locationId: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  acquiredAt: string;
  acquisitionCost: string;
  warrantyUntil: string;
  tags: string;
  isLoanable: boolean;
  requiresApproval: boolean;
}

export function AssetCreateContent(): JSX.Element {
  const router = useRouter();
  const canEdit = useCanEditAssets();
  const createAsset = useCreateAsset();
  const categoriesQuery = useCategories({ limit: 200 });
  const locationsQuery = useLocations({ limit: 200 });
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      name: '',
      description: '',
      type: 'OTHER',
      categoryId: '',
      status: 'AVAILABLE',
      condition: 'NEW',
      locationId: '',
      manufacturer: '',
      model: '',
      serialNumber: '',
      acquiredAt: new Date().toISOString().slice(0, 10),
      acquisitionCost: '',
      warrantyUntil: '',
      tags: '',
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

  function onSubmit(values: FormValues): void {
    setSubmitError(null);

    const input: CreateAssetInput = {
      name: values.name.trim(),
      type: values.type,
      categoryId: values.categoryId,
      locationId: values.locationId,
      status: values.status,
      condition: values.condition,
      description: values.description.trim() || null,
      serialNumber: values.serialNumber.trim() || null,
      manufacturer: values.manufacturer.trim() || null,
      model: values.model.trim() || null,
      acquisitionCost: values.acquisitionCost
        ? Number(values.acquisitionCost.replace(',', '.'))
        : null,
      warrantyUntil: values.warrantyUntil ? `${values.warrantyUntil}T00:00:00.000Z` : null,
      tags: values.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
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

  const categories = categoriesQuery.data?.data ?? [];
  const locations = locationsQuery.data?.data ?? [];

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
            <select {...register('type', { required: true })} className={inputCls()}>
              {ASSET_TYPE_VALUES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t] ?? t}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Kategória" required error={errors.categoryId?.message}>
            <select
              {...register('categoryId', { required: 'Kategória je povinná.' })}
              className={inputCls()}
            >
              <option value="">— Vyberte kategóriu —</option>
              {categories.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
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
            <select {...register('condition', { required: true })} className={inputCls()}>
              {ASSET_CONDITION_VALUES.map((c) => (
                <option key={c} value={c}>
                  {CONDITION_LABELS[c] ?? c}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Lokalita" required error={errors.locationId?.message}>
            <select
              {...register('locationId', { required: 'Lokalita je povinná.' })}
              className={inputCls()}
            >
              <option value="">— Vyberte lokalitu —</option>
              {locations.map((l) => (
                <option key={l._id} value={l._id}>
                  {l.name}
                </option>
              ))}
            </select>
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
          <Field label="Štítky" hint="Oddeľte čiarkou.">
            <input
              type="text"
              placeholder="napr. it-oddelenie, dev"
              {...register('tags')}
              className={inputCls()}
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
