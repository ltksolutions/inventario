// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Synthetic WebAuthn attestation/assertion helpers — ADR-0016 §7 (Test strategy).
 *
 * Creates cryptographically valid (but ephemeral) P-256 ECDSA key pairs and
 * generates attestation/assertion objects matching @simplewebauthn/server's
 * expected input format.
 *
 * These helpers let us test the full passkey registration + authentication
 * flow without a real device or browser.
 *
 * Technique:
 *   1. Generate a P-256 ECDSA key pair in memory.
 *   2. Build authenticatorData + clientDataJSON that @simplewebauthn/server
 *      will accept (matching rpId, origin, challenge, flags).
 *   3. Sign the authenticatorData with the private key.
 *   4. Return objects shaped like AuthenticatorAttestationResponse /
 *      AuthenticatorAssertionResponse from the browser WebAuthn API.
 *
 * Limitations:
 *   - attestationObject uses fmt='none' (no attestation) which is exactly
 *     what production config requests.
 *   - We stub the CBOR encoding of the attestation object using a minimal
 *     hand-built CBOR map. This keeps us dependency-free (no cbor-x).
 *   - Counter starts at 1 and increments for each assertion.
 */

import { createHash, createSign, generateKeyPairSync } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyntheticAuthenticator {
  /** base64url-encoded credential ID (32 bytes) */
  credentialId: string;
  /** COSE public key (P-256 ECDSA) in base64url */
  publicKeyCose: string;
  /** Raw ECDSA private key (KeyObject) */
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
  /** Current counter value */
  counter: number;
}

// ---------------------------------------------------------------------------
// Create a synthetic authenticator
// ---------------------------------------------------------------------------

export function createSyntheticAuthenticator(): SyntheticAuthenticator {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

  // Build COSE-encoded public key (minimal map for P-256)
  // COSE Key: { 1: 2 (EC), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y }
  const rawPub = publicKey.export({ type: 'spki', format: 'der' });
  // SPKI for EC: last 65 bytes are 0x04 || x || y
  const uncompressed = rawPub.subarray(rawPub.length - 65);
  const x = uncompressed.subarray(1, 33);
  const y = uncompressed.subarray(33, 65);

  const coseKey = buildCoseKey(x, y);

  // 32-byte random credential ID
  const credentialIdBytes = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) credentialIdBytes[i] = Math.floor(Math.random() * 256);

  return {
    credentialId: credentialIdBytes.toString('base64url'),
    publicKeyCose: Buffer.from(coseKey).toString('base64url'),
    privateKey,
    counter: 0,
  };
}

// ---------------------------------------------------------------------------
// Make a synthetic registration response
// ---------------------------------------------------------------------------

export interface SyntheticAttestationOptions {
  authenticator: SyntheticAuthenticator;
  challenge: string; // base64url
  rpId: string;
  origin: string;
}

export function makeSyntheticAttestation(opts: SyntheticAttestationOptions): {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports: string[];
  };
  authenticatorAttachment: string;
  clientExtensionResults: Record<string, unknown>;
  type: 'public-key';
} {
  const { authenticator, challenge, rpId, origin } = opts;

  // clientDataJSON
  const clientData = {
    type: 'webauthn.create',
    challenge,
    origin,
    crossOrigin: false,
  };
  const clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');

  // authenticatorData for registration
  const rpIdHash = createHash('sha256').update(rpId).digest();
  const flags = Buffer.from([0x45]); // UP=1, UV=1, AT=1 (attestedCredData present)
  const signCount = Buffer.alloc(4); // 0

  const aaguid = Buffer.alloc(16); // zeros
  const credIdLen = Buffer.alloc(2);
  const credIdBytes = Buffer.from(authenticator.credentialId, 'base64url');
  credIdLen.writeUInt16BE(credIdBytes.length);
  const coseKeyBytes = Buffer.from(authenticator.publicKeyCose, 'base64url');

  const attestedCredData = Buffer.concat([aaguid, credIdLen, credIdBytes, coseKeyBytes]);
  const authData = Buffer.concat([rpIdHash, flags, signCount, attestedCredData]);

  // Minimal CBOR-encoded attestation object: { fmt: 'none', attStmt: {}, authData: bytes }
  const attestationObject = buildAttestationCbor(authData);

  return {
    id: authenticator.credentialId,
    rawId: authenticator.credentialId,
    response: {
      clientDataJSON,
      attestationObject: Buffer.from(attestationObject).toString('base64url'),
      transports: ['internal'],
    },
    authenticatorAttachment: 'platform',
    clientExtensionResults: {},
    type: 'public-key',
  };
}

// ---------------------------------------------------------------------------
// Make a synthetic authentication response
// ---------------------------------------------------------------------------

export interface SyntheticAssertionOptions {
  authenticator: SyntheticAuthenticator;
  challenge: string; // base64url
  rpId: string;
  origin: string;
  newCounter?: number; // defaults to authenticator.counter + 1
  userPresent?: boolean;
  userVerified?: boolean;
}

export function makeSyntheticAssertion(opts: SyntheticAssertionOptions): {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
  authenticatorAttachment: string;
  clientExtensionResults: Record<string, unknown>;
  type: 'public-key';
} {
  const {
    authenticator,
    challenge,
    rpId,
    origin,
    newCounter,
    userPresent = true,
    userVerified = true,
  } = opts;

  const counter = newCounter ?? authenticator.counter + 1;

  // clientDataJSON
  const clientData = {
    type: 'webauthn.get',
    challenge,
    origin,
    crossOrigin: false,
  };
  const clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');
  const clientDataHash = createHash('sha256')
    .update(Buffer.from(JSON.stringify(clientData)))
    .digest();

  // authenticatorData (no attested credential data for assertions)
  const rpIdHash = createHash('sha256').update(rpId).digest();
  let flagByte = 0x00;
  if (userPresent) flagByte |= 0x01;
  if (userVerified) flagByte |= 0x04;
  const flags = Buffer.from([flagByte]);
  const signCount = Buffer.alloc(4);
  signCount.writeUInt32BE(counter);

  const authData = Buffer.concat([rpIdHash, flags, signCount]);
  const authenticatorDataBase64 = authData.toString('base64url');

  // Signature: sign(authData || clientDataHash)
  const toSign = Buffer.concat([authData, clientDataHash]);
  const sign = createSign('SHA256');
  sign.update(toSign);
  const sigDer = sign.sign(authenticator.privateKey);

  return {
    id: authenticator.credentialId,
    rawId: authenticator.credentialId,
    response: {
      clientDataJSON,
      authenticatorData: authenticatorDataBase64,
      signature: Buffer.from(sigDer).toString('base64url'),
      userHandle: null,
    },
    authenticatorAttachment: 'platform',
    clientExtensionResults: {},
    type: 'public-key',
  };
}

// ---------------------------------------------------------------------------
// CBOR helpers (minimal, no external dependency)
// ---------------------------------------------------------------------------

/** Encode a small integer as CBOR major type 0 (unsigned int). */
function cborUint(n: number): Uint8Array {
  if (n <= 0x17) return new Uint8Array([n]);
  if (n <= 0xff) return new Uint8Array([0x18, n]);
  return new Uint8Array([0x19, (n >> 8) & 0xff, n & 0xff]);
}

/** Encode a negative integer as CBOR major type 1. */
function cborNegInt(n: number): Uint8Array {
  // n should be the absolute value minus 1 (e.g. -7 → 6)
  const val = -n - 1;
  if (val <= 0x17) return new Uint8Array([0x20 | val]);
  return new Uint8Array([0x38, val]);
}

/** Encode bytes as CBOR major type 2. */
function cborBytes(b: Uint8Array): Uint8Array {
  const len = cborUint(b.length);
  // Shift major type to 2 (0x40)
  len[0] = ((len[0] ?? 0) & 0x1f) | 0x40;
  return concat([len, b]);
}

/** Encode UTF-8 string as CBOR major type 3. */
function cborText(s: string): Uint8Array {
  const enc = new TextEncoder().encode(s);
  const len = cborUint(enc.length);
  len[0] = ((len[0] ?? 0) & 0x1f) | 0x60;
  return concat([len, enc]);
}

/** Encode a CBOR map header for N entries (major type 5). */
function cborMapHeader(n: number): Uint8Array {
  const h = cborUint(n);
  h[0] = ((h[0] ?? 0) & 0x1f) | 0xa0;
  return h;
}

function concat(arrays: Uint8Array[]): Uint8Array {
  const len = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

/** Build a minimal COSE_Key for P-256 EC. */
function buildCoseKey(x: Buffer, y: Buffer): Uint8Array {
  // Map of 5 entries: { 1: 2, 3: -7, -1: 1, -2: x, -3: y }
  // Note: cborNegInt expects the actual negative number (e.g. -7 not 7)
  return concat([
    cborMapHeader(5),
    cborUint(1),
    cborUint(2), // kty: EC2 (2)
    cborUint(3),
    cborNegInt(-7), // alg: ES256 (-7)
    cborNegInt(-1),
    cborUint(1), // crv: P-256 (1)
    cborNegInt(-2),
    cborBytes(x), // x coordinate
    cborNegInt(-3),
    cborBytes(y), // y coordinate
  ]);
}

/** Build a minimal CBOR attestation object with fmt='none'. */
function buildAttestationCbor(authData: Buffer): Uint8Array {
  // Map of 3 entries: { fmt: 'none', attStmt: {}, authData: bytes }
  const authDataCbor = cborBytes(authData);
  return concat([
    cborMapHeader(3),
    cborText('fmt'),
    cborText('none'),
    cborText('attStmt'),
    new Uint8Array([0xa0]), // empty map
    cborText('authData'),
    authDataCbor,
  ]);
}
