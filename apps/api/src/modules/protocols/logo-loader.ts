// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Logo loader pre PDF renderer protokolov (ADR-0022 K2).
 *
 * Zodpovednosť:
 *   1. Skúsi stiahnuť tenant logo z `organisation.brandKit.logoUrl`.
 *   2. Ak URL nie je, fetch zlyhá, je timeout (LOGO_FETCH_TIMEOUT_MS), alebo
 *      odpoveď nie je PNG/JPEG — vráti default Inventario logo z disku.
 *   3. SVG sa vždy odmieta — pdf-lib neembeduje SVG (ADR-0022 R3).
 *
 * DÔLEŽITÉ:
 *   - Táto funkcia NESMIE byť volaná vnútri Mongo transakcie (fetch je sieťový
 *     hovor — nesmie blokovať loan fulfil/return). Volá ju render endpoint
 *     (K5), nie service v transakcii (K4). (ADR-0022 invariant #4)
 *   - Výsledok je `Uint8Array` (PNG bajty) — vhodný priamo pre `PDFDocument.embedPng()`.
 *
 * Cache: zámerně ŽIADNA v tejto verzii (ADR-0022 R3, Fáza 2 príde s cache).
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Organisation } from '@inventario/shared-types';

// ---------------------------------------------------------------------------
// Konštanty
// ---------------------------------------------------------------------------

/** Timeout pre logo fetch v milisekundách. */
const LOGO_FETCH_TIMEOUT_MS = 4000;

/**
 * Povolené Content-Type hodnoty — len formáty, ktoré pdf-lib vie embedovať
 * (embedPng/embedJpg). WebP a SVG pdf-lib nepodporuje → fallback na default.
 */
const ALLOWED_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];

/**
 * Načíta asset súbor (font, default logo) s fallback cestami.
 *
 * Prečo viac kandidátov: lokálne (tsx, vitest) je asset vedľa zdrojáku a
 * funguje cesta cez `import.meta.url`. Na Verceli sa kód bunduje (ncc) —
 * `import.meta.url` ukazuje do bundle a asset tam nie je; súbory pribalené
 * cez `vercel.json functions.includeFiles` ležia pod `process.cwd()`
 * (`/var/task/src/...`). Skúšame postupne všetky známe umiestnenia.
 */
async function loadAsset(filename: string): Promise<Uint8Array> {
  const candidates = [
    join(fileURLToPath(import.meta.url), '..', 'assets', filename),
    join(process.cwd(), 'src', 'modules', 'protocols', 'assets', filename),
    join(process.cwd(), 'apps', 'api', 'src', 'modules', 'protocols', 'assets', filename),
  ];

  for (const path of candidates) {
    try {
      const buffer = await readFile(path);
      return new Uint8Array(buffer);
    } catch {
      // skús ďalšieho kandidáta
    }
  }

  throw new Error(
    `Protocol asset '${filename}' not found. Tried: ${candidates.join(', ')}. ` +
      'Deployment problem — check vercel.json functions.includeFiles.',
  );
}

// ---------------------------------------------------------------------------
// Hlavná exportovaná funkcia
// ---------------------------------------------------------------------------

/**
 * Načíta logo pre tenant:
 *   1. Ak má tenant `brandKit.logoUrl` → pokúsi sa stiahnuť s timeoutom.
 *   2. Ak nie je URL, fetch zlyhá, timeout, alebo je SVG/iný typ → default logo.
 *
 * Vracia vždy `Uint8Array` (PNG bajty), nikdy `null`.
 *
 * @param organisation - Organisation dokument tenanta.
 * @returns PNG bajty loga (tenant alebo default).
 */
export async function loadLogo(organisation: Organisation): Promise<Uint8Array> {
  const logoUrl = organisation.brandKit?.logoUrl;

  if (logoUrl) {
    try {
      const bytes = await fetchLogoWithTimeout(logoUrl);
      if (bytes) return bytes;
    } catch {
      // Fallback na default — log na warn úrovni sa robí nižšie
    }
  }

  return loadDefaultLogo();
}

// ---------------------------------------------------------------------------
// Interné pomocné funkcie
// ---------------------------------------------------------------------------

/**
 * Stiahne logo z URL s timeoutom. Vráti `null` ak:
 *   - Content-Type je SVG alebo iný nepovolený typ
 *   - HTTP status nie je 2xx
 *   - Fetch skončí timeoutom
 */
async function fetchLogoWithTimeout(url: string): Promise<Uint8Array | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') ?? '';
    const baseType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';

    if (!ALLOWED_CONTENT_TYPES.includes(baseType)) {
      // SVG alebo nepovolený typ — pdf-lib to neembeduje
      return null;
    }

    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Načíta default Inventario logo z disku (PNG súbor v assets/).
 * Vyhadzuje chybu len ak súbor fyzicky chýba (deployment problem).
 */
async function loadDefaultLogo(): Promise<Uint8Array> {
  return loadAsset('inventario-logo-default.png');
}

/**
 * Načíta DejaVuSans.ttf z assets/ pre renderer.
 * Konvencia: renderer dostane font ako parameter — loader je pre pohodlie volajúceho.
 */
export async function loadDefaultFont(): Promise<Uint8Array> {
  return loadAsset('DejaVuSans.ttf');
}
