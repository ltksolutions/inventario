// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Protocol PDF renderer — deterministická čistá funkcia (ADR-0022 K2).
 *
 * `renderProtocolPdf(protocol, organisation, font, logo) → Uint8Array`
 *
 * INVARIANTY (ADR-0022 rozhodnutie 4):
 *   1. Žiadne `new Date()` / `Date.now()` — všetky dátumy zo záznamu (`issuedAt`, podpisy).
 *   2. `PDFDocument` `CreationDate` a `ModDate` = `protocol.issuedAt` (nie čas renderu).
 *   3. Font a logo sú fixné vstupy (bajty) — renderer ich len embeduje, nestahuje.
 *   4. Žiadne náhodné / iteratívne ID závislé od času.
 *
 * Dôsledok: rovnaké vstupy → vždy identický výstup → stabilný `pdfSha256`.
 *
 * Layout:
 *   - Hlavička: logo (max 40 pt výška) + org identita (displayName, legalName, IČO, DIČ)
 *   - Telo: typ protokolu, protocolNumber, issuedAt, strany (odovzdávajúci / preberajúci)
 *   - Tabuľka položiek: inv. číslo, názov, sér. číslo, kategória, stav, poznámka
 *     → stránkovanie pri viac ako PAGE_BREAK_ROWS položkách
 *   - Pätka: podpisové bloky (prázdne v DRAFT, vyplnené v SIGNED)
 *
 * Obmedzenia v tejto funkcii (zámer):
 *   - Bez DB prístupu — renderer číta výhradne zo záznamu a vstupných parametrov.
 *   - Bez sieťových volaní — logo bajty dostane hotové (loader je v logo-loader.ts).
 *   - Bez `require`/`import` z Node fs — font a logo prídu ako `Uint8Array`.
 */

import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';

import type { LoanProtocol, Organisation } from '@inventario/shared-types';
import type { PDFPage } from 'pdf-lib';

// ---------------------------------------------------------------------------
// Konštanty
// ---------------------------------------------------------------------------

/** Maximálny počet položiek na stránku pred zalomením. */
const PAGE_BREAK_ROWS = 25;

/** Rozmery papiera v bodoch (1 pt = 1/72 palca). */
const PAPER_SIZES = {
  A4: { width: 595, height: 842 },
  LETTER: { width: 612, height: 792 },
} as const;

/** Marže v bodoch. */
const MARGIN = { top: 60, bottom: 80, left: 50, right: 50 } as const;

/** Výška pätky od spodku stránky. */
const FOOTER_HEIGHT = 80;

/** Výška hlavičky (logo + org blok + separator). */
const HEADER_HEIGHT = 90;

/** Výšky riadkov a stĺpcov tabuľky. */
const TABLE_ROW_H = 18;
const TABLE_HEADER_H = 22;

/** Farby. */
const COLOR = {
  black: rgb(0, 0, 0),
  darkGray: rgb(0.2, 0.2, 0.2),
  midGray: rgb(0.5, 0.5, 0.5),
  lightGray: rgb(0.85, 0.85, 0.85),
  white: rgb(1, 1, 1),
  separator: rgb(0.7, 0.7, 0.7),
} as const;

/** Veľkosti písma. */
const FONT_SIZE = {
  title: 14,
  subtitle: 10,
  body: 9,
  small: 8,
  tableHeader: 8,
  tableBody: 8,
} as const;

/** Slovenský label pre typ protokolu. */
const PROTOCOL_TYPE_LABEL: Record<LoanProtocol['type'], string> = {
  HANDOVER: 'ODOVZDÁVACÍ PROTOKOL',
  RETURN: 'PREBERACÍ PROTOKOL',
  AMENDMENT: 'DODATOK K PROTOKOLU',
};

/** Slovenský label pre stav položky. */
const CONDITION_LABEL: Record<string, string> = {
  NEW: 'Nový',
  EXCELLENT: 'Výborný',
  GOOD: 'Dobrý',
  FAIR: 'Uspokojivý',
  POOR: 'Zlý',
  UNUSABLE: 'Nepoužiteľný',
};

// ---------------------------------------------------------------------------
// Hlavná exportovaná funkcia
// ---------------------------------------------------------------------------

/**
 * Vyrenderuje protokol ako PDF bajty.
 *
 * @param protocol - `LoanProtocol` dokument zo záznamu (snapshot, nie live data).
 * @param organisation - `Organisation` dokument tenanta (pre hlavičku).
 * @param font - DejaVuSans.ttf bajty (Uint8Array). Poskytuje volajúci z disku.
 * @param logo - Logo PNG bajty (Uint8Array). Poskytuje `loadLogo()` z logo-loader.ts.
 * @returns PDF bajty ako `Uint8Array`.
 *
 * Deterministické: rovnaké vstupy → vždy identický výstup.
 */
export async function renderProtocolPdf(
  protocol: LoanProtocol,
  organisation: Organisation,
  font: Uint8Array,
  logo: Uint8Array,
): Promise<Uint8Array> {
  const paperSize = PAPER_SIZES[protocol.paperSize ?? 'A4'];

  // ── Vytvoriť PDFDocument ─────────────────────────────────────────────────
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // DETERMINIZMUS: CreationDate a ModDate = issuedAt, NIE čas renderu.
  const issuedDate = new Date(protocol.issuedAt);
  pdfDoc.setCreationDate(issuedDate);
  pdfDoc.setModificationDate(issuedDate);
  pdfDoc.setTitle(`${PROTOCOL_TYPE_LABEL[protocol.type]} ${protocol.protocolNumber}`);
  pdfDoc.setAuthor(organisation.displayName);
  pdfDoc.setProducer('Inventario PDF Renderer');
  pdfDoc.setCreator('Inventario');

  // ── Embedovať font ───────────────────────────────────────────────────────
  const embedFont = await pdfDoc.embedFont(font, { subset: true });

  // ── Embedovať logo ───────────────────────────────────────────────────────
  // Tenant logo môže byť PNG alebo JPEG (loader oba pustí) — formát určujeme
  // z magic bytes, nie z prípony/content-type. JPEG začína FF D8.
  const isJpeg = logo.length > 2 && logo[0] === 0xff && logo[1] === 0xd8;
  const logoImage = isJpeg ? await pdfDoc.embedJpg(logo) : await pdfDoc.embedPng(logo);

  // ── Kontextový objekt pre stránkovanie ───────────────────────────────────
  const ctx: RenderContext = {
    pdfDoc,
    paperSize,
    embedFont,
    logoImage,
    protocol,
    organisation,
  };

  // ── Rozdeliť položky na stránky ──────────────────────────────────────────
  const items = protocol.items;
  const itemPages: LoanProtocol['items'][] = [];
  for (let i = 0; i < Math.max(items.length, 1); i += PAGE_BREAK_ROWS) {
    itemPages.push(items.slice(i, i + PAGE_BREAK_ROWS));
  }

  // ── Vyrenderovať každú stránku ───────────────────────────────────────────
  for (let pageIdx = 0; pageIdx < itemPages.length; pageIdx++) {
    const page = pdfDoc.addPage([paperSize.width, paperSize.height]);
    const isFirst = pageIdx === 0;
    const isLast = pageIdx === itemPages.length - 1;
    const pageItems = itemPages[pageIdx] ?? [];

    drawHeader(ctx, page, isFirst);
    let cursorY = paperSize.height - MARGIN.top - HEADER_HEIGHT;

    if (isFirst) {
      cursorY = drawMetaBlock(ctx, page, cursorY);
      cursorY = drawPartiesBlock(ctx, page, cursorY);
    }

    cursorY = drawItemsTable(ctx, page, cursorY, pageItems, pageIdx + 1, itemPages.length);

    if (isLast) {
      drawSignatureBlock(ctx, page);
    }

    drawPageFooter(ctx, page, pageIdx + 1, itemPages.length);
  }

  // ── Serializovať ─────────────────────────────────────────────────────────
  const bytes = await pdfDoc.save({
    // Vypnúť objektovú kompresiu — zaručuje deterministickejší bajt-pre-bajt výstup.
    // (Zapnutá kompresia môže meniť vnútorné zarovnanie závislé od veľkosti objektov.)
    objectsPerTick: Infinity,
    useObjectStreams: false,
    addDefaultPage: false,
  });

  return bytes;
}

// ---------------------------------------------------------------------------
// Render kontext
// ---------------------------------------------------------------------------

interface RenderContext {
  pdfDoc: PDFDocument;
  paperSize: { width: number; height: number };
  embedFont: Awaited<ReturnType<PDFDocument['embedFont']>>;
  logoImage: Awaited<ReturnType<PDFDocument['embedPng']>>;
  protocol: LoanProtocol;
  organisation: Organisation;
}

// ---------------------------------------------------------------------------
// Pomocné funkcie kreslenia
// ---------------------------------------------------------------------------

/**
 * Nakreslí hlavičku: logo vľavo + org identita vpravo + horizontálna čiara.
 * Na prvej stránke plná hlavička, na ďalších stránkach kompaktná (len číslo protokolu).
 */
function drawHeader(ctx: RenderContext, page: PDFPage, isFirst: boolean): void {
  const { paperSize, embedFont, logoImage, organisation, protocol } = ctx;
  const usableWidth = paperSize.width - MARGIN.left - MARGIN.right;
  const headerTop = paperSize.height - MARGIN.top;

  if (isFirst) {
    // ── Logo ────────────────────────────────────────────────────────────────
    const logoMaxH = 40;
    const logoMaxW = 120;
    const logoDims = logoImage.scaleToFit(logoMaxW, logoMaxH);
    page.drawImage(logoImage, {
      x: MARGIN.left,
      y: headerTop - logoDims.height,
      width: logoDims.width,
      height: logoDims.height,
    });

    // ── Org identita (pravá strana) ─────────────────────────────────────────
    const rightX = paperSize.width - MARGIN.right;
    let orgY = headerTop - 12;

    drawText(page, embedFont, organisation.displayName, rightX, orgY, FONT_SIZE.subtitle, {
      color: COLOR.black,
      align: 'right',
      maxWidth: usableWidth / 2,
    });
    orgY -= 13;

    if (organisation.billing?.legalName) {
      drawText(page, embedFont, organisation.billing.legalName, rightX, orgY, FONT_SIZE.small, {
        color: COLOR.midGray,
        align: 'right',
        maxWidth: usableWidth / 2,
      });
      orgY -= 11;
    }

    const icoLine = [
      organisation.billing?.ico ? `IČO: ${organisation.billing.ico}` : null,
      organisation.billing?.dic ? `DIČ: ${organisation.billing.dic}` : null,
    ]
      .filter(Boolean)
      .join('  ·  ');

    if (icoLine) {
      drawText(page, embedFont, icoLine, rightX, orgY, FONT_SIZE.small, {
        color: COLOR.midGray,
        align: 'right',
      });
    }
  } else {
    // Kompaktná hlavička na ďalších stránkach
    drawText(
      page,
      embedFont,
      `${PROTOCOL_TYPE_LABEL[protocol.type]}  ${protocol.protocolNumber}`,
      MARGIN.left,
      headerTop - 12,
      FONT_SIZE.small,
      { color: COLOR.midGray },
    );
  }

  // ── Separator ───────────────────────────────────────────────────────────
  page.drawLine({
    start: { x: MARGIN.left, y: headerTop - HEADER_HEIGHT + 10 },
    end: { x: paperSize.width - MARGIN.right, y: headerTop - HEADER_HEIGHT + 10 },
    thickness: 0.5,
    color: COLOR.separator,
  });
}

/**
 * Nakreslí meta blok: typ protokolu (veľký nadpis), číslo, dátum vystavenia.
 * Vráti Y kurzor po bloku.
 */
function drawMetaBlock(ctx: RenderContext, page: PDFPage, startY: number): number {
  const { embedFont, protocol } = ctx;
  let y = startY - 6;

  drawText(page, embedFont, PROTOCOL_TYPE_LABEL[protocol.type], MARGIN.left, y, FONT_SIZE.title, {
    color: COLOR.black,
  });
  y -= 18;

  drawText(
    page,
    embedFont,
    `Číslo protokolu: ${protocol.protocolNumber}`,
    MARGIN.left,
    y,
    FONT_SIZE.body,
    { color: COLOR.darkGray },
  );
  y -= 13;

  drawText(
    page,
    embedFont,
    `Dátum vystavenia: ${formatDate(protocol.issuedAt)}`,
    MARGIN.left,
    y,
    FONT_SIZE.body,
    { color: COLOR.darkGray },
  );
  y -= 18;

  return y;
}

/**
 * Nakreslí blok strán (odovzdávajúci + preberajúci) vedľa seba.
 * Vráti Y kurzor po bloku.
 */
function drawPartiesBlock(ctx: RenderContext, page: PDFPage, startY: number): number {
  const { embedFont, paperSize, protocol } = ctx;
  const usableWidth = paperSize.width - MARGIN.left - MARGIN.right;
  const colW = (usableWidth - 20) / 2;
  let y = startY;

  // Titulky stĺpcov
  drawText(page, embedFont, 'Odovzdávajúci', MARGIN.left, y, FONT_SIZE.body, {
    color: COLOR.darkGray,
  });
  drawText(page, embedFont, 'Preberajúci', MARGIN.left + colW + 20, y, FONT_SIZE.body, {
    color: COLOR.darkGray,
  });
  y -= 13;

  // Meno
  drawText(
    page,
    embedFont,
    protocol.parties.handover.snapshot.displayName,
    MARGIN.left,
    y,
    FONT_SIZE.body,
    { color: COLOR.black, maxWidth: colW },
  );
  drawText(
    page,
    embedFont,
    protocol.parties.receive.snapshot.displayName,
    MARGIN.left + colW + 20,
    y,
    FONT_SIZE.body,
    { color: COLOR.black, maxWidth: colW },
  );
  y -= 12;

  // Email
  drawText(
    page,
    embedFont,
    protocol.parties.handover.snapshot.email,
    MARGIN.left,
    y,
    FONT_SIZE.small,
    { color: COLOR.midGray, maxWidth: colW },
  );
  drawText(
    page,
    embedFont,
    protocol.parties.receive.snapshot.email,
    MARGIN.left + colW + 20,
    y,
    FONT_SIZE.small,
    { color: COLOR.midGray, maxWidth: colW },
  );
  y -= 11;

  // Org. jednotka (ak je)
  const handoverUnit = protocol.parties.handover.snapshot.organizationalUnit;
  const receiveUnit = protocol.parties.receive.snapshot.organizationalUnit;

  if (handoverUnit || receiveUnit) {
    drawText(page, embedFont, handoverUnit ?? '', MARGIN.left, y, FONT_SIZE.small, {
      color: COLOR.midGray,
      maxWidth: colW,
    });
    drawText(page, embedFont, receiveUnit ?? '', MARGIN.left + colW + 20, y, FONT_SIZE.small, {
      color: COLOR.midGray,
      maxWidth: colW,
    });
    y -= 11;
  }

  y -= 10;

  // Separator
  page.drawLine({
    start: { x: MARGIN.left, y: y + 4 },
    end: { x: paperSize.width - MARGIN.right, y: y + 4 },
    thickness: 0.3,
    color: COLOR.separator,
  });

  y -= 8;
  return y;
}

/**
 * Nakreslí tabuľku položiek so stránkovaním.
 * Vráti Y kurzor po tabuľke.
 */
function drawItemsTable(
  ctx: RenderContext,
  page: PDFPage,
  startY: number,
  items: LoanProtocol['items'],
  pageNum: number,
  totalPages: number,
): number {
  const { embedFont, paperSize } = ctx;
  const usableWidth = paperSize.width - MARGIN.left - MARGIN.right;

  // Šírky stĺpcov (suma = usableWidth)
  const cols = {
    num: 24, // Č.
    invNum: 80, // Inv. číslo
    name: 0, // Názov (zvyšok)
    serial: 70, // Sér. číslo
    category: 65, // Kategória
    condition: 50, // Stav
  };
  cols.name = usableWidth - cols.num - cols.invNum - cols.serial - cols.category - cols.condition;

  let y = startY;

  // Titulok tabuľky
  if (pageNum === 1 || totalPages === 1) {
    drawText(page, embedFont, 'Zoznam majetku', MARGIN.left, y, FONT_SIZE.body, {
      color: COLOR.darkGray,
    });
    y -= 14;
  }

  // Záhlavie tabuľky
  page.drawRectangle({
    x: MARGIN.left,
    y: y - TABLE_HEADER_H + 4,
    width: usableWidth,
    height: TABLE_HEADER_H,
    color: COLOR.lightGray,
  });

  const headers = ['Č.', 'Inv. číslo', 'Názov', 'Sér. číslo', 'Kategória', 'Stav'];
  const colXs = getColXs(cols);

  headers.forEach((header, i) => {
    drawText(page, embedFont, header, colXs[i]! + 2, y, FONT_SIZE.tableHeader, {
      color: COLOR.darkGray,
      maxWidth: Object.values(cols)[i]! - 4,
    });
  });
  y -= TABLE_HEADER_H;

  // Riadky
  items.forEach((item, rowIdx) => {
    const rowY = y - TABLE_ROW_H + 4;

    // Striedanie pozadia riadkov
    if (rowIdx % 2 === 1) {
      page.drawRectangle({
        x: MARGIN.left,
        y: rowY,
        width: usableWidth,
        height: TABLE_ROW_H,
        color: rgb(0.96, 0.96, 0.96),
      });
    }

    const globalRowNum = (pageNum - 1) * PAGE_BREAK_ROWS + rowIdx + 1;
    const rowValues = [
      String(globalRowNum),
      item.snapshot.inventoryNumber,
      item.snapshot.name,
      item.snapshot.serialNumber ?? '—',
      item.snapshot.category,
      CONDITION_LABEL[item.condition] ?? item.condition,
    ];

    rowValues.forEach((val, i) => {
      drawText(page, embedFont, val, colXs[i]! + 2, y, FONT_SIZE.tableBody, {
        color: COLOR.black,
        maxWidth: Object.values(cols)[i]! - 4,
      });
    });

    y -= TABLE_ROW_H;
  });

  // Spodná čiara tabuľky
  page.drawLine({
    start: { x: MARGIN.left, y },
    end: { x: paperSize.width - MARGIN.right, y },
    thickness: 0.3,
    color: COLOR.separator,
  });

  y -= 6;
  return y;
}

/**
 * Nakreslí podpisové bloky na poslednú stránku (pri spodku strany).
 * DRAFT: prázdne podpisové riadky. SIGNED: podpis + dátum.
 */
function drawSignatureBlock(ctx: RenderContext, page: PDFPage): void {
  const { embedFont, paperSize, protocol } = ctx;
  const usableWidth = paperSize.width - MARGIN.left - MARGIN.right;
  const colW = (usableWidth - 30) / 2;
  const sigBaseY = MARGIN.bottom + FOOTER_HEIGHT;

  const sides: Array<{
    label: string;
    name: string;
    sig: LoanProtocol['signatures']['handover'];
    x: number;
  }> = [
    {
      label: 'Odovzdávajúci',
      name: protocol.parties.handover.snapshot.displayName,
      sig: protocol.signatures.handover,
      x: MARGIN.left,
    },
    {
      label: 'Preberajúci',
      name: protocol.parties.receive.snapshot.displayName,
      sig: protocol.signatures.receive,
      x: MARGIN.left + colW + 30,
    },
  ];

  // Separator nad podpismi
  page.drawLine({
    start: { x: MARGIN.left, y: sigBaseY + 60 },
    end: { x: paperSize.width - MARGIN.right, y: sigBaseY + 60 },
    thickness: 0.3,
    color: COLOR.separator,
  });

  sides.forEach(({ label, name, sig, x }) => {
    drawText(page, embedFont, label, x, sigBaseY + 50, FONT_SIZE.small, {
      color: COLOR.darkGray,
    });
    drawText(page, embedFont, name, x, sigBaseY + 38, FONT_SIZE.body, { color: COLOR.black });

    if (sig) {
      // SIGNED — zobraz dátum a metódu podpisu
      drawText(
        page,
        embedFont,
        `Podpísané: ${formatDate(sig.signedAt)}`,
        x,
        sigBaseY + 24,
        FONT_SIZE.small,
        { color: COLOR.midGray },
      );
      const methodLabel =
        sig.method === 'CLICK_TO_SIGN'
          ? 'Elektronický súhlas'
          : sig.method === 'BIOMETRIC'
            ? 'Biometrický podpis'
            : 'Externý podpis';
      drawText(page, embedFont, methodLabel, x, sigBaseY + 13, FONT_SIZE.small, {
        color: COLOR.midGray,
      });
    } else {
      // DRAFT — prázdny podpisový riadok
      page.drawLine({
        start: { x, y: sigBaseY + 16 },
        end: { x: x + colW, y: sigBaseY + 16 },
        thickness: 0.5,
        color: COLOR.midGray,
      });
      drawText(page, embedFont, 'Podpis', x, sigBaseY + 6, FONT_SIZE.small, {
        color: COLOR.midGray,
      });
    }
  });
}

/**
 * Nakreslí pätku: číslo stránky + info o stave protokolu.
 */
function drawPageFooter(
  ctx: RenderContext,
  page: PDFPage,
  pageNum: number,
  totalPages: number,
): void {
  const { embedFont, paperSize, protocol } = ctx;
  const footerY = MARGIN.bottom - 10;

  drawText(
    page,
    embedFont,
    `Strana ${pageNum} / ${totalPages}`,
    MARGIN.left,
    footerY,
    FONT_SIZE.small,
    { color: COLOR.midGray },
  );

  const statusLabel =
    protocol.status === 'DRAFT'
      ? 'NÁVRH — nepodpísaný'
      : protocol.status === 'SIGNED'
        ? 'PODPÍSANÝ'
        : protocol.status === 'AMENDED'
          ? 'NAHRADENÝ DODATKOM'
          : 'ANULOVANÝ';

  drawText(
    page,
    embedFont,
    `Stav: ${statusLabel}`,
    paperSize.width - MARGIN.right,
    footerY,
    FONT_SIZE.small,
    { color: COLOR.midGray, align: 'right' },
  );
}

// ---------------------------------------------------------------------------
// Nízkoúrovňové pomocné funkcie
// ---------------------------------------------------------------------------

interface DrawTextOptions {
  color?: ReturnType<typeof rgb>;
  align?: 'left' | 'right';
  maxWidth?: number;
}

/**
 * Nakreslí text na stránku. Podporuje zarovnanie vpravo a orezanie na maxWidth.
 * Ak text presiahne maxWidth, orezaný s "…".
 */
function drawText(
  page: PDFPage,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  text: string,
  x: number,
  y: number,
  size: number,
  opts: DrawTextOptions = {},
): void {
  const { color = COLOR.black, align = 'left', maxWidth } = opts;

  let displayText = text;

  if (maxWidth !== undefined) {
    // Orezanie textu ak presahuje maxWidth
    while (displayText.length > 0) {
      const w = font.widthOfTextAtSize(displayText, size);
      if (w <= maxWidth) break;
      displayText = displayText.slice(0, -1);
    }
    if (displayText.length < text.length && displayText.length > 0) {
      // Pridaj ellipsis (ale len ak tam je miesto)
      displayText = displayText.slice(0, -1) + '…';
    }
  }

  const textWidth = font.widthOfTextAtSize(displayText, size);
  const drawX = align === 'right' ? x - textWidth : x;

  page.drawText(displayText, {
    x: drawX,
    y,
    size,
    font,
    color,
  });
}

/**
 * Vypočíta X pozície stĺpcov z mapy šírok (v poradí aké sú definované).
 */
function getColXs(cols: Record<string, number>): number[] {
  const xs: number[] = [];
  let x = MARGIN.left;
  for (const w of Object.values(cols)) {
    xs.push(x);
    x += w;
  }
  return xs;
}

/**
 * Formátuje ISO dátum na slovenský formát „D. M. YYYY" (bez číslic navyše).
 * Deterministický — nepoužíva `toLocaleDateString` (závisí od locale).
 */
function formatDate(isoString: string): string {
  const d = new Date(isoString);
  const day = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  return `${day}. ${month}. ${year}`;
}
