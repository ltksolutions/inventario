// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Ecomail.cz transactional email provider.
 *
 * Docs: https://docs.ecomail.cz/api-reference/transactional/send-message
 *
 * Endpoint: POST https://api2.ecomailapp.cz/transactional/send-message
 * Auth:     header `key: <API_KEY>`
 * Body shape (relevant subset):
 *   {
 *     "message": {
 *       "subject":     "...",   (required)
 *       "from_name":   "...",   (required)
 *       "from_email":  "...",   (required)
 *       "reply_to":    "...",   (optional)
 *       "to":          [{ "email": "...", "name": "..." }],   (required)
 *       "html":        "...",   (required without text)
 *       "text":        "...",   (required without html)
 *       "options": { "click_tracking": bool, "open_tracking": bool }
 *     }
 *   }
 *
 * Tracking: we DISABLE click + open tracking for system emails. These
 * are transactional auth flows (verify, reset, invite) — adding tracking
 * pixels would (a) leak user activity to Ecomail unnecessarily and (b)
 * potentially break the auth link rewrite. Marketing emails (when we
 * add them) can opt back in.
 */

import type { EmailProvider, EmailSendInput, ProviderContext } from './types.js';

const ECOMAIL_ENDPOINT = 'https://api2.ecomailapp.cz/transactional/send-message';

/** Network timeout — Ecomail is generally fast but we don't want auth flows hanging. */
const TIMEOUT_MS = 10_000;

export interface EcomailProviderOptions extends ProviderContext {
  apiKey: string;
}

export function createEcomailProvider(opts: EcomailProviderOptions): EmailProvider {
  const { apiKey, fromAddress, fromName, replyTo, logger } = opts;

  return {
    name: 'ecomail',
    isConfigured: true,

    async send(input: EmailSendInput): Promise<void> {
      const body = {
        message: {
          subject: input.subject,
          from_name: fromName,
          from_email: fromAddress,
          ...(replyTo ? { reply_to: replyTo } : {}),
          to: [{ email: input.to, ...(input.toName ? { name: input.toName } : {}) }],
          html: input.html,
          ...(input.text ? { text: input.text } : {}),
          options: { click_tracking: false, open_tracking: false },
        },
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(ECOMAIL_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            key: apiKey,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timeout);
        logger.error({ err, to: input.to }, 'Ecomail send failed (network error)');
        throw new Error(`Ecomail send failed: ${(err as Error).message}`);
      }
      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await safeReadBody(response);
        logger.error(
          { status: response.status, body: errText, to: input.to },
          'Ecomail send failed (non-2xx)',
        );
        throw new Error(`Ecomail send failed: HTTP ${response.status} — ${errText}`);
      }

      logger.info({ to: input.to, subject: input.subject }, 'Ecomail send ok');
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
