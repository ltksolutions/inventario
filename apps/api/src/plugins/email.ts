// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Email plugin — templating + provider selection.
 *
 * Slice #6c K17.5: nodemailer/SMTP replaced with provider abstraction.
 * Active provider is chosen via `EMAIL_PROVIDER` env var:
 *   - 'ecomail' → Ecomail.cz transactional API (production default)
 *   - 'resend'  → Resend.com
 *   - 'stub'    → console logger (dev/test)
 *
 * Templates remain inline HTML strings — no template engine dependency.
 * They use the Inventario brand colours (Navy #1A2D47, Blue #388FC3).
 *
 * Usage:
 *   await fastify.emailService.sendVerificationEmail(email, token, apiBaseUrl);
 *   await fastify.emailService.sendPasswordResetEmail(email, token, frontendUrl);
 */

import fp from 'fastify-plugin';

import { createEcomailProvider } from './email-providers/ecomail.provider.js';
import { createResendProvider } from './email-providers/resend.provider.js';
import { createStubProvider } from './email-providers/stub.provider.js';

import type { EmailProvider } from './email-providers/types.js';
import type { FastifyPluginAsync } from 'fastify';

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface EmailService {
  /** Send a raw email. Use the typed helpers below when possible. */
  send(opts: { to: string; subject: string; html: string; text?: string }): Promise<void>;

  /**
   * Send email address verification link.
   * @param token  Raw 64-char hex token (from emailVerificationToken field).
   * @param apiBaseUrl  E.g. https://api.inventario.sportup.sk (callback goes to /v1/auth/verify-email)
   */
  sendVerificationEmail(to: string, token: string, apiBaseUrl: string): Promise<void>;

  /**
   * Send password reset link.
   * @param token  Raw 64-char hex token (from passwordResetToken field).
   * @param frontendUrl  E.g. https://app.inventario.sportup.sk
   */
  sendPasswordResetEmail(to: string, token: string, frontendUrl: string): Promise<void>;

  /**
   * Send an invitation email to a new user.
   * @param to  Recipient email address.
   * @param opts  Invite metadata for the email body.
   */
  sendInvitationEmail(
    to: string,
    opts: {
      inviterName: string;
      tenantName: string;
      roleLabels: string;
      token: string;
      frontendUrl: string;
    },
  ): Promise<void>;

  /** Name of the active provider — for diagnostics. */
  readonly providerName: EmailProvider['name'];
  /** Whether the active provider is a real transport (false for stub). */
  readonly isConfigured: boolean;
}

// ---------------------------------------------------------------------------
// Fastify decoration
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyInstance {
    emailService: EmailService;
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const emailPlugin: FastifyPluginAsync = async (fastify) => {
  const {
    EMAIL_PROVIDER,
    EMAIL_FROM_ADDRESS,
    EMAIL_FROM_NAME,
    EMAIL_REPLY_TO,
    ECOMAIL_API_KEY,
    RESEND_API_KEY,
    NODE_ENV,
  } = fastify.config;

  const providerCtx = {
    fromAddress: EMAIL_FROM_ADDRESS,
    fromName: EMAIL_FROM_NAME,
    replyTo: EMAIL_REPLY_TO,
    logger: fastify.log,
  };

  // -------------------------------------------------------------------------
  // Provider selection + boot-time validation
  // -------------------------------------------------------------------------
  let provider: EmailProvider;

  if (EMAIL_PROVIDER === 'ecomail') {
    if (!ECOMAIL_API_KEY) {
      throw new Error(
        'EMAIL_PROVIDER=ecomail but ECOMAIL_API_KEY is not set. ' +
          'Add ECOMAIL_API_KEY to .env.local or change EMAIL_PROVIDER.',
      );
    }
    provider = createEcomailProvider({ ...providerCtx, apiKey: ECOMAIL_API_KEY });
  } else if (EMAIL_PROVIDER === 'resend') {
    if (!RESEND_API_KEY) {
      throw new Error(
        'EMAIL_PROVIDER=resend but RESEND_API_KEY is not set. ' +
          'Add RESEND_API_KEY (re_xxx) to .env.local or change EMAIL_PROVIDER.',
      );
    }
    provider = createResendProvider({ ...providerCtx, apiKey: RESEND_API_KEY });
  } else {
    provider = createStubProvider(providerCtx);
    if (NODE_ENV === 'production') {
      fastify.log.warn(
        'EMAIL_PROVIDER=stub in production — emails will NOT be delivered. ' +
          'Set EMAIL_PROVIDER=ecomail (or resend) and the matching API key.',
      );
    }
  }

  fastify.log.info(
    { provider: provider.name, fromAddress: EMAIL_FROM_ADDRESS, fromName: EMAIL_FROM_NAME },
    'Email service ready',
  );

  // -------------------------------------------------------------------------
  // Service surface
  // -------------------------------------------------------------------------
  const service: EmailService = {
    providerName: provider.name,
    isConfigured: provider.isConfigured,

    async send({ to, subject, html, text }) {
      await provider.send({ to, subject, html, ...(text ? { text } : {}) });
    },

    async sendVerificationEmail(to, token, apiBaseUrl) {
      const url = `${apiBaseUrl}/v1/auth/verify-email?token=${token}`;
      await provider.send({
        to,
        subject: 'Potvrďte svoju e-mailovú adresu — Inventario',
        html: verificationEmailHtml(url),
        text: `Potvrďte e-mail: ${url} (platnosť 24 hodín)`,
      });
    },

    async sendPasswordResetEmail(to, token, frontendUrl) {
      const url = `${frontendUrl}/reset-password?token=${token}`;
      await provider.send({
        to,
        subject: 'Obnovenie hesla — Inventario',
        html: passwordResetEmailHtml(url),
        text: `Obnovte heslo: ${url} (platnosť 1 hodinu)`,
      });
    },

    async sendInvitationEmail(to, { inviterName, tenantName, roleLabels, token, frontendUrl }) {
      const url = `${frontendUrl}/accept-invite?token=${token}`;
      await provider.send({
        to,
        subject: `Pozvánka do ${tenantName} — Inventario`,
        html: invitationEmailHtml({ url, inviterName, tenantName, roleLabels }),
        text:
          `${inviterName} vás pozval/a do organizácie ${tenantName} (${roleLabels}). ` +
          `Prijmite pozvánku: ${url} (platnosť ${INVITE_TEMPLATE_TTL_DAYS} dní)`,
      });
    },
  };

  fastify.decorate('emailService', service);
};

export default fp(emailPlugin, {
  name: 'email',
  dependencies: ['config'],
});

// ---------------------------------------------------------------------------
// Email HTML templates — Inventario brand
// ---------------------------------------------------------------------------

const INVITE_TEMPLATE_TTL_DAYS = 7;

function emailLayout(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="sk">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#F8F6F1;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8F6F1;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <!-- Header -->
          <tr>
            <td style="background-color:#1A2D47;border-radius:8px 8px 0 0;padding:24px 32px;">
              <p style="margin:0;color:#FFFFFF;font-size:20px;font-weight:700;letter-spacing:0.5px;">
                Inventario
              </p>
              <p style="margin:4px 0 0;color:#94A3B8;font-size:12px;">
                Transparentná správa majetku
              </p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="background-color:#FFFFFF;padding:32px;border-radius:0 0 8px 8px;">
              ${content}
              <hr style="border:none;border-top:1px solid #E2E8F0;margin:32px 0 24px;" />
              <p style="margin:0;color:#94A3B8;font-size:12px;line-height:1.6;">
                Táto správa bola odoslaná automaticky. Na tento e-mail neodpovedajte.<br />
                © 2026 LTK Solutions — Inventario
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function verificationEmailHtml(url: string): string {
  return emailLayout(
    'Potvrdenie e-mailu',
    `
    <h1 style="margin:0 0 8px;color:#1A2D47;font-size:22px;font-weight:700;">
      Potvrďte svoju e-mailovú adresu
    </h1>
    <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
      Dokončite registráciu kliknutím na tlačidlo nižšie.
      Odkaz je platný <strong>24 hodín</strong>.
    </p>
    <a href="${url}"
       style="display:inline-block;background-color:#388FC3;color:#FFFFFF;text-decoration:none;
              font-size:15px;font-weight:600;padding:12px 28px;border-radius:6px;">
      Potvrdiť e-mail
    </a>
    <p style="margin:20px 0 0;color:#94A3B8;font-size:12px;">
      Ak ste sa neregistrovali v Inventario, ignorujte tento e-mail.
    </p>
    `,
  );
}

function passwordResetEmailHtml(url: string): string {
  return emailLayout(
    'Obnovenie hesla',
    `
    <h1 style="margin:0 0 8px;color:#1A2D47;font-size:22px;font-weight:700;">
      Obnovenie hesla
    </h1>
    <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
      Požiadali ste o obnovenie hesla. Kliknite na tlačidlo nižšie.
      Odkaz je platný <strong>1 hodinu</strong>.
    </p>
    <a href="${url}"
       style="display:inline-block;background-color:#388FC3;color:#FFFFFF;text-decoration:none;
              font-size:15px;font-weight:600;padding:12px 28px;border-radius:6px;">
      Nastaviť nové heslo
    </a>
    <p style="margin:20px 0 0;color:#94A3B8;font-size:12px;">
      Ak ste o obnovenie nepožiadali, ignorujte tento e-mail. Vaše heslo zostáva nezmenené.
    </p>
    `,
  );
}

function invitationEmailHtml(opts: {
  url: string;
  inviterName: string;
  tenantName: string;
  roleLabels: string;
}): string {
  const { url, inviterName, tenantName, roleLabels } = opts;
  return emailLayout(
    `Pozvánka do ${tenantName}`,
    `
    <h1 style="margin:0 0 8px;color:#1A2D47;font-size:22px;font-weight:700;">
      Ste pozvaný do ${tenantName}
    </h1>
    <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
      <strong>${inviterName}</strong> vás pozval/a pripojiť sa k organizácii
      <strong>${tenantName}</strong> v systéme Inventario.
    </p>
    <table style="background-color:#F8F6F1;border-radius:6px;padding:16px 20px;margin:0 0 24px;width:100%;box-sizing:border-box;">
      <tr>
        <td style="color:#64748B;font-size:13px;padding-bottom:6px;">Rola</td>
        <td style="color:#1A2D47;font-size:14px;font-weight:600;">${roleLabels}</td>
      </tr>
      <tr>
        <td style="color:#64748B;font-size:13px;padding-bottom:6px;">Organizácia</td>
        <td style="color:#1A2D47;font-size:14px;font-weight:600;">${tenantName}</td>
      </tr>
      <tr>
        <td style="color:#64748B;font-size:13px;">Platnosť</td>
        <td style="color:#1A2D47;font-size:14px;">${INVITE_TEMPLATE_TTL_DAYS} dní od odoslania</td>
      </tr>
    </table>
    <a href="${url}"
       style="display:inline-block;background-color:#388FC3;color:#FFFFFF;text-decoration:none;
              font-size:15px;font-weight:600;padding:12px 28px;border-radius:6px;">
      Prijať pozvánku
    </a>
    <p style="margin:20px 0 0;color:#94A3B8;font-size:12px;">
      Ak neočakávate túto pozvánku, ignorujte tento e-mail.
      Váš účet nebude vytvorený bez výslovného súhlasu.
    </p>
    `,
  );
}
