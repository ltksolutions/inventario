// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * ObjectStorage — abstrakcia nad úložiskom originálov príloh (ADR-0037).
 *
 * Prečo abstrakcia a nie priame volanie `@vercel/blob`: integračné testy
 * bežia proti in-memory Mongu a nesmú siahať na skutočný Blob store.
 * Rovnaký vzor ako `plugins/email-providers/` — interface, reálna
 * implementácia, a stub pre testy a lokálny vývoj bez tokenu.
 *
 * Rozsah je zámerne úzky. Toto NIE JE generický S3 klient; sú tu presne
 * tie operácie, ktoré `modules/attachments` potrebuje:
 *
 *   presignUpload  — podpísaná PUT URL, prehliadač nahráva priamo do storu
 *                    (obchádza 4,5 MB strop Vercelu na telo requestu)
 *   presignDownload— podpísaná GET URL s krátkou expiráciou, vydaná až po
 *                    autorizácii v handleri
 *   head           — overenie po uploade: existuje objekt, aká je veľkosť
 *   get            — stiahnutie do funkcie (odstránenie EXIF, náhľad)
 *   put            — zápis zo servera (prepis po odstránení EXIF, malé súbory)
 *   remove         — mazanie pri soft delete a pri výmaze podľa GDPR čl. 17
 *
 * POZOR na podpísané URL: do expirácie sú prenosné. Nikdy ich nelogovať
 * celé a držať expiráciu krátku (viď `DOWNLOAD_URL_TTL_SECONDS`).
 */

import type { FastifyBaseLogger } from 'fastify';

/** Ako dlho platí podpísaná GET URL. Krátko — je prenosná. */
export const DOWNLOAD_URL_TTL_SECONDS = 15 * 60;

/** Ako dlho platí podpísaná PUT URL. Musí pokryť upload veľkého súboru. */
export const UPLOAD_URL_TTL_SECONDS = 30 * 60;

export interface StoredObject {
  /** Cesta v store, napr. `attachments/<tenantId>/<assetId>/<uuid>.jpg`. */
  pathname: string;
  /** Veľkosť v bajtoch. */
  sizeBytes: number;
  /** MIME type, ako ho store eviduje. */
  contentType: string;
}

export interface PresignedUpload {
  /** URL, na ktorú prehliadač pošle PUT. */
  url: string;
  /** Cesta, pod ktorou objekt v store vznikne. */
  pathname: string;
  /** Kedy podpis expiruje (ISO 8601). */
  expiresAt: string;
}

export interface ObjectStorage {
  /** Identifikátor do logov. */
  readonly name: 'vercel-blob' | 'stub';

  /** Či je úložisko nakonfigurované a použiteľné. */
  readonly isConfigured: boolean;

  /**
   * Podpísaná PUT URL pre priamy upload z prehliadača.
   * Handler ju vydá až po kontrole oprávnenia.
   */
  presignUpload(input: { pathname: string; contentType: string }): Promise<PresignedUpload>;

  /**
   * Podpísaná GET URL s krátkou expiráciou. Vydať až po `requireAuth`,
   * kontrole tenanta a role.
   */
  presignDownload(pathname: string): Promise<{ url: string; expiresAt: string }>;

  /** Metadáta objektu, alebo `null` ak neexistuje. */
  head(pathname: string): Promise<StoredObject | null>;

  /** Stiahne obsah do pamäte funkcie. */
  get(pathname: string): Promise<Buffer>;

  /** Zapíše obsah. Prepíše, ak `pathname` už existuje. */
  put(input: { pathname: string; body: Buffer; contentType: string }): Promise<StoredObject>;

  /** Zmaže objekt. Neexistujúci objekt NIE JE chyba (idempotentné). */
  remove(pathname: string): Promise<void>;
}

export interface StorageContext {
  logger: FastifyBaseLogger;
  /** Token pre prístup k store. Mimo Vercelu povinný. */
  token?: string | undefined;
}
