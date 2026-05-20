// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Email plugin — nodemailer SMTP transport, K6 per ADR-0013.
 *
 * Decorates `fastify.emailService` with typed send methods.
 *
 * Behaviour by environment:
 *   - SMTP_HOST set → real SMTP transport (production / staging)
 *   - SMTP_HOST not set → console stub (logs subject + recipient + URL)
 *
 * Templates are inline HTML strings — no template engine dependency.
 * They use the Inventario brand colours (Navy #1A2D47, Blue #388FC3).
 *
 * Usage:
 *   await fastify.emailService.sendVerificationEmail(email, token, apiBaseUrl);
 *   await fastify.emailService.sendPasswordResetEmail(email, token, frontendUrl);
 */

import fp from 'fastify-plugin';
import nodemailer from 'nodemailer';

import type { FastifyPluginAsync } from 'fastify';
import type { Transporter } from 'nodemailer';

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

  /** Whether a real SMTP transport is configured. False = console stub. */
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
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, EMAIL_FROM } = fastify.config;

  let transporter: Transporter | null = null;

  if (SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      ...(SMTP_USER && SMTP_PASS ? { auth: { user: SMTP_USER, pass: SMTP_PASS } } : {}),
    });

    // Verify SMTP connection at startup
    try {
      await transporter.verify();
      fastify.log.info({ host: SMTP_HOST, port: SMTP_PORT }, 'SMTP transport verified');
    } catch (err) {
      fastify.log.warn(
        { err, host: SMTP_HOST },
        'SMTP transport verify failed — emails may not send',
      );
    }
  } else {
    fastify.log.info('SMTP_HOST not set — email service in console stub mode');
  }

  const service: EmailService = {
    isConfigured: transporter !== null,

    async send({ to, subject, html, text }) {
      if (!transporter) {
        fastify.log.info({ to, subject }, '[EMAIL-STUB] Would send email');
        return;
      }
      await transporter.sendMail({ from: EMAIL_FROM, to, subject, html, text });
    },

    async sendVerificationEmail(to, token, apiBaseUrl) {
      const url = `${apiBaseUrl}/v1/auth/verify-email?token=${token}`;
      const subject = 'Potvrďte svoju e-mailovú adresu — Inventario';

      if (!transporter) {
        fastify.log.info({ to, verificationUrl: url }, '[EMAIL-STUB] Verification email');
        return;
      }

      await this.send({
        to,
        subject,
        html: verificationEmailHtml(url),
        text: `Potvrďte e-mail: ${url} (platnosť 24 hodín)`,
      });
    },

    async sendPasswordResetEmail(to, token, frontendUrl) {
      const url = `${frontendUrl}/reset-password?token=${token}`;
      const subject = 'Obnovenie hesla — Inventario';

      if (!transporter) {
        fastify.log.info({ to, resetUrl: url }, '[EMAIL-STUB] Password reset email');
        return;
      }

      await this.send({
        to,
        subject,
        html: passwordResetEmailHtml(url),
        text: `Obnovte heslo: ${url} (platnosť 1 hodinu)`,
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
