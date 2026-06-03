// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * OAuth state helpers — generate and verify signed state cookies.
 *
 * During an OAuth login flow we need to:
 *   1. Remember the PKCE code verifier between the login redirect and callback.
 *   2. Prevent CSRF (verify state parameter was issued by us).
 *   3. Optionally carry metadata: which org this login belongs to, where to
 *      redirect after login, etc.
 *
 * Approach: short-lived httpOnly cookie `inv_oauth_state` containing a
 * JSON payload signed with HMAC-SHA256. No server-side session store needed.
 *
 * Cookie is set on login, read + cleared on callback.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface OAuthStatePayload {
  /** Random CSRF token — must match query param `state` returned by provider. */
  state: string;
  /** PKCE code verifier — stored here so callback can complete the exchange. */
  codeVerifier: string;
  /** Which provider initiated this flow. */
  provider: 'google' | 'microsoft' | 'apple';
  /** Optional: redirect destination after successful auth. */
  redirectAfter?: string;
  /** Optional: pending org registration data (from /register page). */
  pendingOrg?: {
    name: string;
    contactEmail: string;
    ico?: string;
    dpaAcceptedAt: string;
  };
  /**
   * Optional: invite token for the invite-accept OAuth path (K18.3).
   * When present, the callback resolves the pending invite user by this
   * token instead of creating a new user or requiring a pendingOrg.
   */
  invitationToken?: string;
  /** Unix timestamp when the state was issued (for TTL check). */
  issuedAt: number;
}

const STATE_COOKIE = 'inv_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export function generateOAuthState(
  payload: Omit<OAuthStatePayload, 'state' | 'codeVerifier' | 'issuedAt'>,
): OAuthStatePayload {
  return {
    ...payload,
    state: randomBytes(16).toString('hex'),
    codeVerifier: randomBytes(32).toString('base64url'),
    issuedAt: Date.now(),
  };
}

/**
 * Serialize + sign the state payload into a cookie value.
 * Format: `<base64url(json)>.<hmac-hex>`
 */
export function serializeOAuthState(payload: OAuthStatePayload, secret: string): string {
  const json = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = signState(json, secret);
  return `${json}.${sig}`;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export class OAuthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthStateError';
  }
}

/**
 * Parse, verify signature, check TTL, and return the payload.
 * Throws `OAuthStateError` on any failure.
 */
export function verifyOAuthState(cookieValue: string, secret: string): OAuthStatePayload {
  const dotIndex = cookieValue.lastIndexOf('.');
  if (dotIndex === -1) throw new OAuthStateError('Malformed state cookie');

  const json = cookieValue.slice(0, dotIndex);
  const sig = cookieValue.slice(dotIndex + 1);

  // Constant-time HMAC comparison
  const expected = signState(json, secret);
  try {
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new OAuthStateError('State signature mismatch');
    }
  } catch {
    throw new OAuthStateError('State signature mismatch');
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(json, 'base64url').toString('utf-8')) as OAuthStatePayload;
  } catch {
    throw new OAuthStateError('Malformed state JSON');
  }

  if (Date.now() - payload.issuedAt > STATE_TTL_MS) {
    throw new OAuthStateError('OAuth state has expired');
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

export const OAUTH_STATE_COOKIE = STATE_COOKIE;

export function oauthStateCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    path: '/v1/auth',
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function signState(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}
