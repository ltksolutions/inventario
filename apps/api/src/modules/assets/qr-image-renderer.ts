// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Kompozitný QR obrázok (PNG/SVG) — samostatný download/náhľad na detaile
 * assetu (`GET /v1/assets/:id/qr`). Čistá funkcia, analogická
 * `label-sheet-renderer.ts`, ale pre jeden štandalone obrázok (nie hárok).
 *
 * Obsahuje:
 *   - QR kód zakódovávajúci `${appBaseUrl}/scan/${publicToken}` (ADR-0021)
 *   - Logo organizácie v strede QR (fallback default Inventario logo —
 *     `loadLogo()` z `protocols/logo-loader.ts` vždy vráti nejaké bajty)
 *   - inventoryNumber + názov assetu pod QR kódom
 *
 * PREČO @napi-rs/canvas (nie pdf-lib ako pri Avery štítkoch): potrebujeme
 * priamo rastrovaný PNG, nie PDF. Font sa embeduje rovnako ako v ADR-0022
 * (DejaVuSans.ttf bajty priamo, nikdy sa nespoliehať na systémové fonty
 * servera — inak diakritika padá/mizne).
 *
 * BONUS: @napi-rs/canvas (Skia) rozpoznáva PNG aj JPEG automaticky podľa
 * magic bytes v `loadImage()` — na rozdiel od pdf-lib, kde treba ručne
 * vybrať `embedPng`/`embedJpg` (tento bug sa v repe zopakoval 2×, viď
 * `label-sheet-renderer.ts`). Pre SVG `<image>` data-URI mime typ ale MUSÍME
 * určiť sami (SVG to samo neodvodí) — preto tu zostáva magic-byte detekcia
 * len v SVG vetve.
 */

import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import QRCode from 'qrcode';

import type { SKRSContext2D } from '@napi-rs/canvas';

// ---------------------------------------------------------------------------
// Konštanty layoutu
// ---------------------------------------------------------------------------

const QR_SIZE = 300;
const PADDING = 14;
const CANVAS_W = QR_SIZE + PADDING * 2;
const TEXT_AREA_H = 60;
const CANVAS_H = PADDING + QR_SIZE + TEXT_AREA_H;

/** Max. veľkosť loga voči strane QR — rovnaký pomer ako Avery štítky. */
const LOGO_MAX_RATIO = 0.22;

const FONT_FAMILY = 'InventarioQR';
let fontRegistered = false;

/** Registruje DejaVuSans.ttf do Skia font registry — len raz (warm invocations). */
function ensureFontRegistered(font: Uint8Array): void {
  if (fontRegistered) return;
  GlobalFonts.register(Buffer.from(font), FONT_FAMILY);
  fontRegistered = true;
}

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export interface QrImageInput {
  /** URL zakódovaná v QR (appBaseUrl/scan/publicToken) — ADR-0021. */
  url: string;
  inventoryNumber: string;
  name: string;
  /** DejaVuSans.ttf bajty (loadDefaultFont() z logo-loader.ts). */
  font: Uint8Array;
  /** PNG alebo JPEG bajty loga (loadLogo() — nikdy null, fallback default). */
  logo: Uint8Array;
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

export async function renderQrPng(input: QrImageInput): Promise<Buffer> {
  ensureFontRegistered(input.font);

  const qrPngBuffer = await QRCode.toBuffer(input.url, {
    type: 'png',
    margin: 2,
    width: QR_SIZE,
    errorCorrectionLevel: 'H', // vysoká — umožňuje logo v strede bez straty čitateľnosti
  });

  const canvas = createCanvas(CANVAS_W, CANVAS_H);
  const ctx = canvas.getContext('2d');

  // Biele pozadie — obrázok sa tlačí na papier.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const qrImage = await loadImage(qrPngBuffer);
  ctx.drawImage(qrImage, PADDING, PADDING, QR_SIZE, QR_SIZE);

  // Logo v strede QR — loadImage rozpozná PNG/JPEG sám (Skia magic-byte sniff).
  const logoImage = await loadImage(Buffer.from(input.logo));
  const logoMax = QR_SIZE * LOGO_MAX_RATIO;
  const logoScale = Math.min(logoMax / logoImage.width, logoMax / logoImage.height, 1);
  const logoW = logoImage.width * logoScale;
  const logoH = logoImage.height * logoScale;
  ctx.drawImage(
    logoImage,
    PADDING + (QR_SIZE - logoW) / 2,
    PADDING + (QR_SIZE - logoH) / 2,
    logoW,
    logoH,
  );

  // Text pod QR — inventoryNumber (tučné) + názov (sivé), orezané na šírku.
  const maxTextW = CANVAS_W - PADDING * 2;
  const invNumY = PADDING + QR_SIZE + 24;
  const nameY = invNumY + 22;

  ctx.textAlign = 'center';

  ctx.font = `bold 18px "${FONT_FAMILY}"`;
  ctx.fillStyle = '#000000';
  ctx.fillText(truncateText(ctx, input.inventoryNumber, maxTextW), CANVAS_W / 2, invNumY);

  ctx.font = `14px "${FONT_FAMILY}"`;
  ctx.fillStyle = '#4d4d4d';
  ctx.fillText(truncateText(ctx, input.name, maxTextW), CANVAS_W / 2, nameY);

  return canvas.toBuffer('image/png');
}

function truncateText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

export async function renderQrSvg(input: QrImageInput): Promise<string> {
  ensureFontRegistered(input.font);

  const qrSvgRaw = await QRCode.toString(input.url, {
    type: 'svg',
    margin: 2,
    width: QR_SIZE,
    errorCorrectionLevel: 'H',
  });

  // qrcode vracia plný `<svg viewBox="...">...</svg>` dokument — vnorime ho
  // ako nested <svg x/y/width/height> namiesto ručného prepočtu transformácií.
  const viewBoxMatch = qrSvgRaw.match(/viewBox="([^"]+)"/);
  const innerMatch = qrSvgRaw.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  const viewBox = viewBoxMatch?.[1] ?? `0 0 ${QR_SIZE} ${QR_SIZE}`;
  const qrInner = innerMatch?.[1] ?? '';

  // Meranie šírky textu cez canvas 2D kontext (rovnaký font ako PNG vetva),
  // aby orezanie sedelo s rastrovanou verziou. SVG <text> sa v prehliadači
  // aj tak renderuje systémovým fontom (font-family má fallback reťazec) —
  // toto meranie je len aproximácia pre orezanie, nie presné vykreslenie.
  const measureCanvas = createCanvas(1, 1);
  const measureCtx = measureCanvas.getContext('2d');
  const maxTextW = CANVAS_W - PADDING * 2;

  measureCtx.font = `bold 18px "${FONT_FAMILY}"`;
  const invNum = truncateText(measureCtx, input.inventoryNumber, maxTextW);

  measureCtx.font = `14px "${FONT_FAMILY}"`;
  const name = truncateText(measureCtx, input.name, maxTextW);

  // Logo ako base64 data-URI — mime typ MUSÍME určiť sami (magic bytes),
  // SVG <image> to na rozdiel od Skia loadImage() neodvodí.
  const isJpeg = input.logo.length > 2 && input.logo[0] === 0xff && input.logo[1] === 0xd8;
  const logoMime = isJpeg ? 'image/jpeg' : 'image/png';
  const logoBase64 = Buffer.from(input.logo).toString('base64');

  const logoImage = await loadImage(Buffer.from(input.logo));
  const logoMax = QR_SIZE * LOGO_MAX_RATIO;
  const logoScale = Math.min(logoMax / logoImage.width, logoMax / logoImage.height, 1);
  const logoW = logoImage.width * logoScale;
  const logoH = logoImage.height * logoScale;
  const logoX = PADDING + (QR_SIZE - logoW) / 2;
  const logoY = PADDING + (QR_SIZE - logoH) / 2;

  const invNumY = PADDING + QR_SIZE + 24;
  const nameY = invNumY + 22;
  const fontStack = `${FONT_FAMILY}, 'DejaVu Sans', Arial, sans-serif`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<svg x="${PADDING}" y="${PADDING}" width="${QR_SIZE}" height="${QR_SIZE}" viewBox="${viewBox}">${qrInner}</svg>`,
    `<image href="data:${logoMime};base64,${logoBase64}" x="${logoX}" y="${logoY}" width="${logoW}" height="${logoH}"/>`,
    `<text x="${CANVAS_W / 2}" y="${invNumY}" font-family="${fontStack}" font-size="18" font-weight="bold" text-anchor="middle" fill="#000000">${escapeXml(invNum)}</text>`,
    `<text x="${CANVAS_W / 2}" y="${nameY}" font-family="${fontStack}" font-size="14" text-anchor="middle" fill="#4d4d4d">${escapeXml(name)}</text>`,
    `</svg>`,
  ].join('\n');
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
