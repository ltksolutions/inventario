// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * TOTP (Time-based One-Time Password) — RFC 6238 implementation.
 *
 * Pure Node.js — uses `crypto.createHmac` and our own base32 codec
 * (lib/base32.ts). No external dependencies. The algorithm is
 * well-specified and ~40 lines, so writing it ourselves avoids
 * pulling in @otplib (which has its own minor dependency chain).
 *
 * Defaults match Google Authenticator / Authy:
 *   - Algorithm: SHA-1
 *   - Digits:    6
 *   - Period:    30 seconds
 *   - Secret:    20 bytes (160 bits) of entropy, base32-encoded
 *
 * Used by `mfa.routes.ts`:
 *   - `generateTotpSecret()` for new MFA setup
 *   - `verifyTotpCode()` for setup confirmation and login challenge
 *   - `buildOtpauthUrl()` for the QR code shown to the user
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { base32Decode, base32Encode } from './base32.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PERIOD_SECONDS = 30;
const DIGITS = 6;
const SECRET_BYTES = 20;
/**
 * Verification window — accept codes from the previous and next time
 * step in addition to the current one. Covers small clock skew between
 * server and user device. ±1 step = ±30s tolerance.
 */
const WINDOW = 1;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a fresh TOTP secret (20 random bytes), base32-encoded.
 * The returned string is what the user pastes / scans into their
 * authenticator app, and what `verifyTotpCode` expects as input.
 */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/**
 * Build an `otpauth://` URL that can be rendered as a QR code in the
 * frontend. Format per Google's Key Uri specification:
 *   otpauth://totp/<issuer>:<account>?secret=<base32>&issuer=<issuer>
 *
 * The frontend renders this URL via a QR library (e.g. `qrcode-svg`
 * inside the browser, or by passing the URL to an external QR API).
 */
export function buildOtpauthUrl(opts: {
  /** App name shown in the authenticator (e.g. "Inventario"). */
  issuer: string;
  /** Account label, typically the user's email. */
  accountName: string;
  /** Base32 secret from `generateTotpSecret()`. */
  secret: string;
}): string {
  const issuer = encodeURIComponent(opts.issuer);
  const account = encodeURIComponent(opts.accountName);
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${issuer}:${account}?${params.toString()}`;
}

/**
 * Verify a 6-digit TOTP code against a base32 secret.
 *
 * Returns true if the code matches the current 30s window OR the
 * adjacent windows (±30s tolerance for clock skew). Comparison is
 * constant-time to prevent timing oracle attacks.
 *
 * @param code   The 6-digit numeric code the user typed.
 * @param secret The base32 secret stored for that user (decrypted).
 * @param now    Optional Unix-time-seconds override (for testing).
 */
export function verifyTotpCode(code: string, secret: string, now?: number): boolean {
  if (!/^\d{6}$/.test(code)) return false;

  const currentStep = Math.floor((now ?? Date.now() / 1000) / PERIOD_SECONDS);
  const secretBuf = base32Decode(secret);

  for (let offset = -WINDOW; offset <= WINDOW; offset++) {
    const expected = generateCodeAtStep(secretBuf, currentStep + offset);
    if (constantTimeEqualStrings(code, expected)) {
      return true;
    }
  }
  return false;
}

/**
 * Generate the TOTP code for the CURRENT time step. Exposed only for
 * tests that need to compute the expected code; production code paths
 * always go through `verifyTotpCode`.
 */
export function generateCodeForTesting(secret: string, now?: number): string {
  const currentStep = Math.floor((now ?? Date.now() / 1000) / PERIOD_SECONDS);
  return generateCodeAtStep(base32Decode(secret), currentStep);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Core HOTP/TOTP code generation for a given counter value.
 * RFC 6238 §4.2 with SHA-1.
 */
function generateCodeAtStep(secret: Buffer, step: number): string {
  // 8-byte big-endian counter
  const counter = Buffer.alloc(8);
  // Node Buffer doesn't have writeBigUInt64BE on a number — use bigint.
  counter.writeBigUInt64BE(BigInt(step));

  const hmac = createHmac('sha1', secret).update(counter).digest();

  // Dynamic truncation (RFC 4226 §5.3)
  const lastByte = hmac[hmac.length - 1];
  if (lastByte === undefined) {
    throw new Error('TOTP: HMAC output unexpectedly empty');
  }
  const offset = lastByte & 0x0f;
  const slice = hmac.subarray(offset, offset + 4);
  const b0 = slice[0];
  const b1 = slice[1];
  const b2 = slice[2];
  const b3 = slice[3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
    throw new Error('TOTP: HMAC slice out of bounds');
  }
  const binCode = ((b0 & 0x7f) << 24) | (b1 << 16) | (b2 << 8) | b3;

  const code = binCode % 10 ** DIGITS;
  return code.toString().padStart(DIGITS, '0');
}

/** Constant-time string compare to avoid timing attacks on code verification. */
function constantTimeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  return timingSafeEqual(aBuf, bBuf);
}
