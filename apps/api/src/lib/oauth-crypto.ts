// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * OAuth client secret crypto helpers — encrypt/decrypt per-tenant
 * OAuth client secrets at rest (ADR-0031).
 *
 * Why encrypt OAuth client secrets?
 *   A DB dump exposing plaintext client secrets allows an attacker to
 *   impersonate the tenant's OAuth app and issue tokens. By encrypting
 *   with a key kept only in env (`OAUTH_SECRET_ENCRYPTION_KEY`), a
 *   DB-only compromise is insufficient.
 *
 * Encryption: AES-256-GCM (same algorithm as mfa-crypto.ts)
 *   - Key:    32 bytes from `OAUTH_SECRET_ENCRYPTION_KEY` (hex-decoded)
 *   - IV:     12 random bytes per encryption
 *   - Auth:   16-byte GCM tag, prevents tampering
 *   - Format: `<iv-hex>:<tag-hex>:<ciphertext-hex>`
 *
 * Intentionally a SEPARATE key from MFA_SECRET_ENCRYPTION_KEY:
 *   Principle of least privilege — an attacker who obtains one key
 *   cannot use it to decrypt data from the other domain.
 *
 * Write-only contract:
 *   The encrypted value is stored in `Organisation.oauthCredentials.
 *   *.clientSecretEncrypted`. The API read path NEVER returns this field;
 *   it is stripped by the service layer and replaced with a boolean
 *   `hasSecret`. Plaintext is never persisted.
 *
 * Key rotation:
 *   Rotating `OAUTH_SECRET_ENCRYPTION_KEY` requires re-encrypting all
 *   stored secrets (migration script). Until re-encrypted, per-tenant
 *   OAuth logins fall back to the platform env credentials.
 *   Generate: openssl rand -hex 32
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

/**
 * Encrypt a plaintext OAuth client secret with AES-256-GCM.
 * Returns a colon-separated string suitable for direct DB storage.
 *
 * @param plaintext  The raw client secret string from the tenant admin.
 * @param keyHex     64 hex characters (32 bytes) from OAUTH_SECRET_ENCRYPTION_KEY.
 */
export function encryptClientSecret(plaintext: string, keyHex: string): string {
  const key = parseKey(keyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

// ---------------------------------------------------------------------------
// Decryption
// ---------------------------------------------------------------------------

/**
 * Decrypt a stored OAuth client secret. Throws if the ciphertext is
 * malformed, has been tampered with, or was encrypted with a different key.
 *
 * @param stored   The `iv:tag:ciphertext` string from the DB.
 * @param keyHex   64 hex characters (32 bytes) from OAUTH_SECRET_ENCRYPTION_KEY.
 */
export function decryptClientSecret(stored: string, keyHex: string): string {
  const parts = stored.split(':');
  if (parts.length !== 3) {
    throw new Error('OAuth client secret has wrong format (expected iv:tag:ciphertext)');
  }
  const [ivHex, tagHex, ctHex] = parts;
  const key = parseKey(keyHex);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex!, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex!, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ctHex!, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function parseKey(keyHex: string): Buffer {
  const buf = Buffer.from(keyHex, 'hex');
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `OAUTH_SECRET_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${buf.length}`,
    );
  }
  return buf;
}
