// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Unit testy pre stripImageMetadata — overujú, že sa EXIF/XMP/komentárové
 * segmenty odstránia, pixelové dáta ostanú a poškodené/neznáme vstupy sa
 * vrátia nezmenené (fail-safe).
 */

import { describe, expect, it } from 'vitest';

import { stripImageMetadata } from '../../src/lib/strip-image-metadata.js';

// ---------------------------------------------------------------------------
// JPEG builder helpers
// ---------------------------------------------------------------------------

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2, 0);
  return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
}

describe('stripImageMetadata — JPEG', () => {
  it('odstráni APP1 (EXIF) segment, ponechá APP0 a obrazové dáta', () => {
    const exifPayload = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from('GPSSECRET-48.1N')]);
    const jfifPayload = Buffer.concat([
      Buffer.from('JFIF\0'),
      Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ]);
    const scanData = Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44]);

    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]), // SOI
      jpegSegment(0xe1, exifPayload), // APP1 (EXIF) — má zmiznúť
      jpegSegment(0xe0, jfifPayload), // APP0 (JFIF) — ostáva
      Buffer.from([0xff, 0xda]), // SOS
      scanData,
      Buffer.from([0xff, 0xd9]), // EOI
    ]);

    const out = stripImageMetadata(jpeg, 'jpg');

    expect(out.readUInt16BE(0)).toBe(0xffd8); // stále JPEG
    expect(out.includes(Buffer.from('GPSSECRET-48.1N'))).toBe(false); // EXIF preč
    expect(out.includes(Buffer.from('JFIF\0'))).toBe(true); // JFIF ostal
    expect(out.includes(scanData)).toBe(true); // pixely netknuté
    expect(out.length).toBeLessThan(jpeg.length); // niečo sme odstránili
  });

  it('odstráni COM (komentár) segment', () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      jpegSegment(0xfe, Buffer.from('TAJNY-KOMENTAR')), // COM
      Buffer.from([0xff, 0xda]),
      Buffer.from([0xaa, 0xbb]),
      Buffer.from([0xff, 0xd9]),
    ]);
    const out = stripImageMetadata(jpeg, 'jpg');
    expect(out.includes(Buffer.from('TAJNY-KOMENTAR'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.from([0, 0, 0, 0]); // parser CRC nevaliduje
  return Buffer.concat([len, Buffer.from(type, 'ascii'), data, crc]);
}

describe('stripImageMetadata — PNG', () => {
  it('odstráni tEXt/eXIf chunky, ponechá IHDR a IEND', () => {
    const png = Buffer.concat([
      PNG_SIG,
      pngChunk('IHDR', Buffer.alloc(13, 1)),
      pngChunk('tEXt', Buffer.from('Comment\0CITLIVE-META')),
      pngChunk('eXIf', Buffer.from('GPS-EXIF-DATA')),
      pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x00])),
      pngChunk('IEND', Buffer.alloc(0)),
    ]);

    const out = stripImageMetadata(png, 'png');

    expect(out.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    expect(out.includes(Buffer.from('CITLIVE-META'))).toBe(false);
    expect(out.includes(Buffer.from('GPS-EXIF-DATA'))).toBe(false);
    expect(out.includes(Buffer.from('IHDR'))).toBe(true);
    expect(out.includes(Buffer.from('IDAT'))).toBe(true);
    expect(out.includes(Buffer.from('IEND'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fail-safe / no-op
// ---------------------------------------------------------------------------

describe('stripImageMetadata — fail-safe', () => {
  it('neznámy typ (pdf) → vráti pôvodný buffer nezmenený', () => {
    const pdf = Buffer.from('%PDF-1.7 ...obsah dokladu...');
    const out = stripImageMetadata(pdf, 'pdf');
    expect(out.equals(pdf)).toBe(true);
  });

  it('poškodený JPEG (len SOI) → vráti pôvodný buffer', () => {
    const broken = Buffer.from([0xff, 0xd8]);
    const out = stripImageMetadata(broken, 'jpg');
    expect(out.equals(broken)).toBe(true);
  });

  it('nie-JPEG dáta s jpg príponou → vráti pôvodný buffer', () => {
    const notJpeg = Buffer.from('toto nie je obrázok');
    const out = stripImageMetadata(notJpeg, 'jpg');
    expect(out.equals(notJpeg)).toBe(true);
  });
});
