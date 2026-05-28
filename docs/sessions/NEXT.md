<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                            |
| ------------------------- | -------------------------------------------------- |
| **Posledná aktualizácia** | 2026-05-28 (Production smoke test + bugfixy day 2) |
| **Aktuálna fáza**         | Production LIVE — smoke test s kolegom pending     |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`      |
| **GitHub**                | https://github.com/ltksolutions/inventario         |

---

## Čo sme spravili 2026-05-28

### MongoDB migrácia na čisté Inventario clustre ✅

| Starý cluster         | Nový cluster      | Použitie               |
| --------------------- | ----------------- | ---------------------- |
| `sfz-asset-mgmt-dev`  | `inventario-dev`  | Lokálny dev + CI testy |
| `sfz-asset-mgmt-prod` | `inventario-prod` | Vercel produkcia       |

- Nové clustre v novom MongoDB účte (nie SFZ)
- DB name: `inventario` (pôvodné bolo `sfz_asset_management`)
- `.env.local` aktualizovaný
- Vercel env vars aktualizované
- GitHub CI secret `MONGO_URI_TEST` aktualizovaný
- **TODO: Zmazať staré `sfz-asset-mgmt-dev` a `sfz-asset-mgmt-prod` clustre** (v SFZ Atlas účte)

### Bugfixy ✅

| #   | Problém                                                                  | Fix                                                                             |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 1   | `entraOid_unique` sparse index na `users` — E11000 pri registrácii       | `partialFilterExpression: { entraOid: { $type: 'string' } }`                    |
| 2   | `invitations.token` sparse index — rovnaký problém                       | `partialFilterExpression`                                                       |
| 3   | Verifikačný email — zlý `apiBase` URL (obsahoval OAuth callback path)    | Strip `/v1/auth/callback` z URL                                                 |
| 4   | Logout — cookies sa nemazmali v produkcii                                | `clearCookie` s `domain`, `secure`, `sameSite`                                  |
| 5   | Email notifikácie výpožičiek                                             | `sendLoanApprovedEmail`, `sendLoanRejectedEmail`, `sendLoanRequestPendingEmail` |
| 6   | Asset detail redesign v2                                                 | 2-col hero, reálny QR kód (qrcode-generator CDN), taby v karte                  |
| 7   | MFA spinner po aktivácii                                                 | `useState` → `useEffect` pre MFA status load                                    |
| 8   | `email_unique` globálny index blokoval viacero userov s rovnakým emailom | Systémový index, treba riešiť pri prvom multi-tenant onboardingu                |

---

## Stav na 2026-05-28

### 📊 Globálny stav

| Oblasť                    | Status                                        |
| ------------------------- | --------------------------------------------- |
| **Backend testy**         | ✅ 569 / 569 (33 test files)                  |
| **Frontend**              | ✅ všetky stránky funkčné                     |
| **Production**            | ✅ LIVE — app.inventario.estate               |
| **MongoDB**               | ✅ Nové čisté Inventario clustre              |
| **GitHub**                | ✅ github.com/ltksolutions/inventario         |
| **Vercel**                | ✅ API + Web nasadené                         |
| **Registrácia + email**   | ✅ Funguje (noreply@inventario.estate)        |
| **Login (email/passkey)** | ✅ Funguje                                    |
| **MFA (TOTP)**            | ✅ Aktivácia + status refresh opravené        |
| **Výpožičky**             | ✅ Email notifikácie pri schválení/zamietnutí |
| **Asset detail**          | ✅ 2-col hero + QR kód + 5 tabov              |
| **Legal review**          | ⏳ externe                                    |
| **Smoke test s kolegom**  | ⏳ kroky 4-8 pending                          |

---

## 🔥 Najbližšie kroky (priorita)

### 1. Zmazať staré SFZ clustre (manuálne)

**Atlas → Slovenský futbalový zväz projekt:**

- Zmazať `sfz-asset-mgmt-dev`
- Zmazať `sfz-asset-mgmt-prod`

### 2. Smoke test s kolegom

Prejsť kroky 4-8 z checklistu:

- [ ] Pridanie majetku + detail + úprava
- [ ] Žiadosť o výpožičku + schválenie + email notifikácia
- [ ] Členovia + pozvánka kolegu
- [ ] Reset hesla
- [ ] Odhlásenie + opätovné prihlásenie

### 3. `email_unique` index — systémový problém

`users` kolekcia má globálny unique index na `email` — blokuje dvoch userov z rôznych org s rovnakým emailom. Pri multi-tenant onboardingu SFZ (keď `office@ltk.solutions` bude aj v SFZ orgu) to padne.

**Fix:** zmazať `email_unique`, nahradiť s `{ email: 1, deletedAt: 1 }` non-unique pre vyhľadávanie.

**Kedy:** pred onboardingom SFZ alebo prvého externého tenanta.

### 4. SFZ onboarding

- SFZ má user `inventario@futbalsfz.sk` s `emailVerified: true` na prod
- Treba overiť login po novom prod clustri
- Ak nefunguje: password reset cez email

---

## 📅 Plánované

### Slice #10 — MCP server (Q1 2027, ~10 dní)

Design: [ADR-0017](../decisions/0017-mcp-server.md)

| Fáza | Bloky   | Popis                                                                                    |
| ---- | ------- | ---------------------------------------------------------------------------------------- |
| #10a | K1–K4   | Backend foundation: `mcp-access-token` schema, repository, routes, cleanup job           |
| #10b | K5–K10  | MCP server scaffold: SDK setup, token resolver, JWT issuer, openapi-fetch, rate limiting |
| #10c | K11–K16 | Tool implementation: 10 read tools + 7 write tools + audit log                           |
| #10d | K17–K18 | Frontend `/settings/integrations` page                                                   |
| #10e | K19–K23 | Tests + docs + Vercel deployment + DNS                                                   |

### Compliance Fáza 2 (po 1. tenantovi)

| Dokument                      | Model      | Odhad |
| ----------------------------- | ---------- | ----- |
| DPIA Template                 | Opus 4.7   | ~3h   |
| Security & Privacy Whitepaper | Opus 4.7   | ~4h   |
| Data Retention Schedule       | Sonnet 4.6 | ~2h   |
| Information Security Policy   | Sonnet 4.6 | ~2h   |

### Post-launch (LOW priority)

- `Cmd+K` tenant picker
- SOC 2 Type II — pri prvom enterprise tenantovi
- Dashboard — reálne štatistiky
- QR kód — tlačiteľné štítky PDF

---

## 🏗️ Backend status

```
Celkové testy:                569
├── Slice #1–#3:              ~310
├── Slice #4–#6b:             ~169
├── Slice #6c:                  21
├── Slice #7 + K12a/b:          29
├── Slice #9:                   28
└── Slice #8 (Passkeys):        16

Test files:   33
Duration:     ~75s
```

---

## 🧭 Model routing

| Task typ                                                    | Model          |
| ----------------------------------------------------------- | -------------- |
| Strategické rozhodnutia, ADR, DPIA, security architecture   | **Opus 4.7**   |
| CRUD endpoints, frontend pages, debug, tests, implementácia | **Sonnet 4.6** |
| Milestone docs, mechanické edits, scoped docs               | **Haiku 4.5**  |

---

## 📂 Kde nájdeš čo

| Typ                                 | Lokácia                                               |
| ----------------------------------- | ----------------------------------------------------- |
| **Aktuálny stav**                   | `docs/sessions/NEXT.md` (TY SI TU)                    |
| **Production smoke test checklist** | `docs/sessions/smoke-test-checklist.md`               |
| **ADR-čka**                         | `docs/decisions/0001..0017-*.md`                      |
| **Slice milestones**                | `docs/milestones/slice-*.md`                          |
| **Passkeys design**                 | `docs/decisions/0016-passkeys-implementation-plan.md` |
| **MCP server design**               | `docs/decisions/0017-mcp-server.md`                   |

---

**Last updated:** 2026-05-28  
**Tests:** 569 / 569 ✅  
**Repo:** github.com/ltksolutions/inventario  
**Status:** Production LIVE ✅ — nové MongoDB clustre ✅ — smoke test kroky 4-8 pending.
