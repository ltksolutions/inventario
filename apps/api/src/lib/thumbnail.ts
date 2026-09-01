// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Generovanie náhľadov príloh (ADR-0037).
 *
 * Náhľad je to, čo vidí používateľ vo výpise majetku. Originál sa naň
 * nepoužíva: leží v privátnom store a každé jeho zobrazenie by znamenalo
 * podpísanú URL a plný prenos — pri dvadsiatich fotkách na stránke
 * desiatky MB. Náhľad ide preto do Monga ako BinData a servíruje ho
 * jeden autentifikovaný endpoint.
 *
 * PREČO @napi-rs/canvas: Skia je v repe už kvôli QR obrázkom
 * (`modules/assets/qr-image-renderer.ts`), takže žiadna nová závislosť.
 * `loadImage()` rozpozná PNG aj JPEG podľa magic bytes sám.
 *
 * ROZMER 800 px na dlhšej strane a JPEG q≈0,8 dávajú ~200–300 KB. To je
 * vedomý kompromis: dosť na fotku cez celú šírku mobilu pri 2× DPR, a
 * dosť málo, aby dvadsať náhľadov v jednom dokumente nepribližovalo
 * 16 MB strop Monga ani 4,5 MB strop odpovede funkcie.
 *
 * Náhľad sa NEROBÍ z PDF a iných dokumentov — len z rastrových obrázkov.
 * Volajúci si to musí overiť; `createThumbnail` na neobrázok hodí chybu,
 * nie tichý `null`, aby sa taká situácia neprešla mlčky.
 */

import { createCanvas, loadImage } from '@napi-rs/canvas';

import type { StoredImage } from '@inventario/shared-types';

/** Dlhšia strana náhľadu v pixeloch. */
export const THUMBNAIL_MAX_EDGE = 800;

/** JPEG kvalita. 0,8 je hranica, za ktorou rastie veľkosť rýchlejšie než kvalita. */
const THUMBNAIL_JPEG_QUALITY = 0.8;

/** MIME typy, z ktorých vieme náhľad urobiť. */
const RASTER_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function canRenderThumbnail(mimeType: string): boolean {
  return RASTER_MIME_TYPES.has(mimeType.toLowerCase());
}

/**
 * Zmenší obrázok na `THUMBNAIL_MAX_EDGE` na dlhšej strane a vráti JPEG.
 *
 * Menší obrázok sa NEZVÄČŠUJE — zväčšovanie len nafúkne bajty bez pridanej
 * informácie. Vtedy je náhľad rovnako veľký ako originál, čo je v poriadku:
 * originál je v takom prípade sám dosť malý.
 *
 * @throws ak `mimeType` nie je rastrový obrázok, alebo ak sa obsah nedá
 *   dekódovať (poškodený súbor, iný formát než tvrdí MIME).
 */
export async function createThumbnail(input: {
  data: Uint8Array;
  mimeType: string;
}): Promise<StoredImage> {
  if (!canRenderThumbnail(input.mimeType)) {
    throw new Error(`Náhľad sa nedá vyrobiť z MIME typu "${input.mimeType}".`);
  }

  const image = await loadImage(Buffer.from(input.data));

  const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // JPEG nepozná priehľadnosť — bez tohto by sa priehľadné PNG vykreslilo
  // na čierno. Biele pozadie je to, čo používateľ čaká.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  const data = canvas.toBuffer('image/jpeg', THUMBNAIL_JPEG_QUALITY);

  return {
    data,
    mimeType: 'image/jpeg',
    width,
    height,
    sizeBytes: data.byteLength,
  };
}
