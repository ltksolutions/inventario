// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Zebra ZPL string builder — čistá funkcia (ADR-0027 L3).
 *
 * `renderLabelZpl(asset, organisation) → string`
 *
 * Generuje ZPL II string pre jeden štítok. Výstup je `text/plain` —
 * frontend ho odovzdá Zebra Browser Print agentovi, ktorý ho doručí
 * na tlačiareň v lokálnej sieti. Backend s tlačiarňou nikdy nekomunikuje.
 *
 * ZPL štítok obsahuje:
 *   - QR kód cez `^BQ` (zakódovaný URL: appBaseUrl/scan/publicToken)
 *   - inventoryNumber a skrátený názov cez `^FD`
 *   - voliteľný sprievodný text pre nálezcu (ak `finderText.enabled`)
 *   - `^CI28` = UTF-8 code page → plná SK diakritika
 *
 * Rozmery a DPI sa berú z `organisation.labelPrinting` configu.
 * Defaults (ak labelPrinting je null): 50×25 mm, 203 dpi, darkness 20.
 *
 * Determinizmus: rovnaké vstupy → vždy identický ZPL string.
 */

import type { Organisation } from '@inventario/shared-types';

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export interface ZplAssetInput {
  inventoryNumber: string;
  name: string;
  publicToken: string;
}

// ---------------------------------------------------------------------------
// Konštanty
// ---------------------------------------------------------------------------

const MM_TO_DOTS = (mm: number, dpi: number): number => Math.round((mm / 25.4) * dpi);

/** Max. dĺžka inventárneho čísla na štítku (dlhšie sa orezáva). */
const MAX_INV_LEN = 24;
/** Max. dĺžka názvu na štítku. */
const MAX_NAME_LEN = 30;
/** Max. dĺžka finder textu na štítku. */
const MAX_FINDER_LEN = 40;

// ---------------------------------------------------------------------------
// Hlavná exportovaná funkcia
// ---------------------------------------------------------------------------

/**
 * Vygeneruje ZPL string pre jeden štítok.
 *
 * @param asset        - Asset s `publicToken`, `inventoryNumber`, `name`.
 * @param organisation - Organisation dokument (appBaseUrl, labelPrinting).
 * @returns ZPL string (`^XA...^XZ`), UTF-8, na odovzdanie Browser Print agentovi.
 */
export function renderLabelZpl(asset: ZplAssetInput, organisation: Organisation): string {
  const appBaseUrl = organisation.appBaseUrl;
  if (!appBaseUrl) {
    throw new Error('Organisation.appBaseUrl nie je nastavený — ZPL štítky nie sú použiteľné.');
  }

  const cfg = organisation.labelPrinting;
  const widthMm = cfg?.zplLabelWidthMm ?? 50;
  const heightMm = cfg?.zplLabelHeightMm ?? 25;
  const dpi = cfg?.zplDpi ?? 203;
  const darkness = cfg?.zplDarkness ?? 20;

  const finderCfg = cfg?.finderText;
  const showFinderText = finderCfg?.enabled === true && (finderCfg.text?.length ?? 0) > 0;
  const finderTextStr = showFinderText ? (finderCfg!.text ?? '') : '';

  const widthDots = MM_TO_DOTS(widthMm, dpi);
  const heightDots = MM_TO_DOTS(heightMm, dpi);

  const qrUrl = `${appBaseUrl}/scan/${asset.publicToken}`;

  // QR veľkosť — magnification (1–10) pre ^BQ
  // Pri 203 dpi: mag 3 ≈ 15×15 mm (každý modul = 3 px)
  // Pri 300 dpi: mag 4 ≈ 15×15 mm
  const qrMag = dpi >= 300 ? 4 : 3;

  // Výpočet QR rozmeru v dotoch (každý modul = qrMag dotov, QR verzia ~21-25 modulov)
  // Aproximácia: 25 modulov × qrMag × 2 (tichá zóna) ≈ skutočná veľkosť
  const qrSizeDots = (25 + 8) * qrMag; // tichá zóna 4 moduly z každej strany

  // Pozícia QR — ľavá strana, vertikálne centrovanie
  const qrX = Math.round(widthDots * 0.04); // 4 % od ľavého okraja
  const qrY = Math.max(0, Math.round((heightDots - qrSizeDots) / 2));

  // Pozícia textu — vpravo od QR, vertikálne rozdelené
  const textX = qrX + qrSizeDots + Math.round(widthDots * 0.05);

  // Výška textu — rozdelíme na 2 (alebo 3 s finder textom) riadkov
  const totalTextLines = showFinderText ? 3 : 2;
  const lineSpaceDots = Math.round(heightDots / (totalTextLines + 1));
  const invY = lineSpaceDots;
  const nameY = lineSpaceDots * 2;
  const finderY = lineSpaceDots * 3;

  // Veľkosti písma (ZPL `^A0` font: výška, šírka v dotoch)
  const invFontH = Math.min(Math.round(heightDots * 0.28), 28);
  const nameFontH = Math.min(Math.round(heightDots * 0.22), 22);
  const finderFontH = Math.min(Math.round(heightDots * 0.18), 18);

  // Orezanie textov
  const invNum = asset.inventoryNumber.slice(0, MAX_INV_LEN);
  const name = asset.name.slice(0, MAX_NAME_LEN);
  const finderLine = finderTextStr.slice(0, MAX_FINDER_LEN);

  // Šírka štítka v dotoch pre ^PW
  const lines: string[] = [];

  lines.push('^XA'); // začiatok štítka
  lines.push(`^CI28`); // UTF-8 code page — SK diakritika
  lines.push(`^PW${widthDots}`); // šírka pásky
  lines.push(`^LL${heightDots}`); // výška štítka
  lines.push(`^MD${darkness}`); // darkness (tma tlače)

  // QR kód
  lines.push(`^FO${qrX},${qrY}`); // Field Origin
  lines.push(`^BQN,2,${qrMag}`); // QR kód, Normal, magnification
  lines.push(`^FDQA,${qrUrl}^FS`); // QR data (A = auto-select mode)

  // inventoryNumber
  lines.push(`^FO${textX},${invY}`);
  lines.push(`^A0N,${invFontH},${Math.round(invFontH * 0.8)}`); // font 0, Normal
  lines.push(`^FD${invNum}^FS`);

  // Názov
  lines.push(`^FO${textX},${nameY}`);
  lines.push(`^A0N,${nameFontH},${Math.round(nameFontH * 0.8)}`);
  lines.push(`^FD${name}^FS`);

  // Sprievodný text pre nálezcu (ak zapnutý)
  if (showFinderText && finderLine) {
    lines.push(`^FO${textX},${finderY}`);
    lines.push(`^A0N,${finderFontH},${Math.round(finderFontH * 0.8)}`);
    lines.push(`^FD${finderLine}^FS`);
  }

  lines.push('^XZ'); // koniec štítka

  return lines.join('\n');
}
