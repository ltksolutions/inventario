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
