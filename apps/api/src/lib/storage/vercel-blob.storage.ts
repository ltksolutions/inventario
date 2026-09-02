// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Vercel Blob — private store (ADR-0037).
 *
 * Originály príloh ležia v PRIVATE store, teda každé čítanie aj zápis
 * vyžaduje autentifikáciu a URL `<store-id>.private.blob.vercel-storage.com`
 * nie je verejne dostupná.
 *
 * Podpisovanie je dvojkrokové, tak to SDK 2.8 vyžaduje:
 *
 *   1. `issueSignedToken()` — control-plane volanie, vráti delegačný token
 *      zúžený na pathname, povolené operácie a expiráciu.
 *   2. `presignUrl()` — z delegácie vyrobí konkrétnu podpísanú URL.
 *
 * Delegáciu preto zúžujeme na JEDEN pathname a JEDNU operáciu. Kto URL do
 * expirácie získa, vie s ňou urobiť presne to jedno — nie čítať celý store.
 *
 * Autentifikácia: VŽDY explicitný `BLOB_PRIVATE_READ_WRITE_TOKEN`. Keby
 * sme ho nepredali, SDK si vezme `process.env.BLOB_READ_WRITE_TOKEN` —
 * čo je token STARÉHO PUBLIC storu — a originály príloh by skončili
 * verejne. Preto `createVercelBlobStorage` bez tokenu padne.
 *
 * POZOR: podpísané URL sa nikdy nelogujú celé. Do logu ide iba pathname.
 */

import { del, get, head, issueSignedToken, presignUrl, put } from '@vercel/blob';

import { DOWNLOAD_URL_TTL_SECONDS, UPLOAD_URL_TTL_SECONDS } from './types.js';

import type { ObjectStorage, PresignedUpload, StorageContext, StoredObject } from './types.js';

const ACCESS = 'private' as const;

/** Prevedie `ReadableStream` z `get()` na `Buffer`. */
async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  return Buffer.concat(chunks);
}

export function createVercelBlobStorage(ctx: StorageContext): ObjectStorage {
  const { logger, token } = ctx;

  if (token === undefined) {
    throw new Error(
      'createVercelBlobStorage: chýba token. Bez explicitného tokenu by ' +
        '@vercel/blob použil BLOB_READ_WRITE_TOKEN starého public storu.',
    );
  }

  /** Spoločné options pre control-plane volania. Token je vždy explicitný. */
  const commonOptions = { token };

  return {
    name: 'vercel-blob',
    isConfigured: true,

    async presignUpload(input): Promise<PresignedUpload> {
      const validUntil = Date.now() + UPLOAD_URL_TTL_SECONDS * 1000;

      const signedToken = await issueSignedToken({
        ...commonOptions,
        pathname: input.pathname,
        operations: ['put'],
        validUntil,
        allowedContentTypes: [input.contentType],
      });

      const { presignedUrl } = await presignUrl(signedToken, {
        access: ACCESS,
        operation: 'put',
        pathname: input.pathname,
        validUntil,
        // Prepis toho istého pathname nedovolíme — každá príloha má vlastné
        // UUID, takže kolízia znamená chybu, nie zámer.
        allowOverwrite: false,
      });

      logger.debug({ pathname: input.pathname }, '[STORAGE] podpísaná PUT URL vydaná');

      return {
        url: presignedUrl,
        pathname: input.pathname,
        expiresAt: new Date(validUntil).toISOString(),
      };
    },

    async presignDownload(pathname): Promise<{ url: string; expiresAt: string }> {
      const validUntil = Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000;

      const signedToken = await issueSignedToken({
        ...commonOptions,
        pathname,
        operations: ['get'],
        validUntil,
      });

      const { presignedUrl } = await presignUrl(signedToken, {
        access: ACCESS,
        operation: 'get',
        pathname,
        validUntil,
      });

      logger.debug({ pathname }, '[STORAGE] podpísaná GET URL vydaná');

      return { url: presignedUrl, expiresAt: new Date(validUntil).toISOString() };
    },

    async head(pathname): Promise<StoredObject | null> {
      try {
        const result = await head(pathname, commonOptions);
        return {
          pathname: result.pathname,
          sizeBytes: result.size,
          contentType: result.contentType,
        };
      } catch (err) {
        // `head` na neexistujúci objekt hodí BlobNotFoundError. Pre volajúceho
        // je "neexistuje" legitímna odpoveď, nie výnimka.
        logger.debug({ pathname, err }, '[STORAGE] head — objekt neexistuje');
        return null;
      }
    },

    async get(pathname): Promise<Buffer> {
      // `useCache: false` obchádza CDN. Objekt vieme čítať hneď po zápise
      // (krok `confirm`, migrácie) a cache by mohla vrátiť starý stav alebo
      // ešte nič — čítame ho práve preto, že sa zmenil.
      const result = await get(pathname, { ...commonOptions, access: ACCESS, useCache: false });

      if (result === null || result.statusCode !== 200) {
        // Status patrí do hlášky. Bez neho sa nedá odlíšiť „objekt tam nie je"
        // od „nemáme naň právo" a pri zlyhaní migrácie sa dá len hádať.
        const status = result === null ? 'null' : String(result.statusCode);
        throw new Error(`[STORAGE] Objekt sa nedá prečítať (status ${status}): ${pathname}`);
      }

      return streamToBuffer(result.stream);
    },

    async put(input): Promise<StoredObject> {
      const result = await put(input.pathname, input.body, {
        ...commonOptions,
        access: ACCESS,
        contentType: input.contentType,
        // Prepis je tu zámer: `confirm` krok prepisuje originál po odstránení
        // EXIF na tom istom pathname.
        allowOverwrite: true,
        addRandomSuffix: false,
      });

      // Cesta z odpovede, nie tá naša. Keby ju store zmenil (napr. doplnil
      // príponu), zapísali by sme si do DB odkaz, za ktorým nič nie je —
      // presne to sa stalo pri prvom priamom uploade 2026-09-02: `head`
      // objekt našiel, ale čítanie na uloženej ceste vracalo 404.
      if (result.pathname !== input.pathname) {
        logger.warn(
          { requested: input.pathname, stored: result.pathname },
          '[STORAGE] store uložil objekt na inú cestu, než sme žiadali',
        );
      }

      return {
        pathname: result.pathname,
        sizeBytes: input.body.byteLength,
        contentType: input.contentType,
      };
    },

    async remove(pathname): Promise<void> {
      try {
        await del(pathname, commonOptions);
      } catch (err) {
        // Idempotentné: mazanie neexistujúceho objektu nie je chyba. Logujeme
        // ako warn, aby sa nestratila informácia o skutočnom probléme.
        logger.warn({ pathname, err }, '[STORAGE] mazanie zlyhalo alebo objekt neexistoval');
      }
    },
  };
}
