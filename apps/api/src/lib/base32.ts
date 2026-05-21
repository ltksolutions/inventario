// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Base32 encoder/decoder per RFC 4648.
 *
 * TOTP secrets are base32-encoded by convention (Google Authenticator,
 * Authy, 1Password all expect base32). Node's built-in Buffer doesn't
 * support base32, so we implement it ourselves — ~30 lines.
 *
 * Used by `totp.ts` for secret generation and by the otpauth:// URL
 * (which embeds the secret as base32).
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const REVERSE: Record<string, number> = Object.fromEntries(
  ALPHABET.split('').map((c, i) => [c, i]),
);

/** Encode raw bytes to a base32 string (no padding). */
export function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return output;
}

/** Decode a base32 string to raw bytes. Throws on invalid input. */
export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of cleaned) {
    const idx = REVERSE[char];
    if (idx === undefined) {
      throw new Error(`Invalid base32 character: ${char}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}
