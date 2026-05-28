<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-05-28 — Production Smoke Test Day 2

**Model:** Sonnet 4.6  
**Trvanie:** ~4 hodiny  
**Výsledok:** Produkcia stabilizovaná, nové MongoDB clustre, viacero bugfixov

---

## Čo sme riešili

### 1. MongoDB migrácia na čisté Inventario clustre

Pôvodné `sfz-asset-mgmt-dev` a `sfz-asset-mgmt-prod` clustre boli v SFZ Atlas účte so SFZ-specific názvami a DB `sfz_asset_management`. Vytvorili sme nové čisté clustre v novom Inventario MongoDB účte:

- `inventario-dev` → lokálny dev + CI
- `inventario-prod` → Vercel produkcia
- DB name: `inventario`

Aktualizované: `.env.local`, Vercel env vars, GitHub CI secret.

### 2. Systémový problém so sparse indexmi

Rovnaký bug na viacerých kolekciách — MongoDB `sparse: true` indexuje aj dokumenty kde pole existuje ako `null` (iba chýbajúce polia vynecháva). Výsledok: E11000 pri druhej registrácii.

**Opravené:**

- `organisations.customDomain_unique_sparse` → `customDomain_unique_partial`
- `organisations.entraTenantId_unique_sparse` → `entraTenantId_unique_partial`
- `users.entraOid_unique` → `entraOid_unique_partial`
- `invitations.invitations_token_unique_sparse` → `invitations_token_unique_partial`

**Pattern:** Všetky nullable unique indexy musia mať `partialFilterExpression: { field: { $type: 'string' } }` namiesto `sparse: true`.

Migration file: `apps/api/src/migrations/2026-05-25-fix-org-custom-domain-index.ts`

### 3. Verifikačný email — zlý apiBase URL

`OAUTH_REDIRECT_BASE_URL` = `https://api.inventario.estate/v1/auth/callback`

Kód používal túto hodnotu priamo ako `apiBase` → link v emaili bol:
`https://api.inventario.estate/v1/auth/callback/v1/auth/verify-email?token=...`

Fix: strip OAuth callback path cez `.replace(/\/v1\/auth\/callback.*$/, '')`.

### 4. Logout nemaval cookies v produkcii

`clearCookie` bez `domain`, `secure`, `sameSite` parametrov. Browser ignoruje `clearCookie` ak cookie bola nastavená s iným domain.

Fix: pridané `domain: '.inventario.estate'`, `secure: true`, `sameSite: 'lax'` do `clearCookie` volania.

### 5. Email notifikácie výpožičiek

Pridané 3 nové email templates + implementácia:

- `sendLoanApprovedEmail` — žiadateľovi po schválení
- `sendLoanRejectedEmail` — žiadateľovi po zamietnutí
- `sendLoanRequestPendingEmail` — manažérom pri novej žiadosti

`LoansService` rozšírený o `emailService` + `frontendUrl` parametry. Fire-and-forget pattern (neblokujú transakciu).

### 6. Asset detail redesign v2

Nový layout bližší k marketing site mockupu:

- 2-col grid: hero karta (lg:col-span-2) + QR kód karta
- Reálny QR kód cez `qrcode-generator` CDN (nie placeholder ikona)
- Taby v jednej karte s border-bottom aktívnym tabom
- Súvisiace — karty s hover efektom a `ChevronRight` transition
- Loan history — farebný timeline s dot farbami podľa stavu

### 7. MFA spinner po aktivácii

`useState(() => { void loadStatus(); })` — React `useState` neberie callback ako side effect (to je `useEffect`). MFA status sa nikdy nenačítal po refreshi → spinner navždy.

Fix: `useEffect(() => { void loadStatus(); }, [])`.

---

## Commity

```
fix(api): sparse->partialFilter na users.entraOid + invitations.token indexoch
fix(api): oprav entraOid_unique sparse index na users — partialFilterExpression
fix(api): refresh route vždy registrovaná + registration Membership + mid claim
fix(api): logout cookie domain fix + email notifikacie vypoziciek
feat(web): asset detail redesign v2 — 2-col hero, reálny QR kód, súvisiace karty
fix(web): useState -> useEffect pre MFA status load — spinner po aktivacii MFA
docs(api): oprav verifikacny email apiBase URL — strip OAuth callback path
```

---

## Otvorené položky

1. **`email_unique` globálny index na `users`** — blokuje viacero tenanntov s rovnakým emailom. Treba opraviť pred SFZ onboardingom.
2. **Staré SFZ clustre zmazať** — manuálne v Atlas UI po overení prod funkčnosti.
3. **Smoke test kroky 4-8** — s kolegom.
4. **SFZ onboarding** — user `inventario@futbalsfz.sk`, emailVerified nastavený, treba otestovať login.
