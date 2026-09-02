// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Unit testy generovania náhľadov (ADR-0037, fáza 1).
 *
 * Overujeme tri veci, na ktorých stojí zvyšok: že sa veľký obrázok naozaj
 * zmenší na 800 px, že sa malý NEZVÄČŠÍ (inak by náhľad bol väčší než
 * originál), a že neobrázok skončí chybou a nie tichým prázdnym výsledkom.
 */

import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import {
  canRenderThumbnail,
  createThumbnail,
  THUMBNAIL_MAX_EDGE,
} from '../../src/lib/thumbnail.js';

/** Vyrobí PNG danej veľkosti — nie fixture súbor, aby test nemal externú závislosť. */
function makePng(width: number, height: number): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3366cc';
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer('image/png');
}

/**
 * PNG s detailom v každom pixeli — plochá farba na kontrolu kvality nestačí,
 * tá sa zakóduje do pár kilobajtov aj pri najhoršom nastavení.
 *
 * Generátor je zámerne deterministický (LCG s pevným seedom), aby test
 * nekmital medzi behmi.
 */
function makeDetailedPng(width: number, height: number): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  let seed = 1;

  for (let i = 0; i < width * height; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const value = seed % 256;
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = (value * 7) % 256;
    image.data[i * 4 + 2] = (value * 13) % 256;
    image.data[i * 4 + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);
  return canvas.toBuffer('image/png');
}

describe('createThumbnail', () => {
  it('zmenší veľký obrázok na 800 px na dlhšej strane a zachová pomer strán', async () => {
    const thumb = await createThumbnail({ data: makePng(2400, 1200), mimeType: 'image/png' });

    expect(thumb.width).toBe(THUMBNAIL_MAX_EDGE);
    expect(thumb.height).toBe(THUMBNAIL_MAX_EDGE / 2);
    expect(thumb.mimeType).toBe('image/jpeg');
    expect(thumb.sizeBytes).toBe(thumb.data.byteLength);
  });

  it('funguje aj pre obrázok na výšku', async () => {
    const thumb = await createThumbnail({ data: makePng(600, 1800), mimeType: 'image/png' });

    expect(thumb.height).toBe(THUMBNAIL_MAX_EDGE);
    expect(thumb.width).toBe(Math.round((600 * THUMBNAIL_MAX_EDGE) / 1800));
  });

  it('malý obrázok NEZVÄČŠUJE', async () => {
    const thumb = await createThumbnail({ data: makePng(120, 90), mimeType: 'image/png' });

    expect(thumb.width).toBe(120);
    expect(thumb.height).toBe(90);
  });

  it('výsledok je platný JPEG (magic bytes FF D8 FF)', async () => {
    const thumb = await createThumbnail({ data: makePng(1000, 1000), mimeType: 'image/png' });

    expect(thumb.data[0]).toBe(0xff);
    expect(thumb.data[1]).toBe(0xd8);
    expect(thumb.data[2]).toBe(0xff);
  });

  it('náhľad fotky z mobilu sa zmestí pod 500 KB', async () => {
    // 4032×3024 je typický výstup mobilu. Ak by sa toto pokazilo, náhľady
    // by nafúkli dokumenty a 4,5 MB strop odpovede by bol zrazu blízko.
    const thumb = await createThumbnail({ data: makePng(4032, 3024), mimeType: 'image/png' });

    expect(thumb.sizeBytes).toBeLessThan(500 * 1024);
  });

  // Regresia z 2026-09-02: `toBuffer` berie kvalitu na škále 0–100, nie 0–1.
  // Hodnota 0.8 sa neodmietla, len znamenala kvalitu ≈1 — náhľad z fotky mal
  // 5,5 kB a plochy sa rozpadli na bloky. Test to chytá cez veľkosť: pri
  // pokazenej kvalite je výsledok rádovo menší (17 kB proti 275 kB pri q=80).
  it('kvalita je na škále 0–100 — náhľad detailnej fotky nie je rozpadnutý', async () => {
    const thumb = await createThumbnail({
      data: makeDetailedPng(1600, 1200),
      mimeType: 'image/png',
    });

    expect(thumb.sizeBytes).toBeGreaterThan(80 * 1024);
  });

  it('PDF a iné dokumenty odmietne chybou, nie tichým null', async () => {
    await expect(
      createThumbnail({ data: Buffer.from([0x25, 0x50, 0x44, 0x46]), mimeType: 'application/pdf' }),
    ).rejects.toThrow(/MIME/);
  });

  it('canRenderThumbnail nerozlišuje veľkosť písmen', () => {
    expect(canRenderThumbnail('IMAGE/JPEG')).toBe(true);
    expect(canRenderThumbnail('application/pdf')).toBe(false);
  });
});
