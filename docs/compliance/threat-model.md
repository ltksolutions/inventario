<!--
SPDX-FileCopyrightText: 2026 LTK Solutions, s.r.o.
SPDX-License-Identifier: CC-BY-4.0
-->

# Threat Model (STRIDE) — Inventario

**Interný bezpečnostný dokument** — systematická analýza hrozieb platformy Inventario metodikou STRIDE. Slúži ako podklad pre bezpečnostné rozhodnutia, penetračné testovanie a ako dôkaz „security by design" (čl. 25 a čl. 32 GDPR).

| Atribút                   | Hodnota                                                                                                                                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Verzia**                | 1.0                                                                                                                                                                                                                                                                                      |
| **Posledná aktualizácia** | _\[doplniť pri publikácii\]_                                                                                                                                                                                                                                                             |
| **Vlastník**              | Ing. Ján Letko, konateľ LTK Solutions, s.r.o.                                                                                                                                                                                                                                            |
| **Klasifikácia**          | Interný dokument — nezdieľať verejne (obsahuje analýzu útočných vektorov)                                                                                                                                                                                                                |
| **Metodika**              | STRIDE (Microsoft) — Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege                                                                                                                                                                 |
| **Súvisiace dokumenty**   | [ROPA Processor view](./gdpr-article-30.md), [Breach Notification Plan](./breach-notification-plan.md), [Disaster Recovery Plan](./disaster-recovery-plan.md), [Threshold Assessment](./threshold-assessment.md), [ADR-0010 Multi-tenant](../decisions/0010-multi-tenant-white-label.md) |

> Tento dokument analyzuje **aplikačnú a infraštruktúrnu vrstvu** platformy Inventario. Nepokrýva fyzickú bezpečnosť dátových centier (zodpovednosť sub-processorov Vercel/MongoDB Atlas) ani bezpečnosť koncových zariadení používateľov tenant-a (zodpovednosť tenant-a).

---

## TL;DR

Platforma Inventario je multi-tenant SaaS s logickou izoláciou cez `organisationId`. Najzávažnejšia trieda hrozieb je **prelomenie tenant izolácie** (Information Disclosure + Elevation of Privilege) — útočník z jedného tenant-a by videl dáta iného. Táto hrozba je mitigovaná `requireTenantId + tenantFilter` utilitou vynútenou v každom service volaní a pokrytá **17 cross-tenant izolačnými testami**. Druhá najzávažnejšia trieda je **kompromitácia autentifikácie** (Spoofing) — mitigovaná argon2id, RS256 JWT, TOTP MFA a rate-limitingom. Žiadna identifikovaná hrozba nie je v stave „nemitigovaná s vysokým reziduálnym rizikom".

---

## 1. Rozsah a metodika

### 1.1. Čo je STRIDE

STRIDE je akronym pre šesť kategórií hrozieb. Každá zodpovedá porušeniu jednej bezpečnostnej vlastnosti:

| Kategória                  | Porušuje         | Otázka                                                |
| -------------------------- | ---------------- | ----------------------------------------------------- |
| **S**poofing               | Autentickosť     | Môže sa útočník vydávať za niekoho iného?             |
| **T**ampering              | Integritu        | Môže útočník neoprávnene zmeniť dáta?                 |
| **R**epudiation            | Nepopierateľnosť | Môže aktér poprieť, že vykonal akciu?                 |
| **I**nformation Disclosure | Dôvernosť        | Môže útočník vidieť dáta, ktoré nemá vidieť?          |
| **D**enial of Service      | Dostupnosť       | Môže útočník znefunkčniť službu?                      |
| **E**levation of Privilege | Autorizáciu      | Môže útočník získať vyššie oprávnenia, než mu patria? |

### 1.2. Rozsah dokumentu

**V rozsahu:**

- Aplikačná vrstva (Fastify API, Next.js frontend)
- Autentifikácia a autorizácia (multi-provider OAuth, email/heslo, TOTP MFA, RBAC, JWT)
- Multi-tenant izolácia (`organisationId` scoping)
- Dátová vrstva (MongoDB Atlas, schémy, audit log)
- Deployment pipeline (GitHub → Vercel)

**Mimo rozsahu:**

- Fyzická bezpečnosť dátových centier (Vercel, MongoDB Atlas — pokryté ich certifikáciami SOC 2 / ISO 27001)
- Bezpečnosť koncových zariadení tenant-ových používateľov
- Sociálne inžinierstvo voči tenant-ovým zamestnancom (mimo phishing-resistant prvkov, ktoré platforma poskytuje)
- Bezpečnosť OAuth identity providerov (Microsoft, Google, Apple — pokryté ich vlastnými programami)

### 1.3. Hodnotenie rizika

Každá hrozba dostane skóre **pravdepodobnosť × dopad** na škále:

| Úroveň      | Pravdepodobnosť                             | Dopad                                           |
| ----------- | ------------------------------------------- | ----------------------------------------------- |
| **Vysoká**  | Realistický útok s bežnými nástrojmi        | Únik PII viacerých tenant-ov / strata integrity |
| **Stredná** | Vyžaduje špecifické podmienky alebo prístup | Únik PII jedného tenant-a / čiastočný výpadok   |
| **Nízka**   | Vyžaduje neobvyklú kombináciu / insider     | Obmedzený dopad / žiadne PII                    |

Reziduálne riziko = riziko **po** aplikovaní existujúcich mitigácií.

---

## 2. Architektúra a dôveryhodné hranice

### 2.1. Komponenty a tok dát

```
┌─────────────┐        ┌──────────────────────┐        ┌─────────────────────┐
│  Browser    │───1───▶│  Next.js (Vercel)    │───2───▶│  Fastify API        │
│  (tenant    │◀───────│  app.inventario      │◀───────│  api.inventario     │
│   user)     │        │  .estate             │        │  .estate            │
└─────────────┘        └──────────────────────┘        └──────────┬──────────┘
       │                                                            │ 3
       │ 4 (OAuth redirect)                                         ▼
       ▼                                              ┌─────────────────────────┐
┌──────────────────────┐                              │  MongoDB Atlas          │
│  OAuth providers      │                              │  (eu-central-1)         │
│  MS / Google / Apple  │                              │  tenant-scoped docs     │
└──────────────────────┘                              └─────────────────────────┘
                                                                    │ 5
                                                                    ▼
                                                       ┌─────────────────────────┐
                                                       │  Ecomail / Resend        │
                                                       │  (transakčný e-mail)     │
                                                       └─────────────────────────┘
```

### 2.2. Dôveryhodné hranice (trust boundaries)

| #   | Hranica                  | Čo prechádza                       | Kontrola na hranici                                        |
| --- | ------------------------ | ---------------------------------- | ---------------------------------------------------------- |
| 1   | Browser ↔ Frontend       | HTTP request, cookies (JWT)        | TLS 1.3, HttpOnly+Secure cookies, CSP                      |
| 2   | Frontend ↔ API           | Authenticated request s JWT cookie | JWT verifikácia (RS256), CORS, rate limiting               |
| 3   | API ↔ Databáza           | Tenant-scoped Mongo query          | `requireTenantId + tenantFilter`, connection cez TLS       |
| 4   | Browser ↔ OAuth provider | OAuth authorization code flow      | HMAC-podpísaný state cookie (CSRF), redirect URI allowlist |
| 5   | API ↔ E-mail provider    | Transakčný e-mail (invite, reset)  | TLS, API key v env, žiadne PII nad rámec nevyhnutného      |

### 2.3. Najcennejšie aktíva

1. **Osobné údaje tenant-ov** (PII) — meno, e-mail, audit metadata
2. **Autentifikačné tajomstvá** — argon2id hashe hesiel, AES-256-GCM šifrované TOTP secrets, JWT signing keypair
3. **Tenant izolácia** — záruka, že tenant A nevidí dáta tenant-a B
4. **Audit log integrita** — nepopierateľnosť a forenzná hodnota append-only logu
5. **Env secrets** — `MFA_SECRET_ENCRYPTION_KEY`, JWT private key, DB connection string, OAuth client secrets

---

## 3. STRIDE analýza

### 3.1. Spoofing (vydávanie sa za niekoho iného)

| ID  | Hrozba                                                                | Pravdepod. | Dopad   | Mitigácia                                                                                                                                        | Reziduál |
| --- | --------------------------------------------------------------------- | ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| S-1 | Útočník uhádne / brute-force heslo používateľa                        | Stredná    | Vysoký  | argon2id KDF (memoryCost 65536, timeCost 3); rate limiting 10/15min/IP na login; per-tenant MFA policy (REQUIRED dostupné)                       | Nízke    |
| S-2 | Útočník ukradne session (JWT cookie)                                  | Nízka      | Vysoký  | HttpOnly + Secure + SameSite cookies; TLS 1.3; krátka životnosť access tokenu + silent refresh; JWT RS256 (nedá sa sfalšovať bez private key)    | Nízke    |
| S-3 | Útočník zfalšuje JWT token                                            | Nízka      | Vysoký  | RS256 asymetrický podpis — verifikácia verejným kľúčom, podpis vyžaduje private key (v env, nikdy v klientovi); keypair rotácia                  | Nízke    |
| S-4 | CSRF — útočník donúti prehliadač obete poslať autentifikovaný request | Stredná    | Stredný | SameSite cookies; OAuth state cookie je HMAC-podpísaný; mutácie vyžadujú JSON content-type (nie form)                                            | Nízke    |
| S-5 | Phishing — falošná login stránka zbiera credentials                   | Stredná    | Vysoký  | Passkeys / WebAuthn (phishing-resistant, ADR-0016) ako alternatíva k heslu; OAuth SSO presúva auth na providera; používateľská edukácia (tenant) | Stredné  |
| S-6 | Útočník zneužije OAuth flow (auth code interception)                  | Nízka      | Vysoký  | HMAC-podpísaný state cookie proti CSRF; redirect URI allowlist; PKCE kde provider podporuje; email match validácia pri invite-via-OAuth          | Nízke    |

**Kľúčová mitigácia:** Multi-faktorová autentifikácia (TOTP, RFC 6238) a passkeys (WebAuthn) — tenant si môže vynútiť MFA policy REQUIRED. Phishing (S-5) ostáva so stredným reziduálom, lebo závisí čiastočne od správania používateľa; passkeys ho eliminujú tam, kde sú nasadené.

### 3.2. Tampering (neoprávnená zmena dát)

| ID  | Hrozba                                                                  | Pravdepod. | Dopad   | Mitigácia                                                                                                                    | Reziduál |
| --- | ----------------------------------------------------------------------- | ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- | -------- |
| T-1 | Útočník zmení dáta cez API mimo svojich oprávnení                       | Stredná    | Vysoký  | RBAC (GET=EMPLOYEE+, POST/PATCH=ASSET_MANAGER+ADMIN, DELETE=ADMIN); Zod validácia vstupu; tenant scoping                     | Nízke    |
| T-2 | Man-in-the-middle modifikuje request/response                           | Nízka      | Vysoký  | TLS 1.3 minimum; HSTS preload pre `inventario.estate`                                                                        | Nízke    |
| T-3 | Útočník zmení audit log (zahladenie stôp)                               | Nízka      | Vysoký  | Audit log je append-only z aplikácie (žiadny UPDATE/DELETE endpoint); read-only pre tenant ADMIN                             | Nízke    |
| T-4 | NoSQL injection cez nevalidovaný vstup                                  | Stredná    | Vysoký  | Zod schémy validujú každý request payload pred handlerom; Mongo native driver s parametrizovanými query (žiadny string-eval) | Nízke    |
| T-5 | Útočník zmení `organisationId` v requeste a zapíše do cudzieho tenant-a | Stredná    | Vysoký  | `organisationId` je server-set z JWT claimu, NIKDY z request body; `CreateXSchema` ho `.omit()`-uje z klientského vstupu     | Nízke    |
| T-6 | Tampering s `inventoryNumber` / `protocolNumber` (duplicita, kolízia)   | Nízka      | Stredný | Server-generated, immutable; unique index na `(organisationId, X)`; transakčný atomický counter                              | Nízke    |

**Kľúčová mitigácia:** Zod schémy v `@inventario/shared-types` ako single source of truth — Fastify type provider odmieta neplatný payload pred dosiahnutím handlera. `organisationId` sa nikdy nečíta z tela requestu.

### 3.3. Repudiation (popieranie akcií)

| ID  | Hrozba                                                        | Pravdepod. | Dopad   | Mitigácia                                                                                                                 | Reziduál |
| --- | ------------------------------------------------------------- | ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------- | -------- |
| R-1 | Aktér poprie, že vykonal akciu (zmena role, zmazanie majetku) | Stredná    | Stredný | Append-only audit log so `actor.userId`, `displayName` snapshot, `ipAddress`, `userAgent`, timestamp pri každej mutácii   | Nízke    |
| R-2 | Spor o tom, kto prevzal/vrátil majetok                        | Stredná    | Stredný | Loan protokoly so snapshotmi strán + podpisy (CLICK_TO_SIGN: timestamp + IP); `pdfSha256` ako dôkaz integrity (ADR-0022)  | Nízke    |
| R-3 | Aktér tvrdí, že audit záznam bol sfalšovaný                   | Nízka      | Stredný | Audit log append-only; Mongo transakcie viažu business write + audit write atomicky; GDPR `legalBasis` + `dataCategories` | Nízke    |

**Kľúčová mitigácia:** Každá operácia meniaca dáta zapisuje audit log záznam **atomicky** v rovnakej Mongo transakcii ako samotná zmena — nedá sa zmeniť dáta bez zodpovedajúceho audit záznamu.

### 3.4. Information Disclosure (únik dôverných údajov)

| ID      | Hrozba                                                         | Pravdepod.  | Dopad      | Mitigácia                                                                                                                                                                                  | Reziduál  |
| ------- | -------------------------------------------------------------- | ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| **I-1** | **Prelomenie tenant izolácie — tenant A vidí dáta tenant-a B** | **Stredná** | **Vysoký** | **`requireTenantId + tenantFilter` vynútené v každom service call (apps/api/src/lib/organisation-scoping.ts); 17 cross-tenant izolačných testov; cross-tenant zdroje vracajú 404 nie 403** | **Nízke** |
| I-2     | Únik autentifikačných tajomstiev v API response                | Nízka       | Vysoký     | Repository projekcia odstraňuje `passwordHash`, `mfaSecret`, `mfaRecoveryCodes` na dátovej vrstve (nie na UI)                                                                              | Nízke     |
| I-3     | Enumerácia používateľov / e-mailov cez verejné endpointy       | Stredná     | Stredný    | Invitation preview vracia 410 pre invalid/expired token bez leakovania e-mailu; login chyby sú generické; verejný QR lookup cez náhodný `publicToken`                                      | Nízke     |
| I-4     | Únik dát cez verejný QR „lost & found" lookup (ADR-0021)       | Nízka       | Stredný    | Opt-in per tenant (`publicAssetLookup` default false); samostatné `PublicAssetView` DTO s explicitným whitelistom (NIE Pick/Omit); rate-limited                                            | Nízke     |
| I-5     | Únik PII v logoch (Vercel function logs, error stacky)         | Stredná     | Stredný    | Štruktúrované logovanie bez PII v message; error handler nevracia interné detaily klientovi; Vercel logy 7-dňová rotácia                                                                   | Stredné   |
| I-6     | Únik dát z DB backupov (Atlas snapshots)                       | Nízka       | Vysoký     | Atlas backups šifrované at rest (AES-256), rovnaký EÚ región; prístup len cez Atlas org admin s MFA                                                                                        | Nízke     |
| I-7     | Útočník získa env secrets (DB string, JWT key, encryption key) | Nízka       | Vysoký     | Secrets v Vercel encrypted env; nikdy v repe (`.gitignore`); lokálna kópia v šifrovanom trezore; rotácia pri podozrení                                                                     | Nízke     |

**Kľúčová mitigácia (I-1, najzávažnejšia hrozba platformy):** Tenant izolácia je vynútená **na úrovni service vrstvy**, nie len UI. Každý repository call prechádza cez `tenantFilter`, ktorý injektuje `organisationId` z autentifikovaného kontextu. Cross-tenant prístup k zdroju vracia 404 (zdroj „neexistuje"), nie 403 (čím sa nepotvrdí ani existencia). Pokryté 17 dedikovanými testami.

**Reziduálne stredné (I-5):** Únik PII v logoch závisí od disciplíny pri logovaní — vyžaduje priebežnú kontrolu, že sa do log message nedostávajú osobné údaje. Odporúčaná mitigácia: log review ako súčasť code review + pravidelný audit log message vzorov.

### 3.5. Denial of Service (znefunkčnenie služby)

| ID  | Hrozba                                            | Pravdepod. | Dopad   | Mitigácia                                                                                                            | Reziduál |
| --- | ------------------------------------------------- | ---------- | ------- | -------------------------------------------------------------------------------------------------------------------- | -------- |
| D-1 | Volumetrický DDoS na API/frontend                 | Stredná    | Stredný | Vercel edge network s DDoS ochranou (zdieľaná infraštruktúra); auto-scaling                                          | Nízke    |
| D-2 | Application-layer flooding (drahé endpointy)      | Stredná    | Stredný | Rate limiting na auth (10/15min/IP), invite (20/15min), MFA setup (5/15min); paginácia s limitmi na list endpointoch | Stredné  |
| D-3 | Resource exhaustion cez veľké/zložité requesty    | Nízka      | Stredný | Zod schémy s `max()` limitmi (napr. max 50 items v žiadosti); Fastify body size limit                                | Nízke    |
| D-4 | Vyčerpanie DB connection poolu                    | Nízka      | Stredný | Mongo connection pool limit; serverless funkcie zdieľajú pool cez connection reuse                                   | Stredné  |
| D-5 | Výpadok kritického sub-processora (Atlas, Vercel) | Nízka      | Vysoký  | Atlas 3-node replica set (auto failover <1min); Vercel multi-region; Disaster Recovery Plan (RTO ≤ 8h)               | Nízke    |

**Reziduálne stredné (D-2, D-4):** Rate limiting je nasadený na najcitlivejších endpointoch, ale nie plošne na všetkých. Connection pool exhaustion je teoretické riziko pri vysokej súbežnosti serverless funkcií. Mitigácia po pilote: rozšíriť rate limiting na ďalšie endpointy podľa reálnej prevádzky; monitorovať Atlas connection metriky.

### 3.6. Elevation of Privilege (získanie vyšších oprávnení)

| ID  | Hrozba                                                           | Pravdepod. | Dopad   | Mitigácia                                                                                                                       | Reziduál |
| --- | ---------------------------------------------------------------- | ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- | -------- |
| E-1 | EMPLOYEE získa ADMIN oprávnenia v rámci tenant-a                 | Nízka      | Vysoký  | RBAC kontrola v každom write endpointe; role v JWT claime (server-set); zmena role len cez ADMIN + audit log                    | Nízke    |
| E-2 | ASSET_MANAGER pozve ADMIN-a (privilege escalation cez invite)    | Nízka      | Stredný | Explicitná kontrola: ASSET_MANAGER nemôže pozvať ADMIN rolu (Slice #6c rozhodnutie)                                             | Nízke    |
| E-3 | Tenant ADMIN získa platform-level (cross-tenant) oprávnenia      | Nízka      | Vysoký  | Platform admin je oddelená rola; tenant ADMIN je scoped na vlastný `organisationId`; žiadny tenant endpoint nečíta cross-tenant | Nízke    |
| E-4 | Privilege escalation cez IDOR (insecure direct object reference) | Stredná    | Vysoký  | Každý `/:id` endpoint overuje tenant ownership cez `tenantFilter` pred prístupom; cross-tenant ID vracia 404                    | Nízke    |
| E-5 | Kompromitácia deployment pipeline → injektovanie kódu            | Nízka      | Vysoký  | GitHub PR review povinný; CodeQL weekly scan; Dependabot; signed commits; Vercel deploy len z `main`                            | Nízke    |

**Kľúčová mitigácia:** Roly sú v JWT claime nastavenom serverom pri prihlásení — klient ich nemôže zmeniť. Každá zmena role prechádza cez ADMIN-only endpoint a zapisuje sa do audit logu (`USER_ROLE_GRANTED`, `USER_ROLE_REVOKED`).

---

## 4. Sumár rizík

### 4.1. Matica reziduálnych rizík

| Kategória              | Hrozieb | Nízke reziduál. | Stredné reziduál. | Vysoké reziduál. |
| ---------------------- | ------- | --------------- | ----------------- | ---------------- |
| Spoofing               | 6       | 5               | 1 (S-5 phishing)  | 0                |
| Tampering              | 6       | 6               | 0                 | 0                |
| Repudiation            | 3       | 3               | 0                 | 0                |
| Information Disclosure | 7       | 6               | 1 (I-5 log PII)   | 0                |
| Denial of Service      | 5       | 3               | 2 (D-2, D-4)      | 0                |
| Elevation of Privilege | 5       | 5               | 0                 | 0                |
| **Spolu**              | **32**  | **28**          | **4**             | **0**            |

### 4.2. Reziduálne stredné riziká — akčné body

| ID  | Riziko                        | Plánovaná mitigácia                                                               | Priorita |
| --- | ----------------------------- | --------------------------------------------------------------------------------- | -------- |
| S-5 | Phishing                      | Propagovať passkeys; tenant edukácia; zvážiť MFA REQUIRED ako default odporúčanie | Stredná  |
| I-5 | PII v logoch                  | Log message review v code review; audit log-message vzorov pred go-live           | Stredná  |
| D-2 | Application-layer flooding    | Rozšíriť rate limiting na ďalšie endpointy podľa reálnej prevádzky po pilote      | Nízka    |
| D-4 | DB connection pool exhaustion | Monitorovať Atlas connection metriky; tuning poolu pri raste prevádzky            | Nízka    |

**Žiadne vysoké reziduálne riziko.** Štyri stredné riziká majú jasné mitigačné plány, žiadne nie je blokujúce pre SFZ pilot.

---

## 5. Predpoklady a obmedzenia

Tento threat model stojí na nasledujúcich predpokladoch. Ak prestanú platiť, model treba prehodnotiť:

1. **Sub-processori plnia svoje bezpečnostné záväzky** — Vercel, MongoDB Atlas, OAuth provideri majú vlastné SOC 2 / ISO 27001 programy. Fyzická a hypervisor-level bezpečnosť je ich zodpovednosť.
2. **Env secrets sú chránené** — predpokladá sa, že Vercel encrypted env a šifrovaný trezor hesiel nie sú kompromitované. Kompromitácia secrets je samostatný incident (DR Plan scenár D).
3. **Tenant chráni svoje koncové zariadenia** — bezpečnosť zariadení a sietí tenant-ových používateľov je mimo kontroly platformy.
4. **Aktuálny funkčný rozsah** — model pokrýva slice #1–#7 + ADR-0021/0022/0023/0025/0026. Nové features (AI v runtime, biometria, geolokácia) vyžadujú re-assessment (viď sekcia 6).

---

## 6. Triggery pre re-assessment

Threat model sa prehodnotí pri ktoromkoľvek z:

| #   | Trigger                                                     | Dopad                                                               |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | Nová autentifikačná metóda (biometria, nový OAuth provider) | Prehodnotiť Spoofing kategóriu                                      |
| 2   | Nový verejný (unauthenticated) endpoint                     | Prehodnotiť Information Disclosure + DoS                            |
| 3   | AI / ML feature s prístupom k customer dátam                | Nová trieda hrozieb (prompt injection, model extraction, data leak) |
| 4   | Zmena tenant izolačného modelu (napr. shared collections)   | Prehodnotiť I-1 (najzávažnejšia hrozba)                             |
| 5   | Pridanie file upload / attachments funkcie                  | Nové hrozby (malware upload, path traversal, storage exhaustion)    |
| 6   | Závažný security incident                                   | Post-incident analýza môže odhaliť nové vektory                     |
| 7   | Výsledky penetračného testu                                 | Nálezy sa zapracujú ako nové hrozby alebo úprava reziduálu          |
| 8   | Ročný review                                                | Pravidelné prehodnotenie aj bez formálneho triggera                 |

---

## 7. Vzťah k penetračnému testovaniu

Tento threat model je **vstupom** pre penetračný test plánovaný pred go-live SFZ pilotu (viď ROPA sekcia 4.2 — „Penetration testing: planned"). Penetračný tester by mal prioritne overiť:

1. **I-1 — tenant izolácia** (najzávažnejšia hrozba): pokus o cross-tenant prístup cez manipuláciu ID, JWT, query parametrov
2. **T-4 — NoSQL injection**: fuzzing vstupov mimo Zod očakávaní
3. **E-4 — IDOR**: systematické skúšanie cudzích ID na všetkých `/:id` endpointoch
4. **S-1/S-6 — auth bypass**: brute-force, OAuth flow manipulácia, rate limit bypass
5. **I-2 — secret leakage**: kontrola, či API response neobsahuje hashe/secrets

Nálezy penetračného testu sa zapracujú do tohto dokumentu (verzia 1.1+) a do reziduálnej matice.

---

## 8. Zmenová história

| Verzia | Dátum                        | Zmena                                                                                                                                        |
| ------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0    | _\[doplniť pri publikácii\]_ | Prvá verzia STRIDE threat modelu pre platformu Inventario (slice #1–#7 + ADR-0021/0022/0023/0025/0026). 32 hrozieb, 0 vysokých reziduálnych. |

---

## 9. Referencie

- [Microsoft STRIDE Threat Model](https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats) — metodika
- [OWASP Top 10](https://owasp.org/www-project-top-ten/) — referenčné triedy webových zraniteľností
- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/) — API-špecifické riziká (BOLA/IDOR = I-1, E-4)
- [GDPR čl. 25 — Data protection by design and by default](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [GDPR čl. 32 — Bezpečnosť spracúvania](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [ROPA Processor view](./gdpr-article-30.md) — opis spracovateľských operácií a opatrení
- [Breach Notification Plan](./breach-notification-plan.md) — postup pri realizácii hrozby
- [Disaster Recovery Plan](./disaster-recovery-plan.md) — D-5 mitigácia (RPO/RTO)
- [ADR-0010 Multi-tenant white-label](../decisions/0010-multi-tenant-white-label.md) — `organisationId` izolačný invariant (I-1)
- [ADR-0016 Passkeys implementačný plán](../decisions/0016-passkeys-implementation-plan.md) — phishing-resistant auth (S-5)
- [ADR-0021 QR kódy majetku](../decisions/0021-asset-qr-codes.md) — verejný lookup povrch (I-4)

---

**Klasifikácia**: Interný dokument. Nezdieľať verejne — obsahuje analýzu útočných vektorov a mitigácií.
