// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Strip metadata (EXIF, XMP, comments) z nahrávaných obrázkov pred uložením.
 *
 * Privacy / GDPR data-minimisation: fotky z telefónov bežne nesú GPS súradnice,
 * sériové číslo zariadenia a presný čas v EXIF blokoch. Tieto údaje nemajú pre
 * evidenciu majetku žiadnu hodnotu, ale sú osobné/citlivé — preto ich pri
 * uploade odstraňujeme.
 *
 * Implementácia je **pure-JS bez závislosti** (žiadny sharp/exiftool) — parsujeme
 * kontajner a vypustíme metadata segmenty/chunky. Pixelové dáta ostávajú nedotknuté.
 *
 * Fail-safe: pri akejkoľvek chybe parsovania vrátime PÔVODNÝ buffer (nikdy
 * nevrátime poškodený obrázok — radšej ponecháme metadata, než rozbiť súbor).
 *
 * Pokrytie:
 *   - JPEG: vypustí APP1 (EXIF/XMP) … APP15 a COM (komentár); ponechá APP0 (JFIF).
 *   - PNG:  vypustí eXIf, tEXt, iTXt, zTXt, tIME chunky.
 *   - WEBP: vypustí EXIF a XMP chunky (+ prepočíta RIFF veľkosť).
 *   - PDF / ostatné: bez zmeny (doklady nech ostanú intaktné).
 */

const JPEG_SOI = 0xffd8;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Odstráni metadata z obrázka podľa detegovaného typu.
 *
 * @param buf  pôvodný súbor
 * @param ext  prípona z magic-byte detekcie ('jpg' | 'png' | 'webp' | 'pdf' | ...)
 * @returns    buffer bez metadata, alebo pôvodný buffer ak strip nie je možný
 */
export function stripImageMetadata(buf: Buffer, ext: string): Buffer {
  try {
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return stripJpeg(buf);
      case 'png':
        return stripPng(buf);
      case 'webp':
        return stripWebp(buf);
      default:
        return buf;
    }
  } catch {
    // Akákoľvek chyba → ponechaj pôvodný súbor (nikdy nevracaj poškodené dáta).
    return buf;
  }
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

function stripJpeg(buf: Buffer): Buffer {
  if (buf.length < 2 || buf.readUInt16BE(0) !== JPEG_SOI) return buf;

  const out: Buffer[] = [buf.subarray(0, 2)]; // SOI
  let pos = 2;

  while (pos < buf.length) {
    // Každý marker začína 0xFF. Ak nie, štruktúra je neočakávaná → ponechaj zvyšok.
    if (buf[pos] !== 0xff) {
      out.push(buf.subarray(pos));
      break;
    }
    const marker = buf[pos + 1];
    if (marker === undefined) {
      out.push(buf.subarray(pos));
      break;
    }

    // SOS (0xDA) = začiatok komprimovaných dát; zvyšok skopíruj verbatim.
    if (marker === 0xda) {
      out.push(buf.subarray(pos));
      break;
    }

    // Standalone markery bez dĺžkového poľa (RSTn, SOI, EOI, TEM).
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      out.push(buf.subarray(pos, pos + 2));
      pos += 2;
      continue;
    }

    // Segment s dĺžkou (2 bajty, big-endian, vrátane seba).
    const segLen = buf.readUInt16BE(pos + 2);
    const segEnd = pos + 2 + segLen;
    if (segEnd > buf.length) {
      // Poškodená dĺžka → ponechaj zvyšok bez zmeny.
      out.push(buf.subarray(pos));
      break;
    }

    const isAppMeta = marker >= 0xe1 && marker <= 0xef; // APP1..APP15
    const isComment = marker === 0xfe; // COM
    if (!isAppMeta && !isComment) {
      out.push(buf.subarray(pos, segEnd)); // ponechaj (APP0/JFIF, DQT, SOF, ...)
    }
    // inak segment vynecháme (drop EXIF/XMP/komentáre)

    pos = segEnd;
  }

  return Buffer.concat(out);
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_DROP_CHUNKS = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

function stripPng(buf: Buffer): Buffer {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return buf;

  const out: Buffer[] = [buf.subarray(0, 8)]; // signature
  let pos = 8;

  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const chunkEnd = pos + 12 + len; // len(4) + type(4) + data(len) + crc(4)
    if (chunkEnd > buf.length) {
      out.push(buf.subarray(pos)); // poškodený chunk → ponechaj zvyšok
      break;
    }

    if (!PNG_DROP_CHUNKS.has(type)) {
      out.push(buf.subarray(pos, chunkEnd));
    }

    pos = chunkEnd;
    if (type === 'IEND') break;
  }

  return Buffer.concat(out);
}

// ---------------------------------------------------------------------------
// WEBP (RIFF kontajner)
// ---------------------------------------------------------------------------

const WEBP_DROP_CHUNKS = new Set(['EXIF', 'XMP ']);

function stripWebp(buf: Buffer): Buffer {
  if (
    buf.length < 12 ||
    buf.toString('ascii', 0, 4) !== 'RIFF' ||
    buf.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return buf;
  }

  const body: Buffer[] = [];
  let pos = 12;

  while (pos + 8 <= buf.length) {
    const fourcc = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const padded = size + (size % 2); // RIFF chunky sú zarovnané na párny počet
    const chunkEnd = pos + 8 + padded;
    if (chunkEnd > buf.length) {
      body.push(buf.subarray(pos)); // poškodené → ponechaj
      break;
    }

    if (!WEBP_DROP_CHUNKS.has(fourcc)) {
      body.push(buf.subarray(pos, chunkEnd));
    }

    pos = chunkEnd;
  }

  const bodyBuf = Buffer.concat(body);
  const out = Buffer.concat([buf.subarray(0, 12), bodyBuf]);
  // Prepočítaj RIFF veľkosť = 4 ('WEBP') + dĺžka tela.
  out.writeUInt32LE(4 + bodyBuf.length, 4);
  return out;
}
