// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Boot timing — rozpad cold startu na fázy.
 *
 * Cold start API na Verceli trvá rádovo sekundy a používateľ ho vidí ako
 * prázdny dashboard. Bez merania sa dá len hádať, či za to môže boot
 * Fastify appky, nadviazanie spojenia na Atlas, `ensureIndexes()` volania
 * v jednotlivých moduloch, generovanie Swaggeru, alebo samotné queries.
 *
 * Použitie:
 *   const timer = createBootTimer();
 *   ...
 *   timer.mark('mongo');
 *   ...
 *   timer.summary(app.log);   // jeden riadok s rozpadom
 *
 * Podrobné per-fázové riadky sa logujú len keď `BOOT_TIMING=1`. Súhrnný
 * riadok ide vždy — je to jeden log na cold start, čo je zanedbateľné a
 * v produkcii to je jediný spôsob, ako regresiu vôbec zbadať.
 */

interface BootPhase {
  label: string;
  ms: number;
}

export interface BootTimer {
  /** Uzavrie aktuálnu fázu pod daným názvom a otvorí ďalšiu. */
  mark: (label: string) => void;
  /** Zaloguje súhrnný riadok s rozpadom všetkých fáz. */
  summary: (log: { info: (obj: object, msg: string) => void }) => void;
}

const VERBOSE = process.env['BOOT_TIMING'] === '1';

export function createBootTimer(): BootTimer {
  const startedAt = Date.now();
  let lastAt = startedAt;
  const phases: BootPhase[] = [];

  return {
    mark(label: string): void {
      const now = Date.now();
      const ms = now - lastAt;
      lastAt = now;
      phases.push({ label, ms });
      if (VERBOSE) {
        console.info(`[boot-timing] ${label}=${String(ms)}ms`);
      }
    },
    summary(log): void {
      const totalMs = Date.now() - startedAt;
      log.info(
        {
          totalMs,
          phases: Object.fromEntries(phases.map((p) => [p.label, p.ms])),
        },
        'Boot timing',
      );
    },
  };
}
