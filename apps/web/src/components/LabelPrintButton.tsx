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
 * Null / 'PDF_SHEET' → len PDF tlačidlo. 'ZEBRA_ZPL' → OBE tlačidlá vedľa seba
 * (Zebra aj PDF sú vždy viditeľné a funkčné súvisle — PDF nie je len záložná
 * možnosť pri chybe, užívateľ si vyberie kedykoľvek).
 *
 * Browser Print chyba:
 *   Ak agent nebeží (timeout 2s), zobrazí sa chybová správa pri Zebra
 *   tlačidle — PDF tlačidlo je aj tak stále vedľa viditeľné, takže žiadny
 *   extra fallback link netreba.
 *
 * Zebra Browser Print:
 *   Zebra Browser Print agent beží na localhost:9100 (HTTP) alebo
 *   localhost:9101 (HTTPS). Používame localhost:9100 — agent počúva na oboch.
 *   API: POST /write s JSON { device: { uid }, data: zplString }.
 *   Pred tlačou: GET /available alebo /default — zistíme prvú dostupnú tlačiareň.
 *   Docs: https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html
 *
 *   Chrome Local Network Access (LNA, od Chrome 142, 2026): appka je na
 *   verejnom HTTPS (`app.inventario.estate`), Browser Print agent na
 *   `localhost` — Chrome teraz vyžaduje explicitné povolenie pred takýmto
 *   requestom (permission prompt, podobne ako kamera/mikrofón). `localhost`
 *   patrí do address space `loopback` (nie `local` — to je pre privátne
 *   LAN adresy typu 192.168.x.x), preto fetch anotujeme
 *   `targetAddressSpace: 'loopback'`. Ak sa deklarovaná hodnota nezhoduje
 *   so skutočným cieľom, Chrome request rovno zablokuje ešte pred
 *   zobrazením povoľovacieho dialógu — presne to sa stalo 2026-07-17,
 *   keď sme tu mali omylom `'local'` namiesto `'loopback'` (chyba
 *   "target IP address space of X yet resource is in address space Y").
 *   Povolenie sa v Chrome volá "Apps on device" (Chrome 145+) alebo
 *   "Local Network Access" (Chrome 142-144). Ak organizácia používa Chrome
 *   v enterprise-managed režime, IT môže mať lokálny prístup zablokovaný
 *   politikou — to touto anotáciou neobídeme, treba povoliť na strane IT.
 *
 *   Safari (WebKit) nemá žiadny ekvivalent LNA — fetch z HTTPS na
 *   `localhost` tam blokuje ako mixed content bez povoľovacieho dialógu a
 *   bez možnosti to povoliť. Zebra tlač v Safari nie je podporovaná,
 *   PDF tlačidlo vedľa funguje bez obmedzenia (2026-07-16).
 *
 *   Ak agent odpovie, ale nemá nastavenú default tlačiareň (`/default`
 *   vráti prázdno), skúsime ako fallback `/available` a vezmeme prvú
 *   tlačiareň zo zoznamu (2026-07-16) — reálny prípad, kde je tlačiareň
 *   pripojená a agent beží, len v ňom nie je explicitne zvolený default.
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
  const [zplState, setZplState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isZpl = labelPrintingMode === 'ZEBRA_ZPL';

  async function handlePrintZebra() {
    setZplState('loading');
    setErrorMsg(null);

    try {
      await printZpl(assetId, inventoryNumber);
      setZplState('idle');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Tlač zlyhala.';
      setErrorMsg(msg);
      setZplState('error');
    }
  }

  function handlePrintPdf(): void {
    printPdf(assetId);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        {isZpl && (
          <button
            type="button"
            disabled={zplState === 'loading'}
            onClick={() => void handlePrintZebra()}
            className="inline-flex items-center gap-2 rounded-lg border border-border-default bg-surface-card px-4 py-2.5 text-sm font-semibold text-text-primary shadow-sm transition hover:bg-surface-subtle disabled:opacity-50"
          >
            {zplState === 'loading' ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Printer aria-hidden="true" className="h-4 w-4" />
            )}
            Tlačiť štítok (Zebra)
          </button>
        )}

        <button
          type="button"
          onClick={handlePrintPdf}
          className="inline-flex items-center gap-2 rounded-lg border border-border-default bg-surface-card px-4 py-2.5 text-sm font-semibold text-text-primary shadow-sm transition hover:bg-surface-subtle disabled:opacity-50"
        >
          <Printer aria-hidden="true" className="h-4 w-4" />
          Tlačiť štítok (PDF)
        </button>
      </div>

      {zplState === 'error' && errorMsg && <ErrorHint message={errorMsg} />}
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
      // Chrome Local Network Access (LNA) — vidz komentár na začiatku súboru.
      ...({ targetAddressSpace: 'loopback' } as Record<string, unknown>),
    });
    if (!res.ok) {
      throw new Error('Browser Print agent vrátil chybu.');
    }
    const data = (await res.json()) as { printer?: ZebraPrinter };
    if (data.printer) {
      return data.printer;
    }

    // Agent beží a odpovedal, ale nemá nastavenú default tlačiareň —
    // skúsime zoznam všetkých dostupných a vezmeme prvú (vidz komentár na
    // začiatku súboru, 2026-07-16).
    const fallback = await getFirstAvailableZebraPrinter(controller.signal);
    if (fallback) {
      return fallback;
    }

    throw new Error(
      'Žiadna Zebra tlačiareň nenájdená. Skontrolujte, že je tlačiareň zapnutá a Browser Print agent beží.',
    );
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

/**
 * Fallback ak `/default` nevráti tlačiareň (agent beží, ale nemá default
 * nastavený) — skúsi zoznam všetkých dostupných a vráti prvú. Ticho vráti
 * `null` na akomkoľvek zlyhaní (volajúci potom hádze pôvodnú, jasnejšiu
 * chybu).
 */
async function getFirstAvailableZebraPrinter(signal: AbortSignal): Promise<ZebraPrinter | null> {
  try {
    const res = await fetch(`${BROWSER_PRINT_BASE}/available?type=printer`, {
      signal,
      // Chrome Local Network Access (LNA) — vidz komentár na začiatku súboru.
      ...({ targetAddressSpace: 'loopback' } as Record<string, unknown>),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { printer?: ZebraPrinter[] };
    return data.printer?.[0] ?? null;
  } catch {
    return null;
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
    // Chrome Local Network Access (LNA) — vidz komentár na začiatku súboru.
    ...({ targetAddressSpace: 'loopback' } as Record<string, unknown>),
  });

  if (!res.ok) {
    throw new Error(`Odoslanie štítka "${inventoryNumber}" na tlačiareň zlyhalo (${res.status}).`);
  }
}

// ---------------------------------------------------------------------------
// ErrorHint
// ---------------------------------------------------------------------------

function ErrorHint({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-warning-fg bg-warning-bg p-3 text-xs text-warning-fg">
      <p>{message}</p>
    </div>
  );
}
