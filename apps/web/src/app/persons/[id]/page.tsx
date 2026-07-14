// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { redirect } from 'next/navigation';

/**
 * /persons/[id] — "osobná karta majetku", merged into /users (2026-07-14,
 * Osoby/Používatelia merge) — the loans/history info this page showed now
 * lives in UserEditDialog's "Výpožičky tejto osoby" section, opened from the
 * /users row action. There's no per-person route equivalent (it's a modal,
 * not a page), so old deep links just land on the list. PersonDetailContent.tsx
 * is no longer imported here but kept on disk pending cleanup (task #35).
 */
export default async function PersonDetailPage(): Promise<never> {
  redirect('/users');
}
