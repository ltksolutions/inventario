<!--
SPDX-FileCopyrightText: 2026 LTK Solutions, s.r.o.
SPDX-License-Identifier: CC-BY-4.0
-->

# Security & Privacy Whitepaper — Inventario

> **Verejný dokument.** Zhrnutie bezpečnostnej a súkromia-architektúry platformy Inventario pre zákazníkov, obstarávateľov a ich poradcov pri due diligence. Verejná verzia: https://inventario.estate/security
>
> Toto je marketingovo-technický prehľad. Záväzné zmluvné podmienky sú v DPA a ToS; presné záznamy v [`gdpr-article-30.md`](./gdpr-article-30.md).

| Pole             | Hodnota                                                                       |
| ---------------- | ----------------------------------------------------------------------------- |
| **Verzia**       | 1.0                                                                           |
| **Dátum**        | 2026-06-11                                                                    |
| **Poskytovateľ** | LTK Solutions, s.r.o., Banícka 1894/17, 968 01 Nová Baňa, SR · IČO 45 949 310 |
| **Doména**       | https://inventario.estate                                                     |
| **Kontakt**      | security@inventario.estate · privacy@inventario.estate                        |

---

## 1. Čo je Inventario

Inventario je open-source (EUPL-1.2), multi-tenant SaaS platforma na evidenciu a vypožičiavanie majetku pre verejný sektor a neziskové organizácie — športové zväzy, mestá, kluby, školy. Každý zákazník (tenant) má svoje dáta striktne oddelené.

## 2. Dátová lokalita — všetko v EÚ

| Vrstva                       | Poskytovateľ  | Región                                   |
| ---------------------------- | ------------- | ---------------------------------------- |
| Frontend + API               | Vercel        | `cdg1` Paríž (FR), `fra1` Frankfurt (DE) |
| Databáza (perzistentné PII)  | MongoDB Atlas | AWS `eu-central-1` Frankfurt (DE)        |
| Transakčné e-maily (default) | Ecomail.cz    | Česká republika                          |

Primárne uloženie údajov je **celé v EÚ**. Cezhraničné prenosy nastávajú len pri OAuth prihlásení (e-mail + identifikátor) a pri US-sídlených dodávateľoch — všetky sú kryté **EU-US Data Privacy Framework a štandardnými zmluvnými doložkami (SCCs)**.

## 3. Šifrovanie

| Vrstva                  | Mechanizmus                            |
| ----------------------- | -------------------------------------- |
| Dáta v pokoji (at-rest) | AES-256 (MongoDB Atlas, vrátane záloh) |
| Prenos (in-transit)     | TLS 1.3, HSTS preload                  |
| Heslá                   | argon2id                               |
| MFA / TOTP secrets      | AES-256-GCM                            |
| Relácie                 | JWT RS256 v HttpOnly + Secure cookie   |

## 4. Multi-tenant izolácia

Oddelenie dát medzi zákazníkmi je najvyššia priorita. Identifikátor organizácie sa nastavuje výhradne na serveri z overeného prihlasovacieho tokenu — nikdy nie z požiadavky klienta. Každý databázový dotaz je viazaný na tenant; pokus o prístup k cudzím dátam vráti „nenájdené" (404). Izolácia je pokrytá automatizovanými testami.

## 5. Autentifikácia a riadenie prístupu

- Prihlásenie cez **Microsoft Entra ID, Google** (Apple plánované) alebo lokálny účet.
- **Viacfaktorové overenie (MFA)** cez TOTP — per-tenant politika (vypnuté / voliteľné / povinné).
- **Rolový model (RBAC)** s 5 úrovňami oprávnení vynucovaný na úrovni API.
- Per-tenant doménová politika a možnosť vlastnej Microsoft aplikácie (per-tenant OAuth credentials).

## 6. Súkromie a GDPR

- LTK Solutions je **sprostredkovateľ (processor)**; zákazník je **prevádzkovateľ (controller)**.
- Spracúvame len bežné osobné údaje (identifikačné, kontaktné, účtové, autentifikačné, custody majetku, audit metadáta). **Žiadne osobitné kategórie údajov (čl. 9).** Digitálne podpisy nie sú biometrické údaje.
- **Práva dotknutých osôb** sú implementované v aplikácii: prístup/export (čl. 20), oprava (čl. 16), výmaz (čl. 17), obmedzenie (čl. 18).
- **Záznamy o spracovateľských činnostiach** (čl. 30) sú vedené a verejne zhrnuté.
- **DPA** (čl. 28) je k dispozícii pre každého zákazníka; pomoc s **DPIA** (čl. 35) cez [DPIA Reference Pack](https://inventario.estate/dpia).

## 7. Sub-processori

Aktuálny verejný register: https://inventario.estate/sub-processors. Aktívni: Vercel (hosting, EÚ), MongoDB (DB, EÚ), Ecomail (e-mail, EÚ), Microsoft a Google (OAuth identity, EÚ). Zmeny oznamujeme zákazníkom **30 dní vopred**.

## 8. Uchovávanie údajov (retencia)

Detail: [Data Retention Schedule](./data-retention-schedule.md). V skratke: bežné audit záznamy 24 mesiacov, security/GDPR udalosti 60 mesiacov, evidenčné dáta po ukončení 60 mesiacov; audit log sa pseudonymizuje, nie maže. Zálohy 90 dní. Z nahrávaných fotiek sa odstraňujú EXIF/GPS metadáta.

## 9. Bezpečnosť vývoja a prevádzky

- Bezpečný SDLC: PR review, CI brána (lint, typecheck, testy, REUSE, CodeQL), SBOM, Dependabot.
- Append-only **audit log** každej významnej akcie.
- **Threat model (STRIDE):** 32 hrozieb, **0 vysokých reziduálnych rizík**, 4 stredné s mitigáciami.
- **Penetračné testy ročne**, Coordinated Vulnerability Disclosure ([SECURITY.md](../../SECURITY.md)).

## 10. Kontinuita a obnova

- **RPO ≤ 24 h, RTO ≤ 8 h.** Denné zálohy (retencia 90 dní), point-in-time recovery, automatický failover replica-setu < 1 min.
- DR test štvrťročne; prvý test (2026-05-23) prešiel.

## 11. Porušenia ochrany údajov

Notifikácia zákazníka do **24 hodín** od zistenia, dozorného orgánu (ÚOOÚ SR) do **72 hodín** (čl. 33), dotknutých osôb pri vysokom riziku do 72 hodín (čl. 34). Detail: [`breach-notification-plan.md`](./breach-notification-plan.md).

## 12. Transparentnosť

Inventario je **open source (EUPL-1.2)**, **REUSE 3.3 compliant** a deklaruje **WCAG 2.1 AA** prístupnosť. Kód: https://github.com/ltksolutions/inventario.

---

## Kontakty

| Téma                   | E-mail                     |
| ---------------------- | -------------------------- |
| Bezpečnostné incidenty | security@inventario.estate |
| Súkromie / GDPR        | privacy@inventario.estate  |
| Právne / zmluvy (DPA)  | legal@inventario.estate    |

## Zmenová história

| Verzia | Dátum      | Zmena               |
| ------ | ---------- | ------------------- |
| 1.0    | 2026-06-11 | Prvá verejná verzia |
