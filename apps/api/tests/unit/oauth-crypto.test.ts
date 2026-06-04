// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { describe, expect, it } from 'vitest';

import { decryptClientSecret, encryptClientSecret } from '../../src/lib/oauth-crypto.js';

const TEST_KEY = 'a'.repeat(64); // 32 bytes of 0xAA

describe('oauth-crypto', () => {
  it('encrypt + decrypt round-trip', () => {
    const plaintext = 'super-secret-client-secret-value';
    const encrypted = encryptClientSecret(plaintext, TEST_KEY);
    const decrypted = decryptClientSecret(encrypted, TEST_KEY);
    expect(decrypted).toBe(plaintext);
  });

  it('encrypted format is iv:tag:ciphertext (3 colon-separated parts)', () => {
    const encrypted = encryptClientSecret('test', TEST_KEY);
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveLength(24); // 12 bytes IV = 24 hex chars
    expect(parts[1]).toHaveLength(32); // 16 bytes GCM tag = 32 hex chars
  });

  it('each encryption produces a different ciphertext (random IV)', () => {
    const plaintext = 'same-secret';
    const enc1 = encryptClientSecret(plaintext, TEST_KEY);
    const enc2 = encryptClientSecret(plaintext, TEST_KEY);
    expect(enc1).not.toBe(enc2);
  });

  it('decryption with wrong key throws', () => {
    const encrypted = encryptClientSecret('secret', TEST_KEY);
    const wrongKey = 'b'.repeat(64);
    expect(() => decryptClientSecret(encrypted, wrongKey)).toThrow();
  });

  it('decryption of tampered ciphertext throws', () => {
    const encrypted = encryptClientSecret('secret', TEST_KEY);
    const parts = encrypted.split(':');
    // Flip the last ciphertext char to a guaranteed-different hex digit.
    // (Naive "replace with 'f'" is flaky: if the char already is 'f' the
    //  string is unchanged and the GCM tag still validates ~1/16 of runs.)
    const ct = parts[2]!;
    const lastChar = ct.slice(-1);
    const flipped = lastChar === '0' ? '1' : '0';
    const tampered = `${parts[0]}:${parts[1]}:${ct.slice(0, -1)}${flipped}`;
    expect(() => decryptClientSecret(tampered, TEST_KEY)).toThrow();
  });

  it('decryption of malformed string throws', () => {
    expect(() => decryptClientSecret('not-valid', TEST_KEY)).toThrow(/wrong format/);
  });

  it('rejects key that is not 64 hex chars', () => {
    expect(() => encryptClientSecret('secret', 'tooshort')).toThrow(/bytes/);
    expect(() => decryptClientSecret('a:b:c', 'tooshort')).toThrow(/bytes/);
  });

  it('handles empty string plaintext', () => {
    const encrypted = encryptClientSecret('', TEST_KEY);
    const decrypted = decryptClientSecret(encrypted, TEST_KEY);
    expect(decrypted).toBe('');
  });

  it('handles long secret (real-world client secret length)', () => {
    const longSecret = 'x'.repeat(200);
    const encrypted = encryptClientSecret(longSecret, TEST_KEY);
    const decrypted = decryptClientSecret(encrypted, TEST_KEY);
    expect(decrypted).toBe(longSecret);
  });
});
