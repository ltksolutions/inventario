// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Unit tests for OAuth state helpers (K3 ADR-0013).
 *
 * Tests serialization + verification round-trip, TTL expiry, signature
 * mismatch, and malformed input — no database or Fastify app needed.
 */

import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  OAuthStateError,
  generateOAuthState,
  serializeOAuthState,
  verifyOAuthState,
} from '../../src/modules/auth/oauth-state.js';

const SECRET = 'test-secret-for-unit-tests-only';

// ---------------------------------------------------------------------------
// generateOAuthState
// ---------------------------------------------------------------------------

describe('generateOAuthState', () => {
  it('returns a payload with state, codeVerifier, and issuedAt', () => {
    const before = Date.now();
    const payload = generateOAuthState({ provider: 'google' });
    const after = Date.now();

    expect(payload.provider).toBe('google');
    expect(payload.state).toMatch(/^[0-9a-f]{32}$/); // 16 bytes hex
    expect(payload.codeVerifier).toBeTruthy(); // base64url
    expect(payload.issuedAt).toBeGreaterThanOrEqual(before);
    expect(payload.issuedAt).toBeLessThanOrEqual(after);
  });

  it('includes optional fields when provided', () => {
    const payload = generateOAuthState({
      provider: 'microsoft',
      redirectAfter: '/dashboard',
      pendingOrg: {
        name: 'Acme',
        contactEmail: 'admin@acme.sk',
        dpaAcceptedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(payload.redirectAfter).toBe('/dashboard');
    expect(payload.pendingOrg?.name).toBe('Acme');
    expect(payload.pendingOrg?.contactEmail).toBe('admin@acme.sk');
  });

  it('generates unique state values on each call', () => {
    const a = generateOAuthState({ provider: 'google' });
    const b = generateOAuthState({ provider: 'google' });
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

// ---------------------------------------------------------------------------
// serialize + verify round-trip
// ---------------------------------------------------------------------------

describe('serializeOAuthState + verifyOAuthState round-trip', () => {
  it('verifies a freshly generated state', () => {
    const original = generateOAuthState({ provider: 'google', redirectAfter: '/home' });
    const cookie = serializeOAuthState(original, SECRET);
    const verified = verifyOAuthState(cookie, SECRET);

    expect(verified.state).toBe(original.state);
    expect(verified.codeVerifier).toBe(original.codeVerifier);
    expect(verified.provider).toBe('google');
    expect(verified.redirectAfter).toBe('/home');
    expect(verified.issuedAt).toBe(original.issuedAt);
  });

  it('preserves pendingOrg through the round-trip', () => {
    const original = generateOAuthState({
      provider: 'microsoft',
      pendingOrg: {
        name: 'Test Org',
        contactEmail: 'contact@test.sk',
        ico: '12345678',
        dpaAcceptedAt: '2026-05-01T10:00:00.000Z',
      },
    });
    const cookie = serializeOAuthState(original, SECRET);
    const verified = verifyOAuthState(cookie, SECRET);

    expect(verified.pendingOrg?.name).toBe('Test Org');
    expect(verified.pendingOrg?.ico).toBe('12345678');
    expect(verified.pendingOrg?.dpaAcceptedAt).toBe('2026-05-01T10:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// verifyOAuthState — rejection cases
// ---------------------------------------------------------------------------

describe('verifyOAuthState — rejection cases', () => {
  it('throws OAuthStateError for a cookie with wrong secret', () => {
    const payload = generateOAuthState({ provider: 'google' });
    const cookie = serializeOAuthState(payload, 'correct-secret');

    expect(() => verifyOAuthState(cookie, 'wrong-secret')).toThrow(OAuthStateError);
    expect(() => verifyOAuthState(cookie, 'wrong-secret')).toThrow(/mismatch/i);
  });

  it('throws OAuthStateError for a tampered payload', () => {
    const payload = generateOAuthState({ provider: 'google' });
    const cookie = serializeOAuthState(payload, SECRET);

    // Flip one base64url char in the payload part (before the dot)
    const dotIndex = cookie.lastIndexOf('.');
    const tamperedPayload = cookie.slice(0, dotIndex - 1) + 'X' + '.' + cookie.slice(dotIndex + 1);

    expect(() => verifyOAuthState(tamperedPayload, SECRET)).toThrow(OAuthStateError);
  });

  it('throws OAuthStateError for a malformed cookie (no dot)', () => {
    expect(() => verifyOAuthState('no-dot-here', SECRET)).toThrow(OAuthStateError);
    expect(() => verifyOAuthState('no-dot-here', SECRET)).toThrow(/malformed/i);
  });

  it('throws OAuthStateError for expired state (TTL 10 min)', () => {
    // Manually craft a payload with issuedAt 11 minutes ago
    const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
    const payload = generateOAuthState({ provider: 'google' });
    const expired = { ...payload, issuedAt: elevenMinutesAgo };

    const cookie = serializeOAuthState(expired, SECRET);
    expect(() => verifyOAuthState(cookie, SECRET)).toThrow(OAuthStateError);
    expect(() => verifyOAuthState(cookie, SECRET)).toThrow(/expired/i);
  });

  it('accepts state issued just under 10 minutes ago', () => {
    const nineMinutesAgo = Date.now() - 9 * 60 * 1000;
    const payload = generateOAuthState({ provider: 'google' });
    const fresh = { ...payload, issuedAt: nineMinutesAgo };
    const cookie = serializeOAuthState(fresh, SECRET);

    // Should NOT throw
    expect(() => verifyOAuthState(cookie, SECRET)).not.toThrow();
  });

  it('throws OAuthStateError for invalid JSON in payload', () => {
    // Build a cookie with a valid HMAC but broken JSON
    const brokenJson = Buffer.from('not-valid-json').toString('base64url');
    const sig = createHmac('sha256', SECRET).update(brokenJson).digest('hex');
    const cookie = `${brokenJson}.${sig}`;

    expect(() => verifyOAuthState(cookie, SECRET)).toThrow(OAuthStateError);
    expect(() => verifyOAuthState(cookie, SECRET)).toThrow(/malformed.*json/i);
  });
});
