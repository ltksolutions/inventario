// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * LabelPrintButton — tlačidlo pre tlač QR štítka jedného assetu (ADR-0027 L5).
 *
 * PDF mód (default): window.open → backend vráti PDF → OS tlačový dialóg.
 * ZPL mód: fetch ZPL string z backendu → Zebra Browser Print agent.
 *
 * Mód sa určuje z `labelPrintingMode` propu (hodnota z Organisation.labelPrinting.mode).
 * Null / 'PDF_SHEET' → PDF. 'ZEBRA_ZPL' → ZPL cez Browser Print.
 *
 * Browser Print fallback:
 *   Ak agent nebeží (timeout 2s), komponent zobrazí info správu a ponúkne
 *   fallback na PDF sheet (rovnaký ako PDF mód).
 *
 * Zebra Browser Print:
 *   Zebra Browser Print agent beží na localhost:9100 (HTTP) alebo
 *   localhost:9101 (HTTPS). Používame localhost:9100 — agent počúva na oboch.
 *   API: POST /write s JSON { device: { uid }, data: zplString }.
 *   Pred tlačou: GET /available alebo /default — zistíme prvú dostupnú tlačiareň.
 *   Docs: https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html
 */

import { Loader2, Printer } from 'lucide-react';
import { useState } from 'react';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

// Zebra Browser Print agent endpoint
const BROWSER_PRINT_BASE = 'http://localhost:9100';

export type LabelPrintingMode = 'PDF_SHEET' | 'ZEBRA_ZPL' | null | undefined;

interface LabelPrintButtonProps {
  assetId: string;
  inventoryNumber: string;
  labelPrintingMode?: LabelPrintingMode;
}

export function LabelPrintButton({
  assetId,
  inventoryNumber,
  labelPrintingMode,
}: LabelPrintButtonProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isZpl = labelPrintingMode === 'ZEBRA_ZPL';

  async function handlePrint() {
    setState('loading');
    setErrorMsg(null);

    try {
      if (isZpl) {
        await printZpl(assetId, inventoryNumber);
      } else {
        printPdf(assetId);
      }
      setState('idle');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Tlač zlyhala.';
      setErrorMsg(msg);
      setState('error');
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={state === 'loading'}
        onClick={() => void handlePrint()}
        className="inline-flex items-center gap-2 rounded-lg border border-border-default bg-surface-card px-4 py-2.5 text-sm font-semibold text-text-primary shadow-sm transition hover:bg-surface-subtle disabled:opacity-50"
      >
        {state === 'loading' ? (
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        ) : (
          <Printer aria-hidden="true" className="h-4 w-4" />
        )}
        {isZpl ? 'Tlačiť štítok (Zebra)' : 'Tlačiť štítok (PDF)'}
      </button>

      {state === 'error' && errorMsg && (
        <ErrorHint
          message={errorMsg}
          onFallbackPdf={() => {
            setState('idle');
            setErrorMsg(null);
            printPdf(assetId);
          }}
          showFallback={isZpl}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PDF tlač — window.open na sheet endpoint (jeden asset)
// ---------------------------------------------------------------------------

function printPdf(assetId: string): void {
  // Otvoríme PDF v novom tabe — prehliadač / OS zobrazí tlačový dialóg.
  // Sheet endpoint generuje hárok s jedným štítkom ak dostane jedno assetId.
  window.open(
    `${API_BASE}/v1/labels/sheet?assetIds=${encodeURIComponent(assetId)}`,
    '_blank',
    'noopener',
  );
}

// ---------------------------------------------------------------------------
// ZPL tlač cez Zebra Browser Print agent
// ---------------------------------------------------------------------------

async function printZpl(assetId: string, inventoryNumber: string): Promise<void> {
  // 1. Načítaj ZPL string z backendu
  const zplRes = await fetch(
    `${API_BASE}/v1/assets/${encodeURIComponent(assetId)}/label?format=zpl`,
    { credentials: 'include' },
  );

  if (!zplRes.ok) {
    if (zplRes.status === 409) {
      throw new Error('Nastavte appBaseUrl organizácie v Settings pred tlačou ZPL štítkov.');
    }
    throw new Error(`Backend vrátil chybu ${zplRes.status}.`);
  }

  const { zpl } = (await zplRes.json()) as { zpl: string };

  // 2. Zisti dostupnú Zebra tlačiareň cez Browser Print agent
  const printer = await getDefaultZebraPrinter();

  // 3. Pošli ZPL agentovi
  await sendZplToPrinter(printer, zpl, inventoryNumber);
}

/**
 * Zistí prvú dostupnú Zebra tlačiareň z Browser Print agenta.
 * Timeout 2s — ak agent nebeží, hádže chybu s jasnou správou.
 */
async function getDefaultZebraPrinter(): Promise<ZebraPrinter> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);

  try {
    const res = await fetch(`${BROWSER_PRINT_BASE}/default?type=printer`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error('Browser Print agent vrátil chybu.');
    }
    const data = (await res.json()) as { printer?: ZebraPrinter };
    if (!data.printer) {
      throw new Error(
        'Žiadna Zebra tlačiareň nenájdená. Skontrolujte, že je tlačiareň zapnutá a Browser Print agent beží.',
      );
    }
    return data.printer;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(
        'Zebra Browser Print agent nie je spustený alebo nie je dostupný (localhost:9100). ' +
          'Nainštalujte ho z zebra.com/browserprint alebo použite PDF tlač.',
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

interface ZebraPrinter {
  uid: string;
  name?: string;
  connection?: string;
}

/**
 * Odošle ZPL string na Zebra tlačiareň cez Browser Print agent.
 */
async function sendZplToPrinter(
  printer: ZebraPrinter,
  zpl: string,
  inventoryNumber: string,
): Promise<void> {
  const res = await fetch(`${BROWSER_PRINT_BASE}/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device: { uid: printer.uid },
      data: zpl,
    }),
  });

  if (!res.ok) {
    throw new Error(`Odoslanie štítka "${inventoryNumber}" na tlačiareň zlyhalo (${res.status}).`);
  }
}

// ---------------------------------------------------------------------------
// ErrorHint
// ---------------------------------------------------------------------------

function ErrorHint({
  message,
  onFallbackPdf,
  showFallback,
}: {
  message: string;
  onFallbackPdf: () => void;
  showFallback: boolean;
}) {
  return (
    <div className="rounded-lg border border-warning-fg bg-warning-bg p-3 text-xs text-warning-fg">
      <p>{message}</p>
      {showFallback && (
        <button
          type="button"
          onClick={onFallbackPdf}
          className="mt-1.5 underline hover:no-underline"
        >
          Tlačiť ako PDF namiesto toho →
        </button>
      )}
    </div>
  );
}
