// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * MFA crypto helpers — encrypt TOTP secrets at rest + generate
 * argon2id-hashed recovery codes.
 *
 * Why encrypt the TOTP secret?
 *   If a DB dump leaks, plaintext TOTP secrets allow an attacker to
 *   bypass MFA on every account. By encrypting them with a key kept
 *   in env-only (`MFA_SECRET_ENCRYPTION_KEY`), a DB-only compromise
 *   is insufficient. The attacker would also need the server's env.
 *   Argon2id on the password complements this: app server + DB
 *   compromise is still required to forge passwords.
 *
 * Encryption: AES-256-GCM
 *   - Key:   32 bytes from `MFA_SECRET_ENCRYPTION_KEY` (hex-decoded)
 *   - IV:    12 random bytes per encryption
 *   - Auth:  16-byte GCM tag, prevents tampering
 *   - Format on disk: `<iv-hex>:<tag-hex>:<ciphertext-hex>`
 *
 * Recovery codes:
 *   - 8 codes, 10 chars each, format XXXX-XXXX (uppercase alphanum)
 *   - Plaintext returned ONCE during MFA setup (user must save them)
 *   - Stored as argon2id hashes (same params as passwords)
 *   - Verified one-at-a-time during challenge; consumed = removed
 *     from the user's array
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import argon2 from 'argon2';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const RECOVERY_CODE_COUNT = 8;
/** Code character set — uppercase alphanumeric without easily confused chars (0/O, 1/I/L). */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// ---------------------------------------------------------------------------
// TOTP secret encryption
// ---------------------------------------------------------------------------

/**
 * Encrypt a base32 TOTP secret with AES-256-GCM.
 * Returns a colon-separated string suitable for direct DB storage.
 */
export function encryptMfaSecret(plaintext: string, keyHex: string): string {
  const key = parseKey(keyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * Decrypt a stored MFA secret. Throws if the ciphertext is malformed,
 * has been tampered with, or was encrypted with a different key.
 */
export function decryptMfaSecret(stored: string, keyHex: string): string {
  const parts = stored.split(':');
  if (parts.length !== 3) {
    throw new Error('MFA secret has wrong format (expected iv:tag:ciphertext)');
  }
  const [ivHex, tagHex, ctHex] = parts;
  const key = parseKey(keyHex);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex!, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex!, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ctHex!, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

/**
 * Generate fresh recovery codes (plaintext) and their argon2id hashes.
 * The plaintext array is returned ONCE to the user during MFA setup;
 * only the hashes are stored. Plaintext is never persisted.
 *
 * Format: `XXXX-XXXX` (8 chars with a dash for readability).
 */
export async function generateRecoveryCodes(): Promise<{
  plaintext: string[];
  hashes: string[];
}> {
  const plaintext: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    plaintext.push(generateOneCode());
  }
  const hashes = await Promise.all(plaintext.map((code) => argon2.hash(code, ARGON2_OPTS)));
  return { plaintext, hashes };
}

/**
 * Try every stored recovery hash against the user-supplied code.
 * Returns the matching hash (so the caller can remove it from the
 * user's `mfaRecoveryCodes` array) or null on no match.
 */
export async function findMatchingRecoveryHash(
  code: string,
  storedHashes: readonly string[],
): Promise<string | null> {
  const normalized = code.toUpperCase().replace(/\s+/g, '');
  for (const hash of storedHashes) {
    try {
      const ok = await argon2.verify(hash, normalized);
      if (ok) return hash;
    } catch {
      // Malformed hash — skip, try next.
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
} as const;

function parseKey(keyHex: string): Buffer {
  const buf = Buffer.from(keyHex, 'hex');
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `MFA_SECRET_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${buf.length}`,
    );
  }
  return buf;
}

function generateOneCode(): string {
  const part1 = randomChars(4);
  const part2 = randomChars(4);
  return `${part1}-${part2}`;
}

function randomChars(count: number): string {
  const bytes = randomBytes(count);
  let out = '';
  for (let i = 0; i < count; i++) {
    out += RECOVERY_ALPHABET[bytes[i]! % RECOVERY_ALPHABET.length];
  }
  return out;
}
