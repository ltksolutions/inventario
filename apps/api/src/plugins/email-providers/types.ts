// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * EmailProvider — transport-level abstraction.
 *
 * Implementations (Ecomail.cz, Resend.com, stub) handle ONLY the network
 * call to deliver a fully-rendered message. Templating, branding, and
 * subject/body composition stay in `email.ts`.
 *
 * Slice #6c K17.5 introduces this abstraction so we can swap providers
 * via `EMAIL_PROVIDER` env var without touching call sites.
 */

import type { FastifyBaseLogger } from 'fastify';

export interface EmailSendInput {
  /** Recipient address (one for now; CC/BCC future). */
  to: string;
  /** Optional recipient display name. */
  toName?: string;
  /** Subject line. */
  subject: string;
  /** HTML body. Required. */
  html: string;
  /** Plain-text fallback. Recommended for deliverability. */
  text?: string;
}

export interface EmailProvider {
  /** Stable identifier used in logs ('ecomail' | 'resend' | 'stub'). */
  readonly name: 'ecomail' | 'resend' | 'stub';
  /** Whether this provider is configured and ready to deliver. */
  readonly isConfigured: boolean;
  /**
   * Deliver a fully-rendered message. Implementations should THROW on
   * provider error so the caller can decide whether to retry or surface
   * the failure. The `email.ts` plugin currently logs and swallows; that
   * keeps auth flows resilient if the provider is temporarily down.
   */
  send(input: EmailSendInput): Promise<void>;
}

/**
 * Common fields every provider receives from the email plugin.
 */
export interface ProviderContext {
  fromAddress: string;
  fromName: string;
  replyTo: string | undefined;
  logger: FastifyBaseLogger;
}
