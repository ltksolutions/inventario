// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Zdieľané chybové hlášky pre `?error=` banner na `/login` aj `/tenant-login`
 * (ADR-0035 F6) — vytiahnuté z `LoginPage.tsx`, aby oba povrchy hlásili
 * rovnaký text pre rovnaký error kód. OAuth callback (`oauth.routes.ts`)
 * vždy presmeruje na canonical `FRONTEND_BASE_URL/login?error=...`, takže
 * `/tenant-login` v praxi tento banner nezobrazí — ponechané pre
 * konzistenciu a pre prípad priameho odkazu s `?error=`.
 */
export const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  oauth_failed: 'Prihlásenie cez SSO zlyhalo. Skúste znova.',
  access_denied: 'Prístup bol zamietnutý.',
  invalid_state: 'Neplatná session. Skúste sa prihlásiť znova.',
  account_exists: 'Tento účet je už zaregistrovaný cez iného poskytovateľa.',
  invalid_verification_token: 'Neplatný overovací odkaz.',
  verification_token_expired: 'Overovací odkaz vypršal. Zaregistrujte sa znova.',
  // ADR-0035 F2 — organizácia má obmedzené povolené metódy prihlásenia
  // (napr. len Microsoft) a použitá metóda/adresár nie je medzi povolenými.
  provider_not_allowed: 'Vaša organizácia nepovoľuje túto metódu prihlásenia.',
  entra_tenant_mismatch: 'Prihlásili ste sa cez nesprávny Microsoft adresár pre svoju organizáciu.',
};
