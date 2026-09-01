// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * In-memory stub úložiska (ADR-0037).
 *
 * Používa sa v testoch a v lokálnom vývoji bez `BLOB_READ_WRITE_TOKEN`.
 * Drží objekty v `Map` v pamäti procesu — po restarte je prázdny, čo je
 * pre testy správne chovanie.
 *
 * Podpísané URL sú tu fikcia (`stub://…`), ale majú rovnaký tvar a rovnakú
 * expiráciu ako reálne, aby testy vedeli overiť, že handler URL vôbec
 * vydáva a s akou platnosťou.
 */

import { DOWNLOAD_URL_TTL_SECONDS, UPLOAD_URL_TTL_SECONDS } from './types.js';

import type { ObjectStorage, PresignedUpload, StorageContext, StoredObject } from './types.js';

interface StubEntry {
  body: Buffer;
  contentType: string;
}

function expiryIso(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export interface StubStorage extends ObjectStorage {
  /** Len pre testy: koľko objektov je v store. */
  readonly size: number;
  /** Len pre testy: vloží objekt bez podpisovania. */
  seed(input: { pathname: string; body: Buffer; contentType: string }): void;
  /** Len pre testy: vyprázdni store. */
  reset(): void;
}

export function createStubStorage(ctx: StorageContext): StubStorage {
  const { logger } = ctx;
  const objects = new Map<string, StubEntry>();

  return {
    name: 'stub',
    isConfigured: true,

    get size() {
      return objects.size;
    },

    seed(input) {
      objects.set(input.pathname, { body: input.body, contentType: input.contentType });
    },

    reset() {
      objects.clear();
    },

    presignUpload(input): Promise<PresignedUpload> {
      logger.debug({ pathname: input.pathname }, '[STORAGE-STUB] presignUpload');
      return Promise.resolve({
        url: `stub://upload/${encodeURIComponent(input.pathname)}`,
        pathname: input.pathname,
        expiresAt: expiryIso(UPLOAD_URL_TTL_SECONDS),
      });
    },

    presignDownload(pathname): Promise<{ url: string; expiresAt: string }> {
      logger.debug({ pathname }, '[STORAGE-STUB] presignDownload');
      return Promise.resolve({
        url: `stub://download/${encodeURIComponent(pathname)}`,
        expiresAt: expiryIso(DOWNLOAD_URL_TTL_SECONDS),
      });
    },

    head(pathname): Promise<StoredObject | null> {
      const entry = objects.get(pathname);
      if (!entry) return Promise.resolve(null);
      return Promise.resolve({
        pathname,
        sizeBytes: entry.body.byteLength,
        contentType: entry.contentType,
      });
    },

    get(pathname): Promise<Buffer> {
      const entry = objects.get(pathname);
      if (!entry) {
        return Promise.reject(new Error(`[STORAGE-STUB] Objekt neexistuje: ${pathname}`));
      }
      return Promise.resolve(entry.body);
    },

    put(input): Promise<StoredObject> {
      objects.set(input.pathname, { body: input.body, contentType: input.contentType });
      return Promise.resolve({
        pathname: input.pathname,
        sizeBytes: input.body.byteLength,
        contentType: input.contentType,
      });
    },

    remove(pathname): Promise<void> {
      // Idempotentné — mazanie neexistujúceho objektu nie je chyba.
      objects.delete(pathname);
      return Promise.resolve();
    },
  };
}
