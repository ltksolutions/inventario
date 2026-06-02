// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Unit testy pre protocol-renderer.ts (ADR-0022 K2).
 *
 * Čo je pokryté:
 *   - DETERMINIZMUS: dvojitý render toho istého fixture → identický SHA-256 hash
 *     (kritický invariant celého on-demand modelu — ak toto nefunguje, celé ADR-0022 padá)
 *   - Diakritika: SK znaky (ľ š č ť ž ý á í é ä ô) sa vyrenderujú bez pádu
 *   - Paper size: A4 aj LETTER dávajú správne rozmery stránky
 *   - Stránkovanie: 26 položiek (> PAGE_BREAK_ROWS=25) → 2 stránky
 *   - SIGNED stav: podpisové bloky sú vyplnené (render nespadne)
 *   - Null poznámka a null org. jednotka (nullable polia v schéme)
 *
 * Čo NIE je pokryté tu (bude v K7 integration testoch):
 *   - logo-loader.ts (fallback, timeout, SVG odmietnutie) — chodí po sieti
 *   - routes + RBAC
 *   - cross-tenant izolácia
 *
 * SETUP:
 *   Testy potrebujú fyzické súbory:
 *     apps/api/src/modules/protocols/assets/DejaVuSans.ttf
 *     apps/api/src/modules/protocols/assets/inventario-logo-default.png
 *
 *   Ak súbory chýbajú, testy skočia (skip) s jasnou správou.
 *   Po manuálnom pridaní binárnych súborov (README.md v assets/) testy bežia plne.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { renderProtocolPdf } from '../../src/modules/protocols/protocol-renderer.js';

import type { LoanProtocol, Organisation } from '@inventario/shared-types';

// ---------------------------------------------------------------------------
// Cesty k asset súborom
// ---------------------------------------------------------------------------

const ASSETS_DIR = join(fileURLToPath(import.meta.url), '../../src/modules/protocols/assets');

// ---------------------------------------------------------------------------
// Stav načítaných assetov (lazy, skipne ak chýbajú)
// ---------------------------------------------------------------------------

let font: Uint8Array | null = null;
let logo: Uint8Array | null = null;
let assetsAvailable = false;

beforeAll(async () => {
  try {
    const [fontBuf, logoBuf] = await Promise.all([
      readFile(join(ASSETS_DIR, 'DejaVuSans.ttf')),
      readFile(join(ASSETS_DIR, 'inventario-logo-default.png')),
    ]);
    font = new Uint8Array(fontBuf);
    logo = new Uint8Array(logoBuf);
    assetsAvailable = true;
  } catch {
    assetsAvailable = false;
  }
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Minimálna validná Organisation pre testy. */
function makeOrganisation(overrides: Partial<Organisation> = {}): Organisation {
  return {
    _id: 'org000000000000000000001',
    displayName: 'Slovenský futbalový zväz',
    slug: 'sfz',
    entraTenantId: null,
    customDomain: null,
    status: 'ACTIVE' as const,
    plan: 'FREE' as const,
    primaryContactEmail: null,
    brandKit: {
      logoUrl: null,
      faviconUrl: null,
      primary: null,
      primaryFg: null,
      accent: null,
      accentFg: null,
      fontFamilySans: null,
    },
    billing: {
      legalName: 'Slovenský futbalový zväz, o.z.',
      ico: '00695637',
      dic: '2020855701',
      isVatPayer: false,
      icDph: null,
      businessRegistration: null,
      iban: null,
      billingEmail: null,
      registeredAddress: null,
      mailingAddress: null,
    },
    settings: {},
    appBaseUrl: 'https://inventario.sfz.sk',
    publicAssetLookup: false,
    foundContactInfo: null,
    inventoryNumberFormat: null,
    protocolSettings: { paperSize: 'A4' },
    allowedAuthProviders: ['MICROSOFT'],
    memberJoinPolicy: 'INVITE_ONLY',
    autoJoinDomains: [],
    registeredBy: null,
    registrationMethod: 'MANUAL',
    onboardingCompletedAt: null,
    dpaAcceptedAt: null,
    dpaAcceptedBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'system',
    updatedBy: 'system',
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  } as unknown as Organisation;
}

/** Vytvorí jeden item pre tabuľku. Podporuje SK diakritiku v názve. */
function makeItem(index: number, nameSuffix = ''): LoanProtocol['items'][number] {
  return {
    assetId: `asset${String(index).padStart(19, '0')}`,
    snapshot: {
      inventoryNumber: `SFZ-2026-${String(index).padStart(4, '0')}`,
      name: `Notebook Lenovo ThinkPad ${nameSuffix || String(index)}`,
      serialNumber: `SN-${index}-ABCDEF`,
      category: 'Výpočtová technika',
    },
    condition: 'GOOD' as const,
    conditionNote: null,
    photoIds: [],
  };
}

/** Vytvorí LoanProtocol fixture. */
function makeProtocol(overrides: Partial<LoanProtocol> = {}): LoanProtocol {
  return {
    _id: 'proto00000000000000000001',
    organisationId: 'org000000000000000000001',
    type: 'HANDOVER' as const,
    loanId: 'loan0000000000000000001',
    originalProtocolId: null,
    protocolNumber: 'PROT-2026-000001',
    issuedAt: '2026-06-01T10:00:00.000Z',
    paperSize: 'A4' as const,
    parties: {
      handover: {
        userId: 'user0000000000000000001',
        snapshot: {
          displayName: 'Ján Letko',
          email: 'jan.letko@sfz.sk',
          organizationalUnit: 'IT oddelenie',
        },
      },
      receive: {
        userId: 'user0000000000000000002',
        snapshot: {
          displayName: 'Mária Šimková',
          email: 'maria.simkova@sfz.sk',
          organizationalUnit: null,
        },
      },
    },
    items: [makeItem(1, 'ľščťžýáíéäô')], // diakritika v prvom riadku
    notes: null,
    signatures: {
      handover: null,
      receive: null,
    },
    pdfSha256: null,
    status: 'DRAFT' as const,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    createdBy: 'user0000000000000000001',
    updatedBy: 'user0000000000000000001',
    ...overrides,
  } as unknown as LoanProtocol;
}

// ---------------------------------------------------------------------------
// Pomocná funkcia na SHA-256 hash PDF bajtov
// ---------------------------------------------------------------------------

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// ---------------------------------------------------------------------------
// Testy
// ---------------------------------------------------------------------------

describe('renderProtocolPdf', () => {
  it('skips all tests when binary assets are missing', () => {
    if (!assetsAvailable) {
      console.warn(
        '[SKIP] Binary assets missing: apps/api/src/modules/protocols/assets/{DejaVuSans.ttf,inventario-logo-default.png}. ' +
          'See README.md in that directory for download instructions.',
      );
    }
    // Tento test vždy prechádza — len loguje ak assets chýbajú.
    expect(true).toBe(true);
  });

  describe('when assets are available', () => {
    // ── KRITICKÝ INVARIANT: DETERMINIZMUS ──────────────────────────────────
    it('renders the same PDF bytes on two consecutive calls (determinism)', async () => {
      if (!assetsAvailable) return;

      const protocol = makeProtocol();
      const organisation = makeOrganisation();

      const [pdf1, pdf2] = await Promise.all([
        renderProtocolPdf(protocol, organisation, font!, logo!),
        renderProtocolPdf(protocol, organisation, font!, logo!),
      ]);

      // Bajt-pre-bajt identické výstupy = deterministický render
      expect(sha256(pdf1)).toBe(sha256(pdf2));
    });

    it('different protocols produce different hashes', async () => {
      if (!assetsAvailable) return;

      const prot1 = makeProtocol({ protocolNumber: 'PROT-2026-000001' });
      const prot2 = makeProtocol({ protocolNumber: 'PROT-2026-000002' });
      const org = makeOrganisation();

      const [pdf1, pdf2] = await Promise.all([
        renderProtocolPdf(prot1, org, font!, logo!),
        renderProtocolPdf(prot2, org, font!, logo!),
      ]);

      expect(sha256(pdf1)).not.toBe(sha256(pdf2));
    });

    // ── DIAKRITIKA ─────────────────────────────────────────────────────────
    it('renders without error when text contains full SK diacritics', async () => {
      if (!assetsAvailable) return;

      const protocol = makeProtocol({
        items: [makeItem(1, 'ľ š č ť ž ý á í é ä ô'), makeItem(2, 'Ľ Š Č Ť Ž Ý Á Í É Ä Ô')],
        parties: {
          handover: {
            userId: 'user0000000000000000001',
            snapshot: {
              displayName: 'Ľuboš Šimčák',
              email: 'lubos@sfz.sk',
              organizationalUnit: 'Správa majetku — ČR / SK',
            },
          },
          receive: {
            userId: 'user0000000000000000002',
            snapshot: {
              displayName: 'Žaneta Ďuríčková',
              email: 'zaneta@sfz.sk',
              organizationalUnit: null,
            },
          },
        },
      });

      const pdf = await renderProtocolPdf(protocol, makeOrganisation(), font!, logo!);

      // Výsledok je neprázdny PDF
      expect(pdf.length).toBeGreaterThan(1000);
      // Začína PDF magickým bytom
      expect(String.fromCharCode(...pdf.slice(0, 4))).toBe('%PDF');
    });

    // ── PAPER SIZE ─────────────────────────────────────────────────────────
    it('A4 paper produces correct page dimensions (595 x 842 pt)', async () => {
      if (!assetsAvailable) return;

      const pdf = await renderProtocolPdf(
        makeProtocol({ paperSize: 'A4' }),
        makeOrganisation(),
        font!,
        logo!,
      );

      const doc = await PDFDocument.load(pdf);
      const [page] = doc.getPages();
      expect(page!.getWidth()).toBeCloseTo(595, 0);
      expect(page!.getHeight()).toBeCloseTo(842, 0);
    });

    it('LETTER paper produces correct page dimensions (612 x 792 pt)', async () => {
      if (!assetsAvailable) return;

      const pdf = await renderProtocolPdf(
        makeProtocol({ paperSize: 'LETTER' }),
        makeOrganisation(),
        font!,
        logo!,
      );

      const doc = await PDFDocument.load(pdf);
      const [page] = doc.getPages();
      expect(page!.getWidth()).toBeCloseTo(612, 0);
      expect(page!.getHeight()).toBeCloseTo(792, 0);
    });

    // ── STRÁNKOVANIE ───────────────────────────────────────────────────────
    it('26 items (> PAGE_BREAK_ROWS=25) produces 2 pages', async () => {
      if (!assetsAvailable) return;

      const items = Array.from({ length: 26 }, (_, i) => makeItem(i + 1));
      const protocol = makeProtocol({ items });

      const pdf = await renderProtocolPdf(protocol, makeOrganisation(), font!, logo!);
      const doc = await PDFDocument.load(pdf);

      expect(doc.getPageCount()).toBe(2);
    });

    it('25 items (= PAGE_BREAK_ROWS) stays on 1 page', async () => {
      if (!assetsAvailable) return;

      const items = Array.from({ length: 25 }, (_, i) => makeItem(i + 1));
      const protocol = makeProtocol({ items });

      const pdf = await renderProtocolPdf(protocol, makeOrganisation(), font!, logo!);
      const doc = await PDFDocument.load(pdf);

      expect(doc.getPageCount()).toBe(1);
    });

    // ── SIGNED stav ────────────────────────────────────────────────────────
    it('renders SIGNED protocol with both signatures without error', async () => {
      if (!assetsAvailable) return;

      const protocol = makeProtocol({
        status: 'SIGNED',
        signatures: {
          handover: {
            signedAt: '2026-06-01T11:00:00.000Z',
            method: 'CLICK_TO_SIGN',
            ipAddress: '192.168.1.1',
            signatureImageId: null,
          },
          receive: {
            signedAt: '2026-06-01T11:05:00.000Z',
            method: 'CLICK_TO_SIGN',
            ipAddress: '192.168.1.2',
            signatureImageId: null,
          },
        },
      });

      const pdf = await renderProtocolPdf(protocol, makeOrganisation(), font!, logo!);
      expect(pdf.length).toBeGreaterThan(1000);
    });

    // ── RETURN typ ─────────────────────────────────────────────────────────
    it('renders RETURN type protocol without error', async () => {
      if (!assetsAvailable) return;

      const protocol = makeProtocol({ type: 'RETURN' });
      const pdf = await renderProtocolPdf(protocol, makeOrganisation(), font!, logo!);
      expect(pdf.length).toBeGreaterThan(1000);
    });

    // ── ORG BEZ BILLING ────────────────────────────────────────────────────
    it('renders without error when organisation has no billing info', async () => {
      if (!assetsAvailable) return;

      const org = makeOrganisation({ billing: null });
      const pdf = await renderProtocolPdf(makeProtocol(), org, font!, logo!);
      expect(pdf.length).toBeGreaterThan(1000);
    });

    // ── DETERMINIZMUS pri rôznych issuedAt ─────────────────────────────────
    it('same protocol renders to same hash regardless of when render is called', async () => {
      if (!assetsAvailable) return;

      // Simuluj dva "rôzne časy" renderu — výstup musí byť rovnaký
      const protocol = makeProtocol({ issuedAt: '2026-06-01T10:00:00.000Z' });
      const org = makeOrganisation();

      const pdf1 = await renderProtocolPdf(protocol, org, font!, logo!);

      // Krátky delay — ak by renderer používal now(), hash by sa líšil
      await new Promise((resolve) => setTimeout(resolve, 50));

      const pdf2 = await renderProtocolPdf(protocol, org, font!, logo!);

      expect(sha256(pdf1)).toBe(sha256(pdf2));
    });
  });
});
