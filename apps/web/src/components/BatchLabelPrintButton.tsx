// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * BatchLabelPrintButton — dávková tlač štítkov pre vybrané assety (ADR-0027 L5).
 *
 * PDF mód: window.open na GET /v1/labels/sheet?assetIds=... → OS dialóg.
 * ZPL mód: POST /v1/labels/zpl → pole { assetId, zpl } → každý ZPL
 *   odoslaný sekvenčne cez Zebra Browser Print agent.
 *
 * Max 200 assetov na dávku (backend limit).
 * Ak je viac ako 200 vybraných, zobrazíme warning a odosiela sa prvých 200.
 */

import { ChevronDown, Loader2, Printer } from 'lucide-react';
import { useState } from 'react';

import type { LabelPrintingMode } from './LabelPrintButton';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';
const BROWSER_PRINT_BASE = 'http://localhost:9100';
const BATCH_LIMIT = 200;

interface BatchLabelPrintButtonProps {
  selectedAssetIds: readonly string[];
  labelPrintingMode?: LabelPrintingMode;
  /** Voliteľný preset pre PDF hárok. Default 'avery-l7160'. */
  pdfPreset?: 'avery-l7160' | 'avery-l7163' | undefined;
}

export function BatchLabelPrintButton({
  selectedAssetIds,
  labelPrintingMode,
  pdfPreset = 'avery-l7160',
}: BatchLabelPrintButtonProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPresetMenu, setShowPresetMenu] = useState(false);

  const isZpl = labelPrintingMode === 'ZEBRA_ZPL';
  const count = selectedAssetIds.length;
  const disabled = count === 0 || state === 'loading';

  async function handlePrint(preset?: 'avery-l7160' | 'avery-l7163') {
    setShowPresetMenu(false);
    if (count === 0) return;

    setState('loading');
    setErrorMsg(null);

    const ids = selectedAssetIds.slice(0, BATCH_LIMIT);

    try {
      if (isZpl) {
        await printZplBatch(ids);
      } else {
        printPdfBatch(ids, preset ?? pdfPreset);
      }
      setState('idle');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Dávková tlač zlyhala.';
      setErrorMsg(msg);
      setState('error');
    }
  }

  const label =
    count === 0
      ? 'Tlačiť štítky'
      : `Tlačiť ${count > BATCH_LIMIT ? `${BATCH_LIMIT} z ${count}` : count} štítk${count === 1 ? 'a' : 'ov'}`;

  return (
    <div className="relative flex flex-col gap-1">
      <div className="flex">
        {/* Hlavné tlačidlo */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (isZpl) {
              void handlePrint();
            } else {
              // Pre PDF ponúkneme preset menu
              setShowPresetMenu((v) => !v);
            }
          }}
          className="inline-flex items-center gap-2 rounded-l-lg border border-border-default bg-surface-card px-4 py-2 text-sm font-semibold text-text-primary shadow-sm transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === 'loading' ? (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <Printer aria-hidden="true" className="h-4 w-4" />
          )}
          {label}
        </button>

        {/* Dropdown šípka pre preset výber (len PDF mód) */}
        {!isZpl && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setShowPresetMenu((v) => !v)}
            aria-label="Vybrať formát štítkov"
            className="inline-flex items-center rounded-r-lg border border-l-0 border-border-default bg-surface-card px-2 py-2 text-text-secondary shadow-sm transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronDown aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Preset dropdown */}
      {showPresetMenu && !isZpl && (
        <div className="absolute left-0 top-full z-20 mt-1 min-w-[200px] overflow-hidden rounded-lg border border-border-subtle bg-surface-card shadow-lg">
          <PresetOption
            label="Avery L7160 (24/A4 · 63.5×38 mm)"
            description="Štandard kancelárske štítky"
            onClick={() => void handlePrint('avery-l7160')}
          />
          <PresetOption
            label="Avery L7163 (14/A4 · 99×38 mm)"
            description="Väčšie štítky"
            onClick={() => void handlePrint('avery-l7163')}
          />
        </div>
      )}

      {count > BATCH_LIMIT && (
        <p className="text-xs text-warning-fg">
          Vybraných {count} — tlač je obmedzená na prvých {BATCH_LIMIT}.
        </p>
      )}

      {state === 'error' && errorMsg && (
        <div className="rounded-lg border border-warning-fg bg-warning-bg p-3 text-xs text-warning-fg">
          <p>{errorMsg}</p>
          {isZpl && (
            <button
              type="button"
              onClick={() => {
                setState('idle');
                setErrorMsg(null);
                printPdfBatch(selectedAssetIds.slice(0, BATCH_LIMIT), pdfPreset);
              }}
              className="mt-1.5 underline hover:no-underline"
            >
              Tlačiť ako PDF namiesto toho →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PDF batch — window.open so všetkými assetIds ako query param
// ---------------------------------------------------------------------------

function printPdfBatch(assetIds: readonly string[], preset: 'avery-l7160' | 'avery-l7163'): void {
  const params = new URLSearchParams({
    assetIds: assetIds.join(','),
    preset,
  });
  window.open(`${API_BASE}/v1/labels/sheet?${params.toString()}`, '_blank', 'noopener');
}

// ---------------------------------------------------------------------------
// ZPL batch — POST /v1/labels/zpl → sekvenčná tlač cez Browser Print
// ---------------------------------------------------------------------------

async function printZplBatch(assetIds: readonly string[]): Promise<void> {
  // 1. Načítaj všetky ZPL stringy naraz
  const batchRes = await fetch(`${API_BASE}/v1/labels/zpl`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetIds: [...assetIds] }),
  });

  if (!batchRes.ok) {
    if (batchRes.status === 409) {
      throw new Error('Nastavte appBaseUrl organizácie v Settings pred tlačou ZPL štítkov.');
    }
    throw new Error(`Backend vrátil chybu ${batchRes.status}.`);
  }

  const { labels } = (await batchRes.json()) as {
    labels: Array<{ assetId: string; zpl: string }>;
  };

  if (labels.length === 0) {
    throw new Error('Žiadne platné štítky na tlač.');
  }

  // 2. Zisti dostupnú Zebra tlačiareň
  const printer = await getDefaultZebraPrinter();

  // 3. Sekvenčne odošli každý ZPL
  let failed = 0;
  for (const { zpl } of labels) {
    try {
      await sendZplToPrinter(printer, zpl);
    } catch {
      failed++;
    }
  }

  if (failed > 0) {
    throw new Error(`${failed} z ${labels.length} štítkov sa nepodarilo odoslať na tlačiareň.`);
  }
}

// ---------------------------------------------------------------------------
// Browser Print helpers (kopírované z LabelPrintButton — DRY bude keď
// sa Browser Print integruje do samostatného modulu pri väčšom objeme)
// ---------------------------------------------------------------------------

interface ZebraPrinter {
  uid: string;
  name?: string;
  connection?: string;
}

async function getDefaultZebraPrinter(): Promise<ZebraPrinter> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);

  try {
    const res = await fetch(`${BROWSER_PRINT_BASE}/default?type=printer`, {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('Browser Print agent vrátil chybu.');
    const data = (await res.json()) as { printer?: ZebraPrinter };
    if (!data.printer) {
      throw new Error('Žiadna Zebra tlačiareň nenájdená. Skontrolujte, že tlačiareň je zapnutá.');
    }
    return data.printer;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(
        'Zebra Browser Print agent nie je dostupný (localhost:9100). ' +
          'Nainštalujte ho z zebra.com/browserprint alebo použite PDF tlač.',
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function sendZplToPrinter(printer: ZebraPrinter, zpl: string): Promise<void> {
  const res = await fetch(`${BROWSER_PRINT_BASE}/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device: { uid: printer.uid }, data: zpl }),
  });
  if (!res.ok) throw new Error(`Browser Print write failed: ${res.status}`);
}

// ---------------------------------------------------------------------------
// PresetOption
// ---------------------------------------------------------------------------

function PresetOption({
  label,
  description,
  onClick,
}: {
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-0.5 px-4 py-3 text-left transition hover:bg-surface-subtle"
    >
      <span className="text-sm font-medium text-text-primary">{label}</span>
      <span className="text-xs text-text-secondary">{description}</span>
    </button>
  );
}
