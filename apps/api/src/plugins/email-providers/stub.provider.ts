// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Console stub provider — logs would-be-sent emails instead of delivering.
 *
 * Used when EMAIL_PROVIDER=stub (dev/test default). The logged structure
 * includes recipient, subject, and any URLs from the body so developers
 * can copy-paste verification / reset links during local development.
 *
 * Production guard: server.ts logs a warning at boot if NODE_ENV=production
 * and EMAIL_PROVIDER=stub — emails would silently disappear.
 */

import type { EmailProvider, EmailSendInput, ProviderContext } from './types.js';

export function createStubProvider(ctx: ProviderContext): EmailProvider {
  const { logger } = ctx;

  return {
    name: 'stub',
    isConfigured: true,

    async send(input: EmailSendInput): Promise<void> {
      // Extract first URL from HTML so verification links are easy to grab.
      const urlMatch = input.html.match(/https?:\/\/[^\s"'<>]+/);
      logger.info(
        {
          to: input.to,
          subject: input.subject,
          firstUrl: urlMatch?.[0],
        },
        '[EMAIL-STUB] Would send email',
      );
      return Promise.resolve();
    },
  };
}
