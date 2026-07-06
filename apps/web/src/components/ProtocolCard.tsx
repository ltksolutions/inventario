// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * ProtocolCard — karta preberacieho protokolu (ADR-0022).
 *
 * Zobrazuje číslo, typ, stav, strany a stav podpisov. Akcie:
 *   - „PDF" — stiahne PDF cez autentifikovaný fetch a otvorí v novej
 *     karte (tlač cez natívny PDF viewer prehliadača). DRAFT render má
 *     vodoznak „NÁVRH — nepodpísaný", takže nepodpísaná verzia sa nedá
 *     vydávať za finálnu.
 *   - „Potvrdiť prevzatie/odovzdanie" — CLICK_TO_SIGN podpis. Tlačidlo
 *     vidí len prihlásený používateľ, ktorý je danou stranou protokolu
 *     a ešte nepodpísal. Podpis prebieha cez potvrdzovací modal so
 *     zhrnutím položiek a povinným checkboxom.
 */

import { CheckCircle2, Clock, FileText, Loader2, PenLine, X } from 'lucide-react';
import { useState } from 'react';

import type { LoanProtocolSummary } from '@/lib/api-hooks';
import type { JSX } from 'react';

import { fetchProtocolPdf, useSignProtocol } from '@/lib/api-hooks';
import { cn } from '@/lib/cn';
import { useConditionLabel } from '@/lib/conditions';

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const PROTOCOL_TYPE_LABELS: Record<string, string> = {
  HANDOVER: 'Preberací protokol',
  RETURN: 'Protokol o vrátení',
  AMENDMENT: 'Dodatok',
};

export const PROTOCOL_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  DRAFT: {
    label: 'Podpísať',
    className: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  },
  SIGNED: { label: 'Podpísaný', className: 'bg-green-50 text-green-700 ring-green-600/20' },
  AMENDED: {
    label: 'Nahradený dodatkom',
    className: 'bg-surface-subtle text-text-muted ring-border-subtle',
  },
  VOIDED: { label: 'Zrušený', className: 'bg-red-50 text-red-700 ring-red-600/20' },
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('sk-SK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// PDF helper — autentifikovaný fetch + otvorenie v novej karte
// ---------------------------------------------------------------------------

export function ProtocolPdfButton({
  protocolId,
  className,
}: {
  protocolId: string;
  className?: string | undefined;
}): JSX.Element {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen(): Promise<void> {
    setError(null);
    setLoading(true);
    try {
      const blob = await fetchProtocolPdf(protocolId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      // Blob URL uvoľníme s odstupom — nová karta si ho medzitým načíta.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF sa nepodarilo stiahnuť.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void handleOpen()}
        disabled={loading}
        title="Otvorí PDF protokolu v novej karte — odtiaľ možno tlačiť"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-card px-2.5 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-surface-subtle hover:text-text-primary disabled:opacity-50',
          className,
        )}
      >
        {loading ? (
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <FileText aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        Tlač
      </button>
      {error && <span className="text-xs text-danger-fg">{error}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sign modal
// ---------------------------------------------------------------------------

function SignProtocolModal({
  protocol,
  side,
  onClose,
}: {
  protocol: LoanProtocolSummary;
  side: 'handover' | 'receive';
  onClose: () => void;
}): JSX.Element {
  const sign = useSignProtocol();
  const conditionLabel = useConditionLabel();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReceive = side === 'receive';
  const actionLabel = isReceive ? 'Potvrdiť prevzatie' : 'Potvrdiť odovzdanie';
  const confirmText = isReceive
    ? 'Potvrdzujem, že som uvedené položky prevzal/-a v uvedenom stave.'
    : 'Potvrdzujem, že som uvedené položky odovzdal/-a v uvedenom stave.';

  function handleSign(): void {
    setError(null);
    sign.mutate(
      { protocolId: protocol._id },
      {
        onSuccess: () => onClose(),
        onError: (e) => setError(e.message),
      },
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sign-modal-title"
    >
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-lg rounded-xl border border-border-subtle bg-surface-card p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="sign-modal-title" className="text-lg font-semibold text-text-primary">
              {actionLabel}
            </h2>
            <p className="mt-0.5 text-sm text-text-secondary">
              {PROTOCOL_TYPE_LABELS[protocol.type] ?? protocol.type} {protocol.protocolNumber}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zavrieť"
            className="rounded-lg p-1.5 text-text-muted transition hover:bg-surface-subtle hover:text-text-primary"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        {/* Zhrnutie položiek */}
        <div className="mb-4 max-h-60 overflow-y-auto rounded-lg border border-border-subtle">
          <table className="w-full text-sm">
            <thead className="border-b border-border-subtle bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Položka
                </th>
                <th scope="col" className="px-3 py-2">
                  Stav
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {protocol.items.map((item) => (
                <tr key={item.assetId}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-text-primary">
                      {item.snapshot.inventoryNumber}
                    </span>
                    <span className="ml-1.5 text-text-secondary">{item.snapshot.name}</span>
                  </td>
                  <td className="px-3 py-2 text-text-secondary">
                    {conditionLabel(item.condition)}
                    {item.conditionNote ? (
                      <span className="ml-1 text-xs text-text-muted">({item.conditionNote})</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <label className="mb-4 flex items-start gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border-default"
          />
          <span>{confirmText}</span>
        </label>

        <p className="mb-4 text-xs text-text-muted">
          Podpis sa zaznamená elektronicky (čas, IP adresa, metóda CLICK_TO_SIGN). Po podpise oboch
          strán sa protokol uzamkne a stane sa záväzným.
        </p>

        {error && (
          <p role="alert" className="mb-3 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border-default bg-surface-card px-4 py-2 text-sm font-medium text-text-secondary transition hover:bg-surface-subtle"
          >
            Zrušiť
          </button>
          <button
            type="button"
            onClick={handleSign}
            disabled={!confirmed || sign.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
          >
            {sign.isPending ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <PenLine aria-hidden="true" className="h-4 w-4" />
            )}
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function PartyRow({
  roleLabel,
  party,
  signature,
}: {
  roleLabel: string;
  party: LoanProtocolSummary['parties']['handover'];
  signature: LoanProtocolSummary['signatures']['handover'];
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span>
        <span className="text-text-muted">{roleLabel}:</span>{' '}
        <span className="font-medium text-text-primary">
          {party.snapshot.displayName || party.snapshot.email || '—'}
        </span>
      </span>
      {signature ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
          Podpísané {formatDateTime(signature.signedAt)}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-text-muted">
          <Clock aria-hidden="true" className="h-3.5 w-3.5" />
          Čaká na podpis
        </span>
      )}
    </div>
  );
}

export function ProtocolCard({
  protocol,
  currentUserId,
}: {
  protocol: LoanProtocolSummary;
  currentUserId: string;
}): JSX.Element {
  const [signOpen, setSignOpen] = useState(false);

  const statusConfig = PROTOCOL_STATUS_CONFIG[protocol.status] ?? {
    label: protocol.status,
    className: 'bg-surface-subtle text-text-muted ring-border-subtle',
  };

  // Ktorou stranou je prihlásený používateľ — a môže ešte podpísať?
  // Užívateľ môže byť OBE strany (priama výpožička sebe samému) — vyberáme
  // prvú JEHO stranu, ktorá ešte nepodpísala, nie prvú jeho stranu vôbec.
  const isHandoverParty = protocol.parties.handover.userId === currentUserId;
  const isReceiveParty = protocol.parties.receive.userId === currentUserId;
  const mySide: 'handover' | 'receive' | null =
    protocol.status !== 'DRAFT'
      ? null
      : isHandoverParty && !protocol.signatures.handover
        ? 'handover'
        : isReceiveParty && !protocol.signatures.receive
          ? 'receive'
          : null;
  const canSign = mySide !== null;

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-text-primary">
            {PROTOCOL_TYPE_LABELS[protocol.type] ?? protocol.type}{' '}
            <span className="font-mono text-text-secondary">{protocol.protocolNumber}</span>
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            Vystavený {formatDateTime(protocol.issuedAt)} · {protocol.items.length} položiek
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset',
            statusConfig.className,
          )}
        >
          {statusConfig.label}
        </span>
      </div>

      <div className="mb-3 flex flex-col gap-1.5">
        <PartyRow
          roleLabel="Odovzdávajúci"
          party={protocol.parties.handover}
          signature={protocol.signatures.handover}
        />
        <PartyRow
          roleLabel="Preberajúci"
          party={protocol.parties.receive}
          signature={protocol.signatures.receive}
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle pt-3">
        <ProtocolPdfButton protocolId={protocol._id} />
        {canSign && (
          <button
            type="button"
            onClick={() => setSignOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90"
          >
            <PenLine aria-hidden="true" className="h-3.5 w-3.5" />
            {mySide === 'receive' ? 'Potvrdiť prevzatie' : 'Potvrdiť odovzdanie'}
          </button>
        )}
      </div>

      {signOpen && mySide && (
        <SignProtocolModal protocol={protocol} side={mySide} onClose={() => setSignOpen(false)} />
      )}
    </div>
  );
}
