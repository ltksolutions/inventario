// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Vitest configuration for @inventario/web (ADR-0035 F7 — prvý frontend
 * test, žiadna staršia infra existovala predtým).
 *
 * `environment: 'node'` — súčasné testy (middleware.ts) nepotrebujú DOM.
 * Ak sa v budúcnosti pridajú testy React komponentov, buď sa toto
 * prepne globálne na `'jsdom'` (+ `@testing-library/react` devDependency),
 * alebo sa použije per-file `// @vitest-environment jsdom` komentár.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: 'default',
  },
});
