// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * PasskeyCredential schema — WebAuthn/FIDO2 credential viazaný na globálnu
 * identitu Usera (nie na tenant).
 *
 * Per ADR-0016: passkey je GLOBÁLNY identity factor (žiadne OrganisationScopedSchema).
 * Jeden passkey funguje naprieč všetkými tenantmi kde má user aktívnu membership.
 * Po úspešnom login server resolveuje default Membership a vydá JWT s tym tenantom.
 */

import { z } from 'zod';

import { BaseDocumentSchema, ObjectIdSchema, SoftDeleteSchema, TimestampSchema } from './common.js';

export const PasskeyCredentialSchema = BaseDocumentSchema.merge(SoftDeleteSchema).extend({
  /** Vlastník passkey. Index pre rýchlu otázku "list my passkeys". */
  userId: ObjectIdSchema,

  /**
   * WebAuthn credential ID — base64url-encoded. Globálne unikátne.
   * Unique index v DB (credentialId: 1).
   */
  credentialId: z.string().min(16).max(1023),

  /**
   * WebAuthn public key — base64url COSE encoded.
   * NIKDY sa nemení po insertne (immutable).
   */
  publicKey: z.string().min(1),

  /**
   * Signature counter. Authenticator ho inkrementuje pri každom použití.
   * Synced platform passkeys (iCloud Keychain, Google PW Manager) ho
   * neinkrementujú spoľahlivo — logujeme warning, neblokujeme (ADR-0016).
   */
  counter: z.number().int().nonnegative().default(0),

  /** WebAuthn transports advertised authenticatorom pri registrácii. */
  transports: z
    .array(z.enum(['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card']))
    .default([]),

  /** Či je credential backup-eligible (synced cez user's devices). */
  backupEligible: z.boolean().default(false),

  /** Či je credential momentálne backed up (synced). */
  backedUp: z.boolean().default(false),

  /** Attachment hint z registrácie. */
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).nullable().default(null),

  /**
   * User-provided meno. Default: best-effort z User-Agent pri registrácii.
   * Editovateľné cez PATCH /v1/auth/passkeys/:id.
   * Príklady: "MacBook Air", "iPhone 15 Pro", "YubiKey 5C".
   */
  deviceName: z.string().min(1).max(100),

  /** Posledné úspešné prihlásenie cez tento credential. */
  lastUsedAt: TimestampSchema.nullable().default(null),
});

export type PasskeyCredential = z.infer<typeof PasskeyCredentialSchema>;

/** Výstup pre API response — bez internals (publicKey, counter). */
export const PasskeyPublicSchema = PasskeyCredentialSchema.pick({
  _id: true,
  deviceName: true,
  transports: true,
  backedUp: true,
  authenticatorAttachment: true,
  createdAt: true,
  lastUsedAt: true,
});

export type PasskeyPublic = z.infer<typeof PasskeyPublicSchema>;
