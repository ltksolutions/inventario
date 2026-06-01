// SPDX-FileCopyrightText: 2026 Jan Letko / LTK Solutions
// SPDX-License-Identifier: CC-BY-4.0

import { ScanPage } from '@/components/ScanPage';

/**
 * /scan/[publicToken] — verejná "found asset" stránka (ADR-0021 K5).
 * Bez AuthGate — prístupné bez prihlásenia.
 */
export default function Page({ params }: { params: { publicToken: string } }) {
  return <ScanPage publicToken={params.publicToken} />;
}
