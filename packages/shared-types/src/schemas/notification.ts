// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { z } from 'zod';

import { BaseDocumentSchema, ObjectIdSchema, TimestampSchema } from './common.js';

/**
 * Notification = upozornenie pre konkrétneho používateľa.
 *
 * Doručovanie:
 * - **In-app** — vždy (zobrazí sa v zvončeku)
 * - **E-mail** — ak user.preferences.emailNotifications = true a notifikácia má channels.email = true
 * - **Push** — ak user.preferences.pushNotifications = true a má registrovaný device (v3+)
 *
 * Notifikácie sú vždy "pull" — frontend si ich pýta cez API, server ich aktívne neoznamuje
 * (real-time updates riešime v3+ cez SSE alebo WebSockets).
 */
export const NotificationSchema = BaseDocumentSchema.extend({
  /** Príjemca. */
  recipientId: ObjectIdSchema,

  /** Typ notifikácie. */
  type: z.enum([
    // Loan request
    'LOAN_REQUEST_SUBMITTED', // pre schvaľovateľa
    'LOAN_REQUEST_APPROVED', // pre žiadateľa
    'LOAN_REQUEST_REJECTED', // pre žiadateľa
    'LOAN_REQUEST_NEEDS_REVIEW', // pre schvaľovateľa
    'LOAN_REQUEST_SUBSTITUTED', // schvaľovateľ navrhol náhradu

    // Loan lifecycle
    'LOAN_READY_FOR_PICKUP', // pripravené na prevzatie
    'LOAN_PICKED_UP', // potvrdenie prevzatia
    'LOAN_DUE_SOON_24H', // 24h pred termínom
    'LOAN_DUE_SOON_3D', // 3 dni pred termínom
    'LOAN_OVERDUE', // po termíne
    'LOAN_RETURNED', // potvrdenie vrátenia
    'LOAN_EXTENDED', // schválené predĺženie

    // Asset
    'ASSET_REQUIRES_SERVICE', // pre správcu
    'ASSET_LOST_REPORTED', // pre manažéra

    // System
    'SYSTEM_MAINTENANCE',
    'ACCOUNT_INVITATION', // pre nového externého používateľa
    'PASSWORD_RESET',
    'WELCOME', // po prvom prihlásení
  ]),

  /** Titul (krátky). */
  title: z.string().min(1).max(200),

  /** Telo (môže obsahovať Markdown). */
  body: z.string().min(1).max(2000),

  /** Severity pre vizuálne odlíšenie v UI. */
  severity: z.enum(['INFO', 'SUCCESS', 'WARNING', 'ERROR']).default('INFO'),

  /** Voliteľná akcia (deep link do aplikácie). */
  action: z
    .object({
      label: z.string().max(50),
      url: z.string().max(500), // relative URL v aplikácii
    })
    .nullable()
    .default(null),

  /** Súvisiaca entita (pre vytvorenie deep linku, ak chýba `action`). */
  relatedEntity: z
    .object({
      entityType: z.enum(['Asset', 'Loan', 'LoanRequest', 'User']),
      entityId: ObjectIdSchema,
    })
    .nullable()
    .default(null),

  /** Doručovacie kanály — false znamená "neposielať". */
  channels: z.object({
    inApp: z.boolean().default(true),
    email: z.boolean().default(false),
    push: z.boolean().default(false),
  }),

  /** Stav doručenia per kanál. */
  delivery: z.object({
    inAppShownAt: TimestampSchema.nullable().default(null),
    emailSentAt: TimestampSchema.nullable().default(null),
    emailFailedAt: TimestampSchema.nullable().default(null),
    emailFailureReason: z.string().max(500).nullable().default(null),
    pushSentAt: TimestampSchema.nullable().default(null),
  }),

  /** Či používateľ notifikáciu už prečítal. */
  readAt: TimestampSchema.nullable().default(null),

  /** Či používateľ notifikáciu archivoval / odmietol. */
  dismissedAt: TimestampSchema.nullable().default(null),

  /** Voliteľný TTL — po tomto čase sa notifikácia automaticky archivuje. */
  expiresAt: TimestampSchema.nullable().default(null),
});

export type Notification = z.infer<typeof NotificationSchema>;

export const CreateNotificationSchema = NotificationSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  readAt: true,
  dismissedAt: true,
  delivery: true,
}).extend({
  delivery: NotificationSchema.shape.delivery.optional(),
});

export type CreateNotificationInput = z.infer<typeof CreateNotificationSchema>;
