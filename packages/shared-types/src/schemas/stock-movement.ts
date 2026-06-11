// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { z } from 'zod';

import { StockMovementType } from '../enums/stock-movement-type.js';

import { BaseDocumentSchema, ObjectIdSchema, OrganisationScopedSchema } from './common.js';

/**
 * StockMovement = jeden záznam v skladovom ledgeri hromadnej (BULK) položky.
 *
 * Ledger je **append-only** a je **zdrojom pravdy** pre skladové množstvo
 * (ADR-0020): `quantityOnHand` na položke je len cache, ktorú vie service
 * kedykoľvek overiť/rekonštruovať ako `sum(stock_movements.quantity)` pre
 * danú položku.
 *
 * Append-only ⇒ záznamy sa nikdy nemenia ani nemažú z aplikačnej úrovne
 * (preto NEMÁ `SoftDelete`). `updatedAt`/`updatedBy` z `BaseDocument` sa
 * pri vzniku nastavia rovnako ako `createdAt`/`createdBy` a ďalej sa
 * nemenia — koncepčne je dôležitý len okamih vzniku pohybu a kto ho zaúčtoval.
 *
 * Pohyb sa vždy zapisuje v jednej Mongo transakcii spolu s `$inc`
 * aktualizáciou `quantityOnHand` na položke a s audit log záznamom.
 */
export const StockMovementSchema = BaseDocumentSchema.merge(OrganisationScopedSchema).extend({
  /** Položka, ktorej sa pohyb týka. Musí mať `trackingMode === 'BULK'`. */
  itemId: ObjectIdSchema,

  /** Druh pohybu. */
  type: z.enum(
    Object.values(StockMovementType) as [string, ...string[]],
  ) as z.ZodType<StockMovementType>,

  /**
   * Znamienkové množstvo (delta). Kladné pripočítava na sklad (RECEIPT,
   * LOAN_RETURN), záporné odpočítava (LOAN_OUT). ADJUSTMENT môže byť kladné
   * aj záporné. Nesmie byť 0. `sum(quantity)` cez všetky pohyby položky =
   * aktuálny `quantityOnHand`.
   */
  quantity: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Množstvo pohybu nesmie byť nula.'),

  /**
   * Zostatok na sklade po tomto pohybe (cache pre audit a rýchle zobrazenie
   * histórie). Vždy `>= 0` — service nedovolí pohyb, ktorý by stav stiahol
   * pod nulu (okrem budúceho WRITE_OFF vo Fáze 2).
   */
  balanceAfter: z.number().int().nonnegative(),

  /**
   * Dôvod pohybu. Povinný pri `ADJUSTMENT` (ručná korekcia musí byť
   * vysvetlená) — túto podmienku vynucuje service/route vrstva, nie schéma.
   */
  reason: z.string().max(1000).nullable().default(null),

  /** Ak pohyb súvisí so zápožičkou (LOAN_OUT / LOAN_RETURN), jej ID. Inak null. */
  loanId: ObjectIdSchema.nullable().default(null),

  /** Lokalita/sklad, ktorého sa pohyb týka. */
  locationId: ObjectIdSchema,

  /** Voliteľná poznámka. */
  note: z.string().max(1000).nullable().default(null),
});

export type StockMovement = z.infer<typeof StockMovementSchema>;

/**
 * Vytvorenie pohybu cez API. Server doplní identitu, tenant scope, audit
 * polia a vypočíta `balanceAfter` v rámci transakcie — preto sú vynechané.
 */
export const CreateStockMovementSchema = StockMovementSchema.omit({
  _id: true,
  organisationId: true, // Server-provided from authenticated context
  balanceAfter: true, // Server-computed inside the transaction
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
});

export type CreateStockMovementInput = z.infer<typeof CreateStockMovementSchema>;
