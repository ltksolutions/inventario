// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type { JSX } from 'react';

import { AuthGate } from '@/components/AuthGate';
import { UserDetailContent } from '@/components/UserDetailContent';

/**
 * /users/[id] — detail of a single user (detail+editácia používateľa,
 * 2026-07-14). Read-only for ASSET_MANAGER + ADMIN; see
 * UserDetailContent.tsx for the full rationale.
 *
 * Mirrors /assets/[id]/page.tsx: parse the URL segment here, hand the
 * id off to a client component, wrap the whole thing in AuthGate so
 * unauthenticated visitors get the login screen instead of a 404 for a
 * route they can't see. Next.js 15 dynamic route params arrive as a
 * Promise that must be awaited even for a single segment.
 */
export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  return (
    <AuthGate>
      <UserDetailContent userId={id} />
    </AuthGate>
  );
}
