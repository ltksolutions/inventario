// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Unit testy pre protocol-number.ts (ADR-0022 K3).
 *
 * Čo je pokryté:
 *   - Základné číslovanie: prvý protokol = PROT-YYYY-000001
 *   - Sekvenčné rastenie: každé volanie inkrementuje
 *   - Formát: PROT-YYYY-NNNNNN (6 číslic, zero-padded)
 *   - Tenant izolácia: rôzne org majú nezávislé sekvencie
 *   - Ročná izolácia: rok 2025 a 2026 majú nezávislé sekvencie
 *   - Race safety: 10 súbežných volaní → 10 unikátnych čísel (bez duplikátov)
 *   - Idempotencia pri upsert: prvé volanie vytvorí counter, ďalšie inkrementujú
 *
 * Čo NIE je pokryté tu (K7):
 *   - Transakčná integrácia s LoanProtocol insertom
 *   - Unique index na loan_protocols (organisationId, protocolNumber)
 */

import { MongoClient } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { generateProtocolNumber } from '../../src/modules/protocols/protocol-number.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let client: MongoClient;
let db: ReturnType<MongoClient['db']>;

const MONGO_URI = process.env['MONGO_URI'] ?? 'mongodb://localhost:27017';
const TEST_DB = `inventario_protocol_number_test_${Date.now()}`;

beforeAll(async () => {
  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(TEST_DB);
});

afterAll(async () => {
  await db.dropDatabase();
  await client.close();
});

afterEach(async () => {
  // Vyčisti counters collection medzi testami
  await db.collection('counters').deleteMany({});
});

// ---------------------------------------------------------------------------
// Helper: spusti generateProtocolNumber mimo transakcie (pre jednoduchosť testov)
// ---------------------------------------------------------------------------

async function generate(orgId: string, year?: number): Promise<string> {
  const session = client.startSession();
  try {
    let result = '';
    await session.withTransaction(async () => {
      result = await generateProtocolNumber(db, orgId, session, year);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

// ---------------------------------------------------------------------------
// Testy
// ---------------------------------------------------------------------------

describe('generateProtocolNumber', () => {
  it('generates PROT-YYYY-000001 for the first call', async () => {
    const num = await generate('org-alpha', 2026);
    expect(num).toBe('PROT-2026-000001');
  });

  it('increments on each call', async () => {
    const n1 = await generate('org-beta', 2026);
    const n2 = await generate('org-beta', 2026);
    const n3 = await generate('org-beta', 2026);

    expect(n1).toBe('PROT-2026-000001');
    expect(n2).toBe('PROT-2026-000002');
    expect(n3).toBe('PROT-2026-000003');
  });

  it('zero-pads to 6 digits', async () => {
    const num = await generate('org-pad', 2026);
    // PROT-2026-000001 — 6 číslic
    expect(num).toMatch(/^PROT-\d{4}-\d{6}$/);
  });

  it('different organisations have independent sequences', async () => {
    const a1 = await generate('org-A', 2026);
    const b1 = await generate('org-B', 2026);
    const a2 = await generate('org-A', 2026);

    // Oba org štartujú od 1 nezávisle
    expect(a1).toBe('PROT-2026-000001');
    expect(b1).toBe('PROT-2026-000001');
    // Org-A pokračuje od 2
    expect(a2).toBe('PROT-2026-000002');
  });

  it('different years have independent sequences for the same org', async () => {
    const y2025 = await generate('org-years', 2025);
    const y2026 = await generate('org-years', 2026);
    const y2025b = await generate('org-years', 2025);

    expect(y2025).toBe('PROT-2025-000001');
    expect(y2026).toBe('PROT-2026-000001');
    expect(y2025b).toBe('PROT-2025-000002');
  });

  it('race safety: 10 concurrent calls produce 10 unique sequential numbers', async () => {
    // Simuluje 10 súbežných fulfil volaní z rovnakého tenanta v rovnakom roku
    const promises = Array.from({ length: 10 }, () => generate('org-race', 2026));
    const results = await Promise.all(promises);

    // Všetky čísla unikátne
    const unique = new Set(results);
    expect(unique.size).toBe(10);

    // Všetky sú validný formát
    for (const num of results) {
      expect(num).toMatch(/^PROT-2026-\d{6}$/);
    }

    // Sekvencie sú čísla 1–10 (v akomkoľvek poradí — súbežné)
    const seqs = results.map((n) => parseInt(n.split('-')[2]!, 10)).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('uses current UTC year when year param is omitted', async () => {
    const num = await generate('org-default-year');
    const currentYear = new Date().getUTCFullYear();
    expect(num).toMatch(new RegExp(`^PROT-${currentYear}-\\d{6}$`));
  });
});
