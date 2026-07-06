// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type { JSX } from 'react';

import { AuthGate } from '@/components/AuthGate';
import { PersonDetailContent } from '@/components/PersonDetailContent';

/**
 * /persons/[id] — "osobná karta majetku". Mirrors /assets/[id]: parse
 * the dynamic segment here (Next.js 15 async params), hand it to the
 * client component, wrap in AuthGate.
 */
export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  return (
    <AuthGate>
      <PersonDetailContent personId={id} />
    </AuthGate>
  );
}
