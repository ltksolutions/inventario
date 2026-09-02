// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Detekcia typu súboru podľa magic bytes.
 *
 * Prečo magic bytes a nie `Content-Type` z requestu: hlavičku aj príponu
 * určuje klient, takže sa dá klamať. Obsah nie. Pri prílohách to nie je
 * teoretická obava — cez upload prechádzajú súbory od používateľov tenanta.
 *
 * Presunuté sem z `modules/attachments/attachments.routes.ts` (2026-09-02),
 * lebo to isté overenie potrebuje aj krok `confirm` pri priamom uploade do
 * private storu: tam server súbor nikdy nevidel, kým si ho nestiahne, takže
 * musí overiť, že v store naozaj leží to, čo klient tvrdil.
 */

export interface DetectedFileType {
  ext: string;
  contentType: string;
  kind: 'image' | 'pdf';
}

export function detectFileType(buf: Buffer): DetectedFileType | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: 'png', contentType: 'image/png', kind: 'image' };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg', kind: 'image' };
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return { ext: 'webp', contentType: 'image/webp', kind: 'image' };
  }
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return { ext: 'pdf', contentType: 'application/pdf', kind: 'pdf' };
  }
  return null;
}

/** MIME typy, ktoré smie klient ohlásiť pri žiadosti o podpísaný upload. */
export const ALLOWED_UPLOAD_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;

export type AllowedUploadContentType = (typeof ALLOWED_UPLOAD_CONTENT_TYPES)[number];

/** Prípona podľa ohláseného MIME typu — len na zostavenie `pathname`. */
export function extensionForContentType(contentType: AllowedUploadContentType): string {
  switch (contentType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'application/pdf':
      return 'pdf';
  }
}
