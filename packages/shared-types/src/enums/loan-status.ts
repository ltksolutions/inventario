// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Stavy žiadosti o zápožičku (ADR-0026 — katalógové žiadosti + oddelené vydávanie).
 *
 * Životný cyklus:
 *   PENDING → APPROVED → PARTIALLY_FULFILLED → FULFILLED
 *                      → FULFILLED             (vydanie pokrylo celé množstvo)
 *                      → CLOSED               (správca uzavrel, zvyšok prepadol)
 *   PENDING → REJECTED
 *   PENDING → CANCELLED (zrušil žiadateľ)
 *
 * Approve = „beriem do riešenia" — nevytvára Loan.
 * Vydanie cez POST /v1/loan-requests/:id/fulfil → vznik Loan-u.
 * 1 žiadosť → N Loanov postupne (resultingLoanIds[]).
 */
export const LoanRequestStatus = {
  /** Vytvorená, čaká na rozhodnutie správcu. */
  PENDING: 'PENDING',
  /** Schválená, ešte nič nevydané — čaká na (prvé) vydanie. */
  APPROVED: 'APPROVED',
  /** Aspoň jedno vydanie prebehlo, žiadosť ostáva otvorená (zvyšok nevydaný). */
  PARTIALLY_FULFILLED: 'PARTIALLY_FULFILLED',
  /** Vydané celé žiadané množstvo (alebo správca uzavrel ako vybavené). */
  FULFILLED: 'FULFILLED',
  /** Správca uzavrel s nevydaným zvyškom — zvyšok prepadol. Terminálny. */
  CLOSED: 'CLOSED',
  /** Zamietnutá správcom pred akýmkoľvek vydaním. Terminálny. */
  REJECTED: 'REJECTED',
  /** Zrušená žiadateľom pred akýmkoľvek vydaním. Terminálny. */
  CANCELLED: 'CANCELLED',
} as const;

export type LoanRequestStatus = (typeof LoanRequestStatus)[keyof typeof LoanRequestStatus];

export const LOAN_REQUEST_STATUS_VALUES = Object.values(
  LoanRequestStatus,
) as readonly LoanRequestStatus[];

/** Terminálne stavy žiadosti — ďalšie prechody nie sú možné. */
export const LOAN_REQUEST_TERMINAL_STATUSES: readonly LoanRequestStatus[] = [
  LoanRequestStatus.FULFILLED,
  LoanRequestStatus.CLOSED,
  LoanRequestStatus.REJECTED,
  LoanRequestStatus.CANCELLED,
] as const;

/**
 * Stavy aktívnej zápožičky.
 *
 * Životný cyklus:
 *   ACTIVE → RETURNED (vrátené v poriadku)
 *   ACTIVE → OVERDUE → RETURNED
 *   ACTIVE → OVERDUE → LOST
 *   ACTIVE → DAMAGED (vrátené poškodené, ide na servis)
 *   ACTIVE/OVERDUE → PARTIALLY_RETURNED → RETURNED/DAMAGED (čiastočné vrátenie,
 *   ADR-0036 — aspoň 1 kus vrátený, aspoň 1 stále u používateľa; anticipované,
 *   ale neimplementované už v ADR-0020, rozšírené aj na SERIALIZED v ADR-0036)
 */
export const LoanStatus = {
  /** Aktívna zápožička, položka je u používateľa. */
  ACTIVE: 'ACTIVE',
  /** Termín vrátenia uplynul, ešte nevrátené. */
  OVERDUE: 'OVERDUE',
  /**
   * Časť kusov vrátená, časť stále u používateľa (ADR-0036). Kus je vrátený
   * ⇔ `LoanItem.condition.atReturn !== null` — tento stav sa neukladá
   * nezávisle, počíta sa vždy nanovo z `items[]` v tej istej transakcii.
   */
  PARTIALLY_RETURNED: 'PARTIALLY_RETURNED',
  /** Úspešne vrátené v poriadku. */
  RETURNED: 'RETURNED',
  /** Vrátené, ale poškodené — vyžaduje servis. */
  DAMAGED: 'DAMAGED',
  /** Stratené, nevrátené. */
  LOST: 'LOST',
} as const;

export type LoanStatus = (typeof LoanStatus)[keyof typeof LoanStatus];

export const LOAN_STATUS_VALUES = Object.values(LoanStatus) as readonly LoanStatus[];
