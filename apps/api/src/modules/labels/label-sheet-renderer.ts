// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Avery PDF hárok renderer — deterministická čistá funkcia (ADR-0027 L2).
 *
 * `renderLabelSheetPdf(assets, organisation, font, logo, preset?) → Uint8Array`
 *
 * Generuje PDF s mriežkou štítkov na A4 papieri. Každý štítok obsahuje:
 *   - QR kód zakódovávajúci `${appBaseUrl}/scan/${publicToken}` (ADR-0021)
 *   - inventoryNumber + skrátený názov assetu
 *   - voliteľný sprievodný text pre nálezcu (ak `labelPrinting.finderText.enabled`)
 *   - voliteľné logo organizácie v strede QR (ak logo != null)
 *
 * INVARIANTY:
 *   1. QR doména VYLUČNE z `appBaseUrl` — NIKDY hardkódovaná (ADR-0021).
 *   2. `pdf-lib` + DejaVu Sans = diakritika SK ✓ (rovnaký stack ako ADR-0022).
 *   3. Render je mimo transakcie — volá sa z route handlera.
 *   4. Error correction level H umožňuje logo v strede QR bez straty čitateľnosti.
 *
 * Preset rozloženia:
 *   avery-l7160: 3 stĺpce × 8 riadkov = 24 štítkov/A4, 63.5×38.1 mm
 *   avery-l7163: 2 stĺpce × 7 riadkov = 14 štítkov/A4, 99.1×38.1 mm
 */

import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import QRCode from 'qrcode';

import type { Organisation } from '@inventario/shared-types';

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export interface LabelAssetInput {
  _id: string;
  inventoryNumber: string;
  name: string;
  publicToken: string;
}

interface LabelPreset {
  cols: number;
  rows: number;
  labelW: number;
  labelH: number;
  marginLeft: number;
  marginTop: number;
  gapH: number;
  gapV: number;
}

// ---------------------------------------------------------------------------
// Preset konštanty (A4 = 595×842 pt)
// ---------------------------------------------------------------------------

const MM_TO_PT = 72 / 25.4;

/** Avery L7160: 63.5×38.1 mm, 3×8 = 24/A4 */
const PRESET_L7160: LabelPreset = {
  cols: 3,
  rows: 8,
  labelW: 63.5 * MM_TO_PT,
  labelH: 38.1 * MM_TO_PT,
  marginLeft: 7.2 * MM_TO_PT,
  marginTop: 15.1 * MM_TO_PT,
  gapH: 2.5 * MM_TO_PT,
  gapV: 0,
};

/** Avery L7163: 99.1×38.1 mm, 2×7 = 14/A4 */
const PRESET_L7163: LabelPreset = {
  cols: 2,
  rows: 7,
  labelW: 99.1 * MM_TO_PT,
  labelH: 38.1 * MM_TO_PT,
  marginLeft: 4.65 * MM_TO_PT,
  marginTop: 15.1 * MM_TO_PT,
  gapH: 2.5 * MM_TO_PT,
  gapV: 0,
};

export const LABEL_PRESETS: Record<'avery-l7160' | 'avery-l7163', LabelPreset> = {
  'avery-l7160': PRESET_L7160,
  'avery-l7163': PRESET_L7163,
};

// ---------------------------------------------------------------------------
// Konštanty layoutu
// ---------------------------------------------------------------------------

const PADDING = 3;
const COLOR = {
  black: rgb(0, 0, 0),
  gray: rgb(0.45, 0.45, 0.45),
  lightGray: rgb(0.85, 0.85, 0.85),
} as const;

// ---------------------------------------------------------------------------
// Hlavná exportovaná funkcia
// ---------------------------------------------------------------------------

/**
 * Vyrenderuje Avery PDF hárok so štítkami.
 *
 * @param assets       - Pole assetov (max. niekoľko sto; väčšie dávky = viac stránok).
 * @param organisation - Organisation dokument (appBaseUrl, brandKit, labelPrinting).
 * @param font         - DejaVuSans.ttf bajty.
 * @param logo         - Logo PNG bajty, alebo null ak bez loga v strede QR.
 * @param presetKey    - 'avery-l7160' (default) alebo 'avery-l7163'.
 */
export async function renderLabelSheetPdf(
  assets: LabelAssetInput[],
  organisation: Organisation,
  font: Uint8Array,
  logo: Uint8Array | null,
  presetKey: 'avery-l7160' | 'avery-l7163' = 'avery-l7160',
): Promise<Uint8Array> {
  const preset = LABEL_PRESETS[presetKey];
  const labelsPerPage = preset.cols * preset.rows;

  const appBaseUrl = organisation.appBaseUrl;
  if (!appBaseUrl) {
    throw new Error(
      'Organisation.appBaseUrl nie je nastavený — štítky nie sú použiteľné. Nastavte appBaseUrl v Settings.',
    );
  }

  const finderCfg = organisation.labelPrinting?.finderText;
  const showFinderText = finderCfg?.enabled === true && (finderCfg.text?.length ?? 0) > 0;
  const finderTextStr = showFinderText ? (finderCfg!.text ?? '') : '';

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  pdfDoc.setTitle(`Štítky majetku — ${organisation.displayName}`);
  pdfDoc.setProducer('Inventario Label Renderer');
  pdfDoc.setCreator('Inventario');

  const embedFont = await pdfDoc.embedFont(font, { subset: true });

  // Embedovanie loga raz — znovu sa použije pre každý štítok
  const logoImage = logo ? await pdfDoc.embedPng(logo) : null;

  // Rozdeliť assety na stránky
  const pageGroups: LabelAssetInput[][] = [];
  for (let i = 0; i < Math.max(assets.length, 1); i += labelsPerPage) {
    pageGroups.push(assets.slice(i, i + labelsPerPage));
  }

  for (const pageAssets of pageGroups) {
    const page = pdfDoc.addPage([595, 842]); // A4 portrait

    for (let idx = 0; idx < pageAssets.length; idx++) {
      const asset = pageAssets[idx]!;
      const col = idx % preset.cols;
      const row = Math.floor(idx / preset.cols);

      const labelX = preset.marginLeft + col * (preset.labelW + preset.gapH);
      // Y od spodku (pdf-lib koordinátový systém)
      const labelY = 842 - preset.marginTop - (row + 1) * preset.labelH - row * preset.gapV;

      await drawLabel(
        pdfDoc,
        page,
        embedFont,
        logoImage,
        asset,
        appBaseUrl,
        labelX,
        labelY,
        preset.labelW,
        preset.labelH,
        showFinderText,
        finderTextStr,
      );
    }
  }

  return pdfDoc.save({
    objectsPerTick: Infinity,
    useObjectStreams: false,
    addDefaultPage: false,
  });
}

// ---------------------------------------------------------------------------
// Kreslenie jedného štítka
// ---------------------------------------------------------------------------

async function drawLabel(
  pdfDoc: PDFDocument,
  page: ReturnType<PDFDocument['addPage']>,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  logoImage: Awaited<ReturnType<PDFDocument['embedPng']>> | null,
  asset: LabelAssetInput,
  appBaseUrl: string,
  x: number,
  y: number,
  w: number,
  h: number,
  showFinderText: boolean,
  finderText: string,
): Promise<void> {
  const invNumFontSize = 7;
  const nameFontSize = 6;
  const finderFontSize = 5.5;
  const lineH = 8;

  // Výška textovej oblasti pod QR
  let textAreaH = lineH + lineH; // invNum + name
  if (showFinderText) textAreaH += lineH;

  // QR veľkosť — zvyšok výšky po textovej oblasti a padding
  const qrAvail = h - PADDING * 2 - textAreaH;
  const qrSize = Math.max(Math.min(qrAvail, w * 0.65), 20);

  const qrUrl = `${appBaseUrl}/scan/${asset.publicToken}`;
  const qrPng = await generateQrPng(qrUrl);
  const qrImage = await pdfDoc.embedPng(qrPng);

  // Horizontálne centrovanie QR
  const qrX = x + (w - qrSize) / 2;
  const qrY = y + h - PADDING - qrSize;

  page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });

  // Logo v strede QR (voliteľné, max 22 % strany QR)
  if (logoImage) {
    const logoMax = qrSize * 0.22;
    const logoDims = logoImage.scaleToFit(logoMax, logoMax);
    page.drawImage(logoImage, {
      x: qrX + (qrSize - logoDims.width) / 2,
      y: qrY + (qrSize - logoDims.height) / 2,
      width: logoDims.width,
      height: logoDims.height,
      opacity: 0.9,
    });
  }

  const maxTextW = w - PADDING * 2;
  let textY = qrY - 2;

  // inventoryNumber
  const invNum = truncateText(font, asset.inventoryNumber, maxTextW, invNumFontSize);
  const invNumW = font.widthOfTextAtSize(invNum, invNumFontSize);
  textY -= invNumFontSize;
  page.drawText(invNum, {
    x: x + (w - invNumW) / 2,
    y: textY,
    size: invNumFontSize,
    font,
    color: COLOR.black,
  });

  // Názov
  textY -= lineH;
  const nameStr = truncateText(font, asset.name, maxTextW, nameFontSize);
  const nameW = font.widthOfTextAtSize(nameStr, nameFontSize);
  page.drawText(nameStr, {
    x: x + (w - nameW) / 2,
    y: textY,
    size: nameFontSize,
    font,
    color: COLOR.gray,
  });

  // Sprievodný text pre nálezcu
  if (showFinderText && finderText) {
    textY -= lineH;
    const ftStr = truncateText(font, finderText, maxTextW, finderFontSize);
    const ftW = font.widthOfTextAtSize(ftStr, finderFontSize);
    page.drawText(ftStr, {
      x: x + (w - ftW) / 2,
      y: textY,
      size: finderFontSize,
      font,
      color: COLOR.gray,
    });
  }

  // Ohraničujúci obdĺžnik štítka (pomáha pri strihnutí)
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    borderColor: COLOR.lightGray,
    borderWidth: 0.3,
  });
}

// ---------------------------------------------------------------------------
// Pomocné funkcie
// ---------------------------------------------------------------------------

function truncateText(
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  text: string,
  maxWidth: number,
  size: number,
): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + '…';
}

async function generateQrPng(url: string): Promise<Uint8Array> {
  const buffer = await QRCode.toBuffer(url, {
    type: 'png',
    margin: 1,
    width: 200,
    errorCorrectionLevel: 'H', // high — umožňuje logo v strede
  });
  return new Uint8Array(buffer);
}
