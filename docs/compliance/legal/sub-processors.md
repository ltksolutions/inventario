<!--
SPDX-FileCopyrightText: 2026 LTK Solutions, s.r.o.
SPDX-License-Identifier: CC-BY-4.0
-->

# Inventario — Sub-processors

**Verejný register sub-processorov** používaných LTK Solutions, s.r.o. pri poskytovaní platformy **Inventario**. Tento dokument je odkazovaný z DPA (Data Processing Agreement) uzatváraných so zákazníkmi a aktualizovaný pri každej zmene.

| Atribút                         | Hodnota                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Verzia**                      | 1.0                                                                                                     |
| **Posledná aktualizácia**       | _\[doplniť pri prvej publikácii\]_                                                                      |
| **Verejná URL (po publikácii)** | https://inventario.estate/sub-processors                                                                |
| **Notifikácia o zmenách**       | E-mail na kontakt GDPR Zákazníka + zverejnenie aktualizácie na tejto stránke najmenej **30 dní vopred** |
| **Námietkové právo Zákazníka**  | 14 kalendárnych dní od oznámenia (viď DPA bod 3.4)                                                      |

---

## 1. Aktívni sub-processors

Sub-processors zapojení pri spracúvaní osobných údajov všetkých zákazníkov platformy Inventario:

### 1.1. Vercel Inc.

| Pole                          | Hodnota                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Účel**                      | Hosting frontendu (Next.js) a API (Fastify serverless functions)                                                             |
| **Sídlo**                     | 340 S Lemon Ave #4133, Walnut, CA 91789, USA                                                                                 |
| **Lokalita dát**              | EÚ — regióny `cdg1` (Paríž, Francúzsko) a `fra1` (Frankfurt, Nemecko)                                                        |
| **Kategórie dát**             | Všetky osobné údaje prechádzajúce HTTP request / response cyklom (autentifikačné tokeny, používateľské vstupy, API odpovede) |
| **Zachovávanie dát Vercelom** | Stateless runtime — žiadne perzistentné dáta. Logs uchovávané 7 dní (Vercel Standard plan)                                   |
| **Bezpečnostné certifikácie** | SOC 2 Type II, ISO/IEC 27001, EU-US Data Privacy Framework                                                                   |
| **DPA**                       | https://vercel.com/legal/dpa                                                                                                 |
| **Transferový mechanizmus**   | EU-US Data Privacy Framework + EU SCCs (modul 2 — controller to processor) podľa rozhodnutia 2021/914                        |
| **Webová stránka**            | https://vercel.com                                                                                                           |

### 1.2. MongoDB, Inc.

| Pole                          | Hodnota                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| **Účel**                      | Hosting produkčnej databázy (MongoDB Atlas Flex tier)                                        |
| **Sídlo**                     | 1633 Broadway, 38th Floor, New York, NY 10019, USA                                           |
| **Lokalita dát**              | EÚ — AWS región `eu-central-1` (Frankfurt, Nemecko)                                          |
| **Kategórie dát**             | Všetky perzistentné osobné údaje platformy (používatelia, audit log, vypožičky, organizácie) |
| **Zachovávanie dát**          | Trvanie zmluvy + 90 dní backup retention po skončení (cyklické prepisovanie)                 |
| **Bezpečnostné certifikácie** | SOC 2 Type II, ISO/IEC 27001, ISO/IEC 27017, ISO/IEC 27018, PCI DSS Level 1                  |
| **Šifrovanie**                | AES-256 transparent encryption at rest (default), TLS 1.3 in transit                         |
| **DPA**                       | https://www.mongodb.com/legal/dpa                                                            |
| **Transferový mechanizmus**   | EU-US Data Privacy Framework + EU SCCs (modul 2)                                             |
| **Webová stránka**            | https://www.mongodb.com                                                                      |

### 1.3. Ecomail.cz, s.r.o.

| Pole                        | Hodnota                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Účel**                    | Doručovanie transakčných e-mailov (verifikácia účtu, reset hesla, pozvánky, notifikácie)                                           |
| **Sídlo**                   | Na Zderaze 1275/15, 120 00 Praha 2, Česká republika                                                                                |
| **IČO**                     | 029 22 022                                                                                                                         |
| **Lokalita dát**            | EÚ — Česká republika                                                                                                               |
| **Kategórie dát**           | E-mailové adresy príjemcov, mená v salutácii, telo transakčného e-mailu (môže obsahovať identifikátor organizácie, link s tokenom) |
| **Zachovávanie dát**        | 30 dní pre delivery logs (Ecomail default)                                                                                         |
| **Bezpečnostné opatrenia**  | TLS 1.3 in transit; ISO/IEC 27001 (čiastočne); GDPR compliance attested                                                            |
| **DPA**                     | https://www.ecomail.cz/podminky/ochrana-osobnich-udaju/                                                                            |
| **Transferový mechanizmus** | Žiadny — spracúvanie v rámci EÚ                                                                                                    |
| **Webová stránka**          | https://www.ecomail.cz                                                                                                             |

### 1.4. Microsoft Ireland Operations Limited

| Pole                          | Hodnota                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Účel**                      | OAuth identity provider (Microsoft Entra ID — Sign in with Microsoft / Azure AD)                           |
| **Sídlo**                     | One Microsoft Place, South County Business Park, Dublin 18, D18 P521, Írsko                                |
| **Lokalita dát**              | EÚ — Entra ID tenant Zákazníka (konfigurovateľné per-tenant na strane Microsoftu)                          |
| **Kategórie dát**             | E-mailová adresa, meno, OAuth identifikátor (oid), tenant ID                                               |
| **Bezpečnostné certifikácie** | SOC 1/2/3, ISO/IEC 27001, ISO/IEC 27017, ISO/IEC 27018, HIPAA, FedRAMP High                                |
| **DPA**                       | https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA |
| **Transferový mechanizmus**   | Microsoft DPA + EU SCCs                                                                                    |
| **Webová stránka**            | https://entra.microsoft.com                                                                                |

### 1.5. Google Ireland Limited

| Pole                          | Hodnota                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| **Účel**                      | OAuth identity provider (Sign in with Google)                          |
| **Sídlo**                     | Gordon House, Barrow Street, Dublin 4, Írsko                           |
| **Lokalita dát**              | EÚ + globálne (Google global infrastructure)                           |
| **Kategórie dát**             | E-mailová adresa, meno, OAuth sub identifikátor, profilový obrázok URL |
| **Bezpečnostné certifikácie** | SOC 1/2/3, ISO/IEC 27001, ISO/IEC 27017, ISO/IEC 27018                 |
| **DPA**                       | https://workspace.google.com/terms/dpa_terms.html                      |
| **Transferový mechanizmus**   | Google DPA + EU SCCs                                                   |
| **Webová stránka**            | https://developers.google.com/identity                                 |

### 1.6. Apple Distribution International Ltd.

| Pole                          | Hodnota                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| **Status**                    | **Plánované** — aktivácia po získaní Apple Developer Program enrollmentu                  |
| **Účel**                      | OAuth identity provider (Sign in with Apple)                                              |
| **Sídlo**                     | Hollyhill Industrial Estate, Hollyhill, Cork, T23 YK84, Írsko                             |
| **Lokalita dát**              | EÚ + globálne                                                                             |
| **Kategórie dát**             | Apple ID identifikátor (sub), e-mailová adresa (môže byť anonymizovaná cez Hide My Email) |
| **Bezpečnostné certifikácie** | SOC 2 Type II, ISO/IEC 27001                                                              |
| **DPA**                       | https://www.apple.com/legal/enterprise/                                                   |
| **Transferový mechanizmus**   | Apple DPA + EU SCCs                                                                       |
| **Webová stránka**            | https://developer.apple.com/sign-in-with-apple                                            |

---

## 2. Voliteľní (per-tenant) sub-processors

Sub-processors zapojení **iba na explicitnú žiadosť konkrétneho Zákazníka**, nie ako default:

### 2.1. Resend, Inc.

| Pole                          | Hodnota                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| **Status**                    | **Voliteľný** — aktivovaný iba per-tenant na požiadanie                                            |
| **Účel**                      | Alternatívna doručovacia služba transakčných e-mailov (namiesto Ecomail.cz)                        |
| **Sídlo**                     | 2261 Market Street #4493, San Francisco, CA 94114, USA                                             |
| **Lokalita dát**              | USA (v základnej tarife). EU Data Residency dostupná v Resend Pro plane                            |
| **Kategórie dát**             | E-mailové adresy príjemcov, telo transakčného e-mailu, delivery logs                               |
| **Zachovávanie dát**          | 30 dní (Resend default)                                                                            |
| **Bezpečnostné certifikácie** | SOC 2 Type II                                                                                      |
| **DPA**                       | https://resend.com/legal/dpa                                                                       |
| **Transferový mechanizmus**   | EU-US Data Privacy Framework + EU SCCs                                                             |
| **Aktivácia pre tenant**      | Vyžaduje explicitnú písomnú žiadosť Zákazníka a zmenu konfigurácie v `Organisation.settings.email` |
| **Webová stránka**            | https://resend.com                                                                                 |

---

## 3. Subjekty mimo rozsahu spracúvania osobných údajov Zákazníka

Nasledujúce subjekty LTK Solutions používa pri prevádzke alebo vývoji, ale **nespracúvajú Osobné údaje Zákazníka**, a preto nie sú sub-processors v zmysle čl. 28 GDPR:

### 3.1. Anthropic, PBC

| Pole         | Hodnota                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **Účel**     | AI asistent (Claude) používaný **výhradne pri vývoji Inventario** zo strany LTK Solutions                                      |
| **Sídlo**    | 548 Market Street PMB 90375, San Francisco, CA 94104, USA                                                                      |
| **Status**   | **Nie je sub-processor.** Anthropic nemá runtime prístup k platforme Inventario ani k osobným údajom Zákazníka.                |
| **Garancia** | LTK Solutions sa zaväzuje **neposlať nikdy** žiadne reálne osobné údaje Zákazníka do Anthropic produktov v rámci developmentu. |

### 3.2. GitHub, Inc.

| Pole       | Hodnota                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Účel**   | Hosting verejného zdrojového kódu Inventario (open-source projekt pod licenciou EUPL-1.2)                                           |
| **Sídlo**  | 88 Colin P Kelly Jr Street, San Francisco, CA 94107, USA                                                                            |
| **Status** | **Nie je sub-processor.** Repozitár neobsahuje žiadne customer dáta — iba zdrojový kód, testy s syntetickými dátami a dokumentáciu. |

### 3.3. Google Fonts (Google Ireland Limited)

| Pole                 | Hodnota                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Účel**             | Webfonty (Poppins, JetBrains Mono) servované cez Google Fonts CDN                                                                                  |
| **Status**           | **Strict-necessary infrastructure.** Pri requeste browser → Google Fonts CDN sa nevypláva žiadny customer-side identifikátor. Žiadne PII transfer. |
| **Self-host option** | Pre Zákazníkov so striktnými on-prem požiadavkami sú fonty dostupné aj v self-hosted variante (`/assets/fonts/`).                                  |

---

## 4. História zmien (changelog)

Každá zmena tohto zoznamu (pridanie, odstránenie, podstatná úprava existujúceho záznamu) sa pridáva do tabuľky nižšie. Zákazníci sú informovaní podľa procesu z bodu 3.4 DPA.

| Verzia | Dátum                              | Zmena                                                                                                        |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1.0    | _\[doplniť pri prvej publikácii\]_ | Prvá verzia zoznamu. Iniciálne sub-processors: Vercel, MongoDB, Ecomail, Microsoft, Google, Apple (planned). |

---

## 5. Kontakt

| Otázka                                        | Kontakt                               |
| --------------------------------------------- | ------------------------------------- |
| Otázky k tomuto zoznamu, GDPR vo všeobecnosti | privacy@inventario.estate             |
| Námietka voči novému sub-processorovi         | privacy@inventario.estate             |
| Hlásenie security incidentu                   | security@inventario.estate            |
| Právne otázky / zmluvná korešpondencia        | legal@inventario.estate               |
| Konateľ                                       | Ing. Ján Letko, LTK Solutions, s.r.o. |

---

**LTK Solutions, s.r.o.** | Banícka 1894/17, 968 01 Nová Baňa | IČO: 45 949 310 | IČ DPH: SK2023148017 | OR OŽ Banská Bystrica, odd. Sro, vložka 19280/S
