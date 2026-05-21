// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Resend.com email provider.
 *
 * Docs: https://resend.com/docs/api-reference/emails/send-email
 *
 * Endpoint: POST https://api.resend.com/emails
 * Auth:     header `Authorization: Bearer re_<key>`
 * Body shape (relevant subset):
 *   {
 *     "from":    "Name <user@domain.com>",
 *     "to":      ["recipient@example.com"],
 *     "subject": "...",
 *     "html":    "...",
 *     "text":    "...",
 *     "reply_to": ["..."]    (optional)
 *   }
 *
 * Why direct fetch (no SDK): the `resend` npm package pulls in extra
 * dependencies for retry/streaming features we don't need for one
 * endpoint. Native `fetch` keeps the API package lean.
 */

import type { EmailProvider, EmailSendInput, ProviderContext } from './types.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const TIMEOUT_MS = 10_000;

export interface ResendProviderOptions extends ProviderContext {
  apiKey: string;
}

export function createResendProvider(opts: ResendProviderOptions): EmailProvider {
  const { apiKey, fromAddress, fromName, replyTo, logger } = opts;

  // Resend wants "From: Name <addr>" as a single string.
  const fromHeader = `${fromName} <${fromAddress}>`;

  return {
    name: 'resend',
    isConfigured: true,

    async send(input: EmailSendInput): Promise<void> {
      const body = {
        from: fromHeader,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(replyTo ? { reply_to: [replyTo] } : {}),
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(RESEND_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timeout);
        logger.error({ err, to: input.to }, 'Resend send failed (network error)');
        throw new Error(`Resend send failed: ${(err as Error).message}`);
      }
      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await safeReadBody(response);
        logger.error(
          { status: response.status, body: errText, to: input.to },
          'Resend send failed (non-2xx)',
        );
        throw new Error(`Resend send failed: HTTP ${response.status} — ${errText}`);
      }

      logger.info({ to: input.to, subject: input.subject }, 'Resend send ok');
    },
  };
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 500 ? `${text.slice(0, 500)}…` : text;
  } catch {
    return '(failed to read response body)';
  }
}
