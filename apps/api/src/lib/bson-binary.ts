// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Prevod BinData z MongoDB na `Buffer`.
 *
 * Driver vracia BinData ako BSON `Binary`, ktorý NIE JE `Uint8Array`.
 * `Buffer.from(binary)` preto vráti PRÁZDNY buffer — ticho, bez chyby.
 * Prejaví sa to až tým, že používateľ vidí prázdny obrázok, a hľadá sa to
 * ťažko, lebo v DB je obsah v poriadku.
 *
 * Schémy (`StoredImageSchema`) sľubujú `Uint8Array`, čo platí pre zápis.
 * Pre čítanie treba túto funkciu — na každom mieste, kde binárka opúšťa DB.
 */

import { Binary } from 'mongodb';

export function bsonBinaryToBuffer(value: Uint8Array): Buffer {
  if (value instanceof Binary) return Buffer.from(value.buffer);
  return Buffer.from(value);
}
