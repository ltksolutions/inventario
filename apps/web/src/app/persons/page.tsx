// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { redirect } from 'next/navigation';

/**
 * /persons — "Osoby" module, merged into /users (2026-07-14, Osoby/
 * Používatelia merge). Redirects old bookmarks/links. The old
 * `PersonsContent.tsx` component was removed on 2026-07-15 (task #35),
 * once the merge was verified live in production.
 * `redirect()` throws internally and never returns — `never` is the
 * correct return type (matches the Next.js typing for this pattern).
 */
export default function PersonsPage(): never {
  redirect('/users');
}
