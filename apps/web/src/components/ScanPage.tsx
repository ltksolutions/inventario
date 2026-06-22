// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * ScanPage — verejná "found asset" stránka (ADR-0021 K5).
 *
 * Prístupná bez prihlásenia. Zobrazí minimálne info o majetku
 * a kontakt na vrátenie. Ak tenant nemá publicAssetLookup=true
 * alebo token neexistuje, API vráti 404 → zobrazíme prázdny stav.
 *
 * Úmyselne jednoduchý dizajn — prístupné aj z tlačeného QR štítku
 * na mobilnom zariadení nálezcu.
 */

import { AlertCircle, Building2, Mail, Phone } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { LoadingState } from './Spinner';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PublicAssetView {
  organisationName: string;
  organisationLogoUrl: string | null;
  foundContact: {
    email: string | null;
    phone: string | null;
    message: string | null;
  } | null;
}

type ScanState =
  | { status: 'loading' }
  | { status: 'found'; asset: PublicAssetView }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScanPage({ publicToken }: { publicToken: string }) {
  const [state, setState] = useState<ScanState>({ status: 'loading' });
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Krok 1: ak je nálezca prihlásený člen tenanta, presmeruj na interný
      // detail majetku (rýchle vyžiadanie/vrátenie). Token rozlíšime cez
      // autentifikovaný endpoint; 401/404 = spadni na verejný lost&found.
      try {
        const authed = await fetch(
          `${API_BASE}/v1/assets/by-token/${encodeURIComponent(publicToken)}`,
          { credentials: 'include' },
        );
        if (cancelled) return;
        if (authed.ok) {
          const { id } = (await authed.json()) as { id: string };
          router.replace(`/assets/${id}`);
          return; // ostáva 'loading' kým prebehne presmerovanie
        }
      } catch {
        // ignoruj — pokračuj na verejný view
      }

      // Krok 2: verejná lost&found stránka (neprihlásený nálezca)
      try {
        const res = await fetch(`${API_BASE}/v1/public/scan/${encodeURIComponent(publicToken)}`);
        if (cancelled) return;

        if (res.status === 404) {
          setState({ status: 'not_found' });
          return;
        }

        if (!res.ok) {
          setState({ status: 'error', message: `Chyba servera (${res.status})` });
          return;
        }

        const data = (await res.json()) as PublicAssetView;
        setState({ status: 'found', asset: data });
      } catch {
        if (!cancelled) {
          setState({ status: 'error', message: 'Nepodarilo sa načítať údaje.' });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [publicToken, router]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center pt-12 px-4">
      <div className="w-full max-w-md">
        {state.status === 'loading' && <LoadingView />}
        {state.status === 'not_found' && <NotFoundView />}
        {state.status === 'error' && <ErrorView message={state.message} />}
        {state.status === 'found' && <FoundView asset={state.asset} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-views
// ---------------------------------------------------------------------------

function LoadingView() {
  return <LoadingState className="py-16" label="Načítavam..." />;
}

function NotFoundView() {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
      <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
      <h1 className="text-lg font-semibold text-gray-800 mb-2">Majetok sa nenašiel</h1>
      <p className="text-sm text-gray-500">
        Tento QR kód nevedie na žiadny evidovaný majetok, alebo organizácia nemá zapnutý verejný
        lookup.
      </p>
    </div>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-8 text-center">
      <AlertCircle className="w-12 h-12 text-red-300 mx-auto mb-4" />
      <h1 className="text-lg font-semibold text-gray-800 mb-2">Chyba</h1>
      <p className="text-sm text-gray-500">{message}</p>
    </div>
  );
}

function FoundView({ asset }: { asset: PublicAssetView }) {
  const { organisationName, organisationLogoUrl, foundContact } = asset;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="bg-blue-600 px-6 py-5 text-white">
        <div className="flex items-center gap-3 mb-1">
          {organisationLogoUrl ? (
            <Image
              src={organisationLogoUrl}
              alt={organisationName}
              width={32}
              height={32}
              unoptimized
              className="rounded object-contain bg-white/20 p-1"
            />
          ) : (
            <Building2 className="w-6 h-6 opacity-80" />
          )}
          <span className="text-sm font-medium opacity-90">{organisationName}</span>
        </div>
        <p className="text-xs opacity-70 mt-1">Našli ste náš majetok</p>
      </div>

      {/* Contact */}
      <div className="px-6 py-5">
        <p className="text-sm font-medium text-gray-700 mb-3">Kontakt na vrátenie</p>

        {foundContact ? (
          <div className="space-y-3">
            {foundContact.message && (
              <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-4 py-3 leading-relaxed">
                {foundContact.message}
              </p>
            )}
            {foundContact.email && (
              <a
                href={`mailto:${foundContact.email}`}
                className="flex items-center gap-3 text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                <Mail className="w-4 h-4 shrink-0" />
                {foundContact.email}
              </a>
            )}
            {foundContact.phone && (
              <a
                href={`tel:${foundContact.phone}`}
                className="flex items-center gap-3 text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                <Phone className="w-4 h-4 shrink-0" />
                {foundContact.phone}
              </a>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400 italic">
            Organizácia nezadala kontaktné informácie. Skúste ich vyhľadať priamo.
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 bg-gray-50 border-t border-gray-100">
        <p className="text-xs text-gray-400 text-center">
          Evidencia majetku powered by{' '}
          <a
            href="https://inventario.estate"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            Inventario
          </a>
        </p>
      </div>
    </div>
  );
}
