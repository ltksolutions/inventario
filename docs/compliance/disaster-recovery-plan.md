<!--
SPDX-FileCopyrightText: 2026 LTK Solutions, s.r.o.
SPDX-License-Identifier: CC-BY-4.0
-->

# Disaster Recovery Plan — Inventario

**Interný procesný dokument** — postup LTK Solutions, s.r.o. pri výpadku alebo strate dát platformy Inventario.

| Atribút                   | Hodnota                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Verzia**                | 1.1                                                                                                                                    |
| **Posledná aktualizácia** | 2026-05-23 (DR Test #1 — PASS)                                                                                                         |
| **Vlastník**              | Ing. Ján Letko, konateľ LTK Solutions, s.r.o.                                                                                          |
| **Klasifikácia**          | Interný dokument — nezdieľať verejne                                                                                                   |
| **Súvisiace dokumenty**   | [Breach Notification Plan](./breach-notification-plan.md), [ROPA Processor view](./gdpr-article-30.md), [DPA](./legal/dpa-template.md) |

---

## 1. Ciele obnovy (RPO / RTO)

| Metrika                            | Cieľ       | Vysvetlenie                                      |
| ---------------------------------- | ---------- | ------------------------------------------------ |
| **RPO** (Recovery Point Objective) | ≤ 24 hodín | Maximálna strata dát — zálohy sú minimálne denné |
| **RTO** (Recovery Time Objective)  | ≤ 8 hodín  | Maximálny čas obnovy plnej funkčnosti po havárii |

> Tieto hodnoty sú deklarované v ToS (Príloha 2 SLA) a DPA (Príloha 2 technické opatrenia).
> **✅ DR Test #1 (2026-05-23): RPO ~23h ✅ RTO < 1 minúta ✅ — oba ciele splnené.** Viď `dr-test-log.md`.

---

## 2. Kritická infraštruktúra

| Komponent                   | Poskytovateľ                           | Kritickosť | Failover                                               |
| --------------------------- | -------------------------------------- | ---------- | ------------------------------------------------------ |
| **API + Frontend hosting**  | Vercel (cdg1 Paríž + fra1 Frankfurt)   | Kritická   | Automatický multi-region Vercel failover               |
| **Databáza**                | MongoDB Atlas Flex, AWS eu-central-1   | Kritická   | Atlas 3-node replica set, automatický primary election |
| **E-mail (transakčný)**     | Ecomail.cz                             | Vysoká     | Manuálne prepnutie na Resend                           |
| **DNS**                     | Doménový registrátor inventario.estate | Kritická   | Nízke TTL (300s) umožňuje rýchle prepnutie             |
| **OAuth — Microsoft Entra** | Microsoft Ireland                      | Stredná    | Zákazníci môžu použiť iný OAuth provider               |
| **OAuth — Google**          | Google Ireland                         | Stredná    | Zákazníci môžu použiť iný OAuth provider               |

---

## 3. Zálohovanie

### 3.1. MongoDB Atlas backups

| Parameter                  | Hodnota                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| **Typ zálohy**             | Continuous cloud backup (Atlas managed)                             |
| **Frekvencia**             | Kontinuálne (oplog) + denné snapshot                                |
| **Retention**              | 90 dní                                                              |
| **Lokalita zálohy**        | AWS eu-central-1 (Frankfurt) — rovnaký región ako primárna databáza |
| **Point-in-time recovery** | Dostupné — obnovenie na ľubovoľný okamih v rámci 90-dňového okna    |

### 3.2. Aplikačný kód

| Komponent                | Záloha                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------ |
| **Zdrojový kód**         | GitHub repozitár (primárny) + lokálne kópie vývojárov                                |
| **Environment premenné** | Uložené v Vercel (encrypted) + lokálna šifrovaná kópia v zabezpečenom trezore hesiel |
| **OpenAPI schema**       | Súčasť Git repozitára (`apps/api/openapi.json`)                                      |
| **JSON schémy**          | Generované automaticky pri build (`packages/shared-types/generated/`)                |

### 3.3. Čo NIE je zálohované automaticky

- **Vercel function logs** — 7-dňová rotácia, po vypršaní sú neobnoviteľné
- **Ecomail delivery logs** — 30-dňová rotácia na strane Ecomail

---

## 4. Scenáre havárie a postup obnovy

### Scenár A — Výpadok Vercel (API a Frontend nedostupné)

**Príznaky**: HTTP 500/503 na `app.inventario.estate` alebo `api.inventario.estate`, Vercel status page hlási incident.

**Postup**:

1. Skontroluj [status.vercel.com](https://status.vercel.com) a [status.vercel.com](https://status.vercel.com) — ak ide o globálny výpadok Vercel, čakaj na ich obnovu (typicky < 1 hodina)
2. Ak výpadok trvá > 2 hodiny, otvor Vercel Support ticket
3. Oznám Zákazníkom výpadok e-mailom (šablóna v sekcii 6.1)
4. Ak výpadok trvá > 8 hodín (RTO breach) — aktivuj eskaláciu a posúdi núdzové možnosti (self-hosting záložného deploymenta)

**Čas obnovy**: Typicky < 1 hodina (Vercel SLA 99.99%). Ak dlhší, posúdi núdzové možnosti.

---

### Scenár B — Výpadok MongoDB Atlas (databáza nedostupná)

**Príznaky**: API vracia 500 s chybou connection/timeout, Vercel logy obsahujú MongoDB connection errors.

**Postup**:

1. Skontroluj [status.mongodb.com](https://status.mongodb.com) — ak ide o AWS eu-central-1 incident, čakaj na ich obnovu
2. Skontroluj Atlas Cloud Manager — stav replica set, primary election
3. Ak replica set nemá primary (split brain alebo sieťový problém): Atlas automaticky vyberá nový primary do ~30 sekúnd
4. Ak výpadok trvá > 1 hodina bez automatickej obnovy: otvor MongoDB Atlas Support ticket (P1 severity)
5. Oznám Zákazníkom výpadok (šablóna v sekcii 6.1)

**Čas obnovy**: Replica set failover < 1 minúta (automatický). Regionálny výpadok AWS eu-central-1 — čakaj na MongoDB/AWS.

---

### Scenár C — Poškodenie alebo strata dát (accidental delete, corruption)

**Príznaky**: Zákazník nahlási chýbajúce dáta, nekonzistentnosť v dátach, alebo administrátorská chyba.

**Postup**:

1. **OKAMŽITE** zaznamenaj presný čas a rozsah straty
2. **Neprepisuj** postihnuté dokumenty — najprv záloha, potom oprava
3. Prihláš sa do MongoDB Atlas Cloud Manager → Backup → Point-in-time Restore
4. Vyber bod obnovy tesne pred incidentom
5. Obnov do **nového dočasného cluster-a** (nie do produkcie priamo)
6. Exportuj dotknuté dokumenty zo záložného cluster-a
7. Manuálne (alebo cez migration script) prenes nájdené dáta do produkčnej databázy
8. Overiť konzistentnosť ROPA a audit log záznamov
9. Informovať Zákazníka o rozsahu obnovenej/neobnoviteľnej straty
10. Ak ide o stratu osobných údajov → aktivovať Breach Notification Plan

**Dôležité**: Point-in-time recovery v Atlas je dostupné pre Flex tier v rámci 90-dňového okna. Pred použitím overiť aktuálne možnosti v Atlas dokumentácii.

---

### Scenár D — Kompromitácia deployment pipeline (supply chain attack)

**Príznaky**: Neočakávané zmeny v produkcii, podozrivé commity v repozitári, anomálie v Vercel deployment logoch.

**Postup**:

1. **OKAMŽITE** revoke všetky GitHub Actions secrets a Vercel environment tokens
2. Deaktivuj GitHub Actions workflow dočasne
3. Audit posledných 10 deploymentov v Vercel
4. Skontroluj GitHub audit log na neoprávnený prístup
5. Ak boli kompromitované env secrets (vrátane `MFA_SECRET_ENCRYPTION_KEY`):
   - Vygeneruj nové secrets
   - Aktualizuj v Vercel prod environment
   - Posúdi či treba invalidovať MFA secrets dotknutých používateľov
6. Aktivovať Breach Notification Plan ak boli dotknuté osobné údaje

---

### Scenár E — Celková strata produkčného prostredia (worst case)

**Príznaky**: Vercel účet zmazaný, databáza nedostupná a neobnoviteľná, repozitár nedostupný.

**Postup obnovy od nuly (cold start)**:

1. **Databáza** (čas: 2-4 hodiny):
   - Vytvor nový Atlas cluster (Flex tier, eu-central-1)
   - Obnov z posledného Atlas backup snapshot do nového cluster-a
   - Overiť dáta, integrity checks

2. **Aplikácia** (čas: 1-2 hodiny):
   - Naklonovať repozitár z GitHub (lokálna kópia je záloha)
   - Vytvoriť nový Vercel účet/projekt
   - Nastaviť env premenné zo zálohy (šifrovaný trezor hesiel)
   - Deploynúť z `main` branch

3. **DNS** (čas: 0-1 hodina):
   - Aktualizovať DNS záznamy v doménovom registrátore na nové Vercel deployments

4. **Overenie** (čas: 1 hodina):
   - Smoke test všetkých kritických funkcií
   - Verifikácia tenant izolácie (17 cross-tenant isolation testov)
   - OAuth login flow pre každý provider

**Celkový odhadovaný cold start čas: 4-7 hodín** — v rámci RTO ≤ 8 hodín.

---

## 5. DR test — postup a frekvencia

### 5.1. Pred prvým go-live (povinné)

Vykonaj **full restore test** zo zálohy:

1. Prihláš sa do Atlas Cloud Manager → Backup
2. Vyber záložný snapshot z predchádzajúceho dna
3. Spusti Point-in-time restore do nového dočasného test cluster-a
4. Spusti subset integračných testov (`pnpm test --testPathPattern=assets`) voči obnovenej databáze
5. Overiť že dáta sú konzistentné
6. Zmazať dočasný test cluster
7. Zdokumentovať výsledky (čas obnovy, počet obnov, problémy)

**Cieľ**: preukázať že RPO ≤ 24h a RTO ≤ 8h sú dosiahnuteľné.

### 5.2. Pravidelné testy (po go-live)

| Typ testu                | Frekvencia | Popis                                                 |
| ------------------------ | ---------- | ----------------------------------------------------- |
| **Záložný restore test** | Štvrťročne | Obnova do dočasného cluster-a, overenie integrity dát |
| **Tabletop exercise**    | Ročne      | Simulácia scenárov A-D bez reálneho výpadku           |
| **Penetration test**     | Ročne      | Pred každým ročným výročím go-live                    |

Výsledky testov zaznamenávať do `docs/compliance/dr-test-log.md` (vytvoriť pri prvom teste).

---

## 6. Komunikácia pri havárii

### 6.1. Oznámenie Zákazníkom pri výpadku

```
Predmet: [INVENTARIO STATUS] Výpadok služby – aktuálna situácia

Dobrý deň,

oznamujeme Vám, že platforma Inventario je momentálne nedostupná
z dôvodu: [technický opis].

Stav: prebieha obnova.
Odhadovaný čas obnovy: [čas].

Aktualizácie posielame každú hodinu alebo pri zmene stavu.

Kontakt: support@inventario.estate

S pozdravom,
LTK Solutions, s.r.o.
```

### 6.2. Oznámenie o obnovení služby

```
Predmet: [INVENTARIO STATUS] Služba obnovená

Dobrý deň,

platforma Inventario je opäť plne funkčná od [čas a dátum].

Príčina výpadku: [opis].
Dĺžka výpadku: [dĺžka].
Ovplyvnené funkcie: [ak relevantné].

Ak zaznamenáte akékoľvek problémy s Vašimi dátami, kontaktujte nás
okamžite na support@inventario.estate.

Plný post-mortem report publikujeme do 5 pracovných dní.

S pozdravom,
LTK Solutions, s.r.o.
```

---

## 7. Kľúčové prístupy a kontakty

> Tieto informácie uchovávať v **šifrovanom správcovi hesiel** (nie v tomto súbore, ktorý je v Git repozitári).

| Systém               | Kde nájsť prístupy                      | Záložná kópia                    |
| -------------------- | --------------------------------------- | -------------------------------- |
| Vercel dashboard     | Prihlasovacie údaje v password manageri | 2FA záložné kódy v trezore       |
| MongoDB Atlas        | Prihlasovacie údaje v password manageri | Org Admin kódy v trezore         |
| GitHub repozitár     | SSH kľúče na vývojárskom stroji         | Záloha SSH kľúčov v trezore      |
| Vercel env secrets   | Exportné kópie v šifrovanom trezore     | Aktualizovať po každej zmene env |
| Doménový registrátor | Prihlasovacie údaje v password manageri | 2FA záložné kódy v trezore       |

**GDPR záväzok**: Prístupy do produkčných systémov mať len na zariadeniach s disk encryption (FileVault na macOS). Nikdy neposielať produkčné credentials e-mailom ani Slackom.

---

## 8. Aktualizácia plánu

Tento dokument aktualizovať pri:

- Zmene infraštruktúry (nový Sub-processor, zmena clustering, nový región)
- Výsledkoch DR testov (ak test odhalí medzery)
- Zmene RTO/RPO cieľov v ToS alebo DPA
- Nových scenároch havárií zistených pri tabletop cvičeniach

---

## 9. Zmenová história

| Verzia | Dátum      | Zmena                                                                                              |
| ------ | ---------- | -------------------------------------------------------------------------------------------------- |
| 1.0    | 2026-05-21 | Prvá verzia DR Planu pre platformu Inventario.                                                     |
| 1.1    | 2026-05-23 | DR Test #1 — PASS. RPO/RTO overené. Vytvorený `dr-test-log.md`. Poznámka o Flex tier obmedzeniach. |

---

**Klasifikácia**: Interný dokument. Nezdieľať verejne — obsahuje informácie o infraštruktúre.
