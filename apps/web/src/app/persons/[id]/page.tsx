// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { redirect } from 'next/navigation';

/**
 * /persons/[id] — "osobná karta majetku", merged into /users (2026-07-14,
 * Osoby/Používatelia merge) — the loans/history info this page showed now
 * lives on the /users/[id] detail page (detail+editácia používateľa,
 * 2026-07-14). There's no per-person route equivalent under /persons
 * anymore, so old deep links just land on the /users list. The old
 * `PersonDetailContent.tsx` component was removed on 2026-07-15
 * (task #35), once the merge was verified live in production.
 */
export default async function PersonDetailPage(): Promise<never> {
  redirect('/users');
}
