// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * WebAuthn / Passkeys browser helpers — ADR-0016, Slice #8 K10.
 *
 * Thin wrappers okolo @simplewebauthn/browser s capability detection
 * a SK-localized error messages.
 */

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

export const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Capability detection
// ---------------------------------------------------------------------------

/** Či browser podporuje WebAuthn API vôbec. */
export function isPasskeysSupported(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential;
}

/** Či browser podporuje Conditional UI (autofill / mediation: 'conditional'). */
export async function isConditionalUISupported(): Promise<boolean> {
  if (!isPasskeysSupported()) return false;
  if (typeof window.PublicKeyCredential.isConditionalMediationAvailable !== 'function') {
    return false;
  }
  try {
    return await window.PublicKeyCredential.isConditionalMediationAvailable();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Device name autodetekcia z User-Agent
// ---------------------------------------------------------------------------

export function getDeviceNameFromUA(): string {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac';
  if (/Android/i.test(ua)) return 'Android zariadenie';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Linux/i.test(ua)) return 'Linux PC';
  return 'Passkey';
}

// ---------------------------------------------------------------------------
// Error handling — WebAuthn DOM errors → SK messages
// ---------------------------------------------------------------------------

export function webauthnErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Nastala neočakávaná chyba.';
  const name = err.name;
  switch (name) {
    case 'NotAllowedError':
      return 'Registrácia bola zrušená alebo vypršal časový limit.';
    case 'InvalidStateError':
      return 'Tento authenticator je už zaregistrovaný. Použite iné zariadenie.';
    case 'NotSupportedError':
      return 'Váš prehliadač nepodporuje passkey. Aktualizujte prehliadač alebo použite iné zariadenie.';
    case 'SecurityError':
      return 'Chyba bezpečnostných parametrov. Kontaktujte podporu.';
    case 'AbortError':
      return 'Operácia bola zrušená.';
    default:
      return err.message || 'Nastala neočakávaná chyba passkey.';
  }
}

// ---------------------------------------------------------------------------
// Registration flow
// ---------------------------------------------------------------------------

export interface RegisterPasskeyResult {
  success: true;
  passkey: {
    _id: string;
    deviceName: string;
    backedUp: boolean;
    transports: string[];
    createdAt: string;
  };
}

export async function registerPasskey(deviceName?: string): Promise<RegisterPasskeyResult> {
  // 1. Get options from server
  const optionsRes = await fetch(`${API_BASE}/v1/auth/passkeys/register/options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  });
  if (!optionsRes.ok) {
    const body = (await optionsRes.json()) as { message?: string };
    throw new Error(body.message ?? 'Nepodarilo sa získať parametre registrácie.');
  }
  const { options, challengeToken } = (await optionsRes.json()) as {
    options: PublicKeyCredentialCreationOptionsJSON;
    challengeToken: string;
  };

  // 2. Browser prompts user (biometric / PIN)
  const credential = await startRegistration({ optionsJSON: options });

  // 3. Verify with server
  const verifyRes = await fetch(`${API_BASE}/v1/auth/passkeys/register/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ credential, challengeToken, deviceName }),
  });
  if (!verifyRes.ok) {
    const body = (await verifyRes.json()) as { message?: string };
    throw new Error(body.message ?? 'Overenie passkey zlyhalo.');
  }
  return (await verifyRes.json()) as RegisterPasskeyResult;
}

// ---------------------------------------------------------------------------
// Authentication flow
// ---------------------------------------------------------------------------

export interface AuthenticatePasskeyResult {
  success: true;
}

export async function authenticateWithPasskey(
  email?: string,
  mediation?: 'conditional' | 'required' | 'optional' | 'silent',
): Promise<void> {
  // 1. Get options from server
  const optionsRes = await fetch(`${API_BASE}/v1/auth/passkeys/login/options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(email ? { email } : {}),
  });
  if (!optionsRes.ok) {
    const body = (await optionsRes.json()) as { message?: string };
    throw new Error(body.message ?? 'Nepodarilo sa získať parametre prihlásenia.');
  }
  const { options, challengeToken } = (await optionsRes.json()) as {
    options: PublicKeyCredentialRequestOptionsJSON;
    challengeToken: string;
  };

  // 2. Browser prompts user
  const credential = await startAuthentication({
    optionsJSON: options,
    useBrowserAutofill: mediation === 'conditional',
  });

  // 3. Verify with server
  const verifyRes = await fetch(`${API_BASE}/v1/auth/passkeys/login/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential, challengeToken }),
  });
  if (!verifyRes.ok) {
    const body = (await verifyRes.json()) as { message?: string };
    throw new Error(body.message ?? 'Overenie passkey zlyhalo.');
  }
}
