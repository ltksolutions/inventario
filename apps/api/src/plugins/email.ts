// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Email plugin — templating + provider selection.
 *
 * Active provider chosen via EMAIL_PROVIDER env var:
 *   'ecomail' → Ecomail.cz (production default)
 *   'resend'  → Resend.com
 *   'stub'    → console logger (dev/test)
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
  send(opts: { to: string; subject: string; html: string; text?: string }): Promise<void>;
  sendVerificationEmail(to: string, token: string, apiBaseUrl: string): Promise<void>;
  sendPasswordResetEmail(to: string, token: string, frontendUrl: string): Promise<void>;
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
  sendEmailChangeEmail(to: string, token: string, apiBaseUrl: string): Promise<void>;
  sendLoanApprovedEmail(
    to: string,
    opts: {
      requesterName: string;
      purpose: string;
      itemCount: number;
      dueAt: string | null;
      frontendUrl: string;
    },
  ): Promise<void>;
  sendLoanRejectedEmail(
    to: string,
    opts: {
      requesterName: string;
      purpose: string;
      reason: string;
      frontendUrl: string;
    },
  ): Promise<void>;
  sendLoanRequestPendingEmail(
    to: string,
    opts: {
      requesterName: string;
      purpose: string;
      itemCount: number;
      plannedFrom: string;
      plannedTo: string | null;
      requestId: string;
      frontendUrl: string;
    },
  ): Promise<void>;
  sendProtocolToSignEmail(
    to: string,
    opts: {
      recipientName: string;
      protocolType: 'HANDOVER' | 'RETURN';
      loanId: string;
      frontendUrl: string;
    },
  ): Promise<void>;
  /**
   * Send account-linking magic-link email (OAuth-only accounts).
   * @param verifyUrl  Full URL to /v1/auth/link-provider/verify?token=...
   * @param providerName  'google' | 'microsoft' — shown in email body
   */
  sendLinkProviderEmail(to: string, verifyUrl: string, providerName: string): Promise<void>;
  readonly providerName: EmailProvider['name'];
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

  let provider: EmailProvider;

  if (EMAIL_PROVIDER === 'ecomail') {
    if (!ECOMAIL_API_KEY) {
      throw new Error('EMAIL_PROVIDER=ecomail but ECOMAIL_API_KEY is not set.');
    }
    provider = createEcomailProvider({ ...providerCtx, apiKey: ECOMAIL_API_KEY });
  } else if (EMAIL_PROVIDER === 'resend') {
    if (!RESEND_API_KEY) {
      throw new Error('EMAIL_PROVIDER=resend but RESEND_API_KEY is not set.');
    }
    provider = createResendProvider({ ...providerCtx, apiKey: RESEND_API_KEY });
  } else {
    provider = createStubProvider(providerCtx);
    if (NODE_ENV === 'production') {
      fastify.log.warn('EMAIL_PROVIDER=stub in production — emails will NOT be delivered.');
    }
  }

  fastify.log.info(
    { provider: provider.name, fromAddress: EMAIL_FROM_ADDRESS, fromName: EMAIL_FROM_NAME },
    'Email service ready',
  );

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
          `${inviterName} vás pozval/a do ${tenantName} (${roleLabels}). ` +
          `Prijmite pozvánku: ${url} (platnosť ${INVITE_TTL_DAYS} dní)`,
      });
    },

    async sendEmailChangeEmail(to, token, apiBaseUrl) {
      const url = `${apiBaseUrl}/v1/auth/confirm-email-change?token=${token}`;
      await provider.send({
        to,
        subject: 'Potvrdte zmenu e-mailovej adresy — Inventario',
        html: emailChangeHtml(url),
        text: `Potvrdte zmenu e-mailu: ${url} (platnosť 1 hodinu)`,
      });
    },

    async sendLoanApprovedEmail(to, opts) {
      await provider.send({
        to,
        subject: 'Vaša žiadosť o výpožičku bola schválená — Inventario',
        html: loanApprovedEmailHtml(opts),
        text:
          `Dobrá správa, ${opts.requesterName}! Žiadosť "${opts.purpose}" (${opts.itemCount} pol.) bola schválená. ` +
          `Termín vrátenia: ${formatDateSk(opts.dueAt)}. ${opts.frontendUrl}/my-loans`,
      });
    },

    async sendLoanRejectedEmail(to, opts) {
      await provider.send({
        to,
        subject: 'Vaša žiadosť o výpožičku bola zamietnutá — Inventario',
        html: loanRejectedEmailHtml(opts),
        text:
          `Žiadosť "${opts.purpose}" bola zamietnutá. Dôvod: ${opts.reason}. ` +
          `${opts.frontendUrl}/requests`,
      });
    },

    async sendLoanRequestPendingEmail(to, opts) {
      await provider.send({
        to,
        subject: `Nová žiadosť o výpožičku čaká na schválenie — Inventario`,
        html: loanRequestPendingEmailHtml(opts),
        text:
          `${opts.requesterName} podal/a žiadosť "${opts.purpose}" (${opts.itemCount} pol.), ` +
          `${formatDateSk(opts.plannedFrom)} – ${formatDateSk(opts.plannedTo)}. ` +
          `${opts.frontendUrl}/requests/${opts.requestId}`,
      });
    },

    async sendProtocolToSignEmail(to, opts) {
      const typeLabel = opts.protocolType === 'HANDOVER' ? 'odovzdávací' : 'preberací';
      await provider.send({
        to,
        subject: `Máte ${typeLabel} protokol na podpis — Inventario`,
        html: protocolToSignEmailHtml(opts),
        text:
          `${opts.recipientName}, máte ${typeLabel} protokol na podpis. ` +
          `Podpíšte ho na: ${opts.frontendUrl}/loans/${opts.loanId}`,
      });
    },

    async sendLinkProviderEmail(to, verifyUrl, providerName) {
      const label = providerName === 'microsoft' ? 'Microsoft' : 'Google';
      await provider.send({
        to,
        subject: `Prepojenie účtu s ${label} — Inventario`,
        html: linkProviderEmailHtml(verifyUrl, label),
        text: `Potvrdte prepojenie vášho účtu s ${label}: ${verifyUrl} (platnosť 30 minút)`,
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
// Shared template helpers
// ---------------------------------------------------------------------------

const INVITE_TTL_DAYS = 7;

function formatDateSk(iso: string | null): string {
  if (!iso) return 'bez termínu';
  return new Date(iso).toLocaleDateString('sk-SK', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

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
          <tr>
            <td style="background-color:#1A2D47;border-radius:8px 8px 0 0;padding:24px 32px;">
              <p style="margin:0;color:#FFFFFF;font-size:20px;font-weight:700;">Inventario</p>
              <p style="margin:4px 0 0;color:#94A3B8;font-size:12px;">Transparentná správa majetku</p>
            </td>
          </tr>
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

function btn(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;background-color:#388FC3;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:6px;">${label}</a>`;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function verificationEmailHtml(url: string): string {
  return emailLayout(
    'Potvrdenie e-mailu',
    `
    <h1 style="margin:0 0 8px;color:#1A2D47;font-size:22px;font-weight:700;">Potvrďte svoju e-mailovú adresu</h1>
    <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
      Dokončite registráciu kliknutím na tlačidlo nižšie. Odkaz je platný <strong>24 hodín</strong>.
    </p>
    ${btn(url, 'Potvrdiť e-mail')}
    <p style="margin:20px 0 0;color:#94A3B8;font-size:12px;">Ak ste sa neregistrovali v Inventario, ignorujte tento e-mail.</p>
  `,
  );
}

function passwordResetEmailHtml(url: string): string {
  return emailLayout(
    'Obnovenie hesla',
    `
    <h1 style="margin:0 0 8px;color:#1A2D47;font-size:22px;font-weight:700;">Obnovenie hesla</h1>
    <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
      Požiadali ste o obnovenie hesla. Odkaz je platný <strong>1 hodinu</strong>.
    </p>
    ${btn(url, 'Nastaviť nové heslo')}
    <p style="margin:20px 0 0;color:#94A3B8;font-size:12px;">Ak ste o obnovenie nepožiadali, ignorujte tento e-mail.</p>
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
    <h1 style="margin:0 0 8px;color:#1A2D47;font-size:22px;font-weight:700;">Ste pozvaný do ${tenantName}</h1>
    <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
      <strong>${inviterName}</strong> vás pozval/a pripojiť sa k organizácii <strong>${tenantName}</strong>.
    </p>
    <table style="background-color:#F8F6F1;border-radius:6px;padding:16px 20px;margin:0 0 24px;width:100%;box-sizing:border-box;">
      <tr><td style="color:#64748B;font-size:13px;padding-bottom:6px;">Rola</td>
          <td style="color:#1A2D47;font-size:14px;font-weight:600;">${roleLabels}</td></tr>
      <tr><td style="color:#64748B;font-size:13px;">Platnosť</td>
          <td style="color:#1A2D47;font-size:14px;">${INVITE_TTL_DAYS} dní</td></tr>
    </table>
    ${btn(url, 'Prijať pozvánku')}
    <p style="margin:20px 0 0;color:#94A3B8;font-size:12px;">Ak neočakávate túto pozvánku, ignorujte tento e-mail.</p>
  `,
  );
}

function emailChangeHtml(url: string): string {
  return emailLayout(
    'Zmena e-mailovej adresy',
    `
    <h1 style="margin:0 0 8px;color:#1A2D47;font-size:22px;font-weight:700;">Potvrdenie zmeny e-mailu</h1>
    <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
      Dostali sme žiadosť o zmenu e-mailovej adresy. Odkaz je platný <strong>1 hodinu</strong>.
    </p>
    ${btn(url, 'Potvrdiť novú e-mailovú adresu')}
    <p style="margin:20px 0 0;color:#94A3B8;font-size:12px;">
      Ak ste o zmenu nepožiadali, kontaktujte nás na
      <a href="mailto:security@inventario.estate" style="color:#388FC3;">security@inventario.estate</a>.
    </p>
  `,
  );
}

function loanApprovedEmailHtml(opts: {
  requesterName: string;
  purpose: string;
  itemCount: number;
  dueAt: string | null;
  frontendUrl: string;
}): string {
  return emailLayout(
    'Žiadosť schválená',
    `
    <h1 style="margin:0 0 8px;color:#1A2D47;font-size:22px;font-weight:700;">✅ Žiadosť bola schválená</h1>
    <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
      Dobrá správa, <strong>${opts.requesterName}</strong>! Vaša žiadosť o výpožičku bola schválená.
    </p>
    <table style="background-color:#F8F6F1;border-radius:6px;padding:16px 20px;margin:0 0 24px;width:100%;box-sizing:border-box;">
      <tr><td style="color:#64748B;font-size:13px;padding-bottom:6px;">Účel</td>
          <td style="color:#1A2D47;font-size:14px;font-weight:600;">${opts.purpose}</td></tr>
      <tr><td style="color:#64748B;font-size:13px;padding-bottom:6px;">Počet</td>
          <td style="color:#1A2D47;font-size:14px;">${opts.itemCount}</td></tr>
      <tr><td style="color:#64748B;font-size:13px;">Termín vrátenia</td>
          <td style="color:#1A2D47;font-size:14px;font-weight:600;">${formatDateSk(opts.dueAt)}</td></tr>
    </table>
    ${btn(`${opts.frontendUrl}/my-loans`, 'Zobraziť moje výpožičky')}
  `,
  );
}

function loanRejectedEmailHtml(opts: {
  requesterName: string;
  purpose: string;
  reason: string;
  frontendUrl: string;
}): string {
  return emailLayout(
    'Žiadosť zamietnutá',
    `
    <h1 style="margin:0 0 8px;color:#1A2D47;font-size:22px;font-weight:700;">Žiadosť bola zamietnutá</h1>
    <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
      <strong>${opts.requesterName}</strong>, vaša žiadosť <strong>"${opts.purpose}"</strong> bola zamietnutá.
    </p>
    <table style="background-color:#FEF2F2;border-radius:6px;padding:16px 20px;margin:0 0 24px;width:100%;box-sizing:border-box;">
      <tr><td style="color:#64748B;font-size:13px;padding-bottom:4px;">Dôvod</td></tr>
      <tr><td style="color:#1A2D47;font-size:14px;">${opts.reason}</td></tr>
    </table>
    ${btn(`${opts.frontendUrl}/requests`, 'Zobraziť moje žiadosti')}
  `,
  );
}

function loanRequestPendingEmailHtml(opts: {
  requesterName: string;
  purpose: string;
  itemCount: number;
  plannedFrom: string;
  plannedTo: string | null;
  requestId: string;
  frontendUrl: string;
}): string {
  return emailLayout(
    'Nová žiadosť o výpožičku',
    `
    <h1 style="margin:0 0 8px;color:#1A2D47;font-size:22px;font-weight:700;">Nová žiadosť čaká na schválenie</h1>
    <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
      <strong>${opts.requesterName}</strong> podal/a novú žiadosť o výpožičku.
    </p>
    <table style="background-color:#F8F6F1;border-radius:6px;padding:16px 20px;margin:0 0 24px;width:100%;box-sizing:border-box;">
      <tr><td style="color:#64748B;font-size:13px;padding-bottom:6px;">Účel</td>
          <td style="color:#1A2D47;font-size:14px;font-weight:600;">${opts.purpose}</td></tr>
      <tr><td style="color:#64748B;font-size:13px;padding-bottom:6px;">Počet</td>
          <td style="color:#1A2D47;font-size:14px;">${opts.itemCount}</td></tr>
      <tr><td style="color:#64748B;font-size:13px;padding-bottom:6px;">Od</td>
          <td style="color:#1A2D47;font-size:14px;">${formatDateSk(opts.plannedFrom)}</td></tr>
      <tr><td style="color:#64748B;font-size:13px;">Do</td>
          <td style="color:#1A2D47;font-size:14px;">${formatDateSk(opts.plannedTo)}</td></tr>
    </table>
    ${btn(`${opts.frontendUrl}/requests/${opts.requestId}`, 'Schváliť alebo zamietnuť')}
  `,
  );
}

function protocolToSignEmailHtml(opts: {
  recipientName: string;
  protocolType: 'HANDOVER' | 'RETURN';
  loanId: string;
  frontendUrl: string;
}): string {
  const isHandover = opts.protocolType === 'HANDOVER';
  const typeLabel = isHandover ? 'odovzdávací' : 'preberací';
  const actionLabel = isHandover ? 'Podpísať odovzdávací protokol' : 'Podpísať preberací protokol';
  const url = `${opts.frontendUrl}/loans/${opts.loanId}`;
  return emailLayout(
    `Protokol na podpis`,
    `
    <h1 style="margin:0 0 8px;color:#1A2D47;font-size:22px;font-weight:700;">✍️ Máte ${typeLabel} protokol na podpis</h1>
    <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
      Ahoj, <strong>${opts.recipientName}</strong>!<br />
      Bol vytvorený ${typeLabel} protokol k výpožičke, ktorý čaká na váš podpis.
    </p>
    ${btn(url, actionLabel)}
    <p style="margin:20px 0 0;color:#94A3B8;font-size:12px;">Protokol podpíšete na stránke s detailom výpožičky.</p>
  `,
  );
}

function linkProviderEmailHtml(verifyUrl: string, providerLabel: string): string {
  return emailLayout(
    `Prepojenie účtu s ${providerLabel}`,
    `
    <h1 style="margin:0 0 8px;color:#1A2D47;font-size:22px;font-weight:700;">Prepojenie účtu s ${providerLabel}</h1>
    <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
      Niekto sa pokúsil prihlásiť do Inventario cez <strong>${providerLabel}</strong> s touto e-mailovou adresou,
      ktorá patrí k existujúcemu účtu. Kliknite na tlačidlo nižšie pre prepojenie účtov.
      Odkaz je platný <strong>30 minút</strong>.
    </p>
    ${btn(verifyUrl, `Prepojiť s ${providerLabel}`)}
    <p style="margin:20px 0 0;color:#94A3B8;font-size:12px;">
      Ak ste sa nepokúšali prihlásiť cez ${providerLabel}, ignorujte tento e-mail.
      Váš účet zostáva nezmenený.
    </p>
  `,
  );
}
