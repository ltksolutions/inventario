<!--
SPDX-FileCopyrightText: 2026 LTK Solutions, s.r.o.
SPDX-License-Identifier: CC-BY-4.0
-->

# Threshold Assessment / DPIA Pre-screen — platforma Inventario

> **Účel dokumentu**: formálne posúdiť, či poskytovanie platformy **Inventario** zo strany LTK Solutions, s.r.o. vyžaduje vyhotovenie posúdenia vplyvu na ochranu osobných údajov (DPIA) podľa čl. 35 GDPR. Tento dokument predstavuje **threshold assessment** — predbežné zhodnotenie kritérií, ktorého výstupom je rozhodnutie „DPIA je / nie je potrebná".

| Atribút                      | Hodnota                                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Verzia**                   | 1.0                                                                                                                                                                                        |
| **Posledná aktualizácia**    | _\[doplniť pri publikácii\]_                                                                                                                                                               |
| **Zodpovedný subjekt**       | LTK Solutions, s.r.o., Banícka 1894/17, 968 01 Nová Baňa, IČO 45 949 310                                                                                                                   |
| **Štatutárny zástupca**      | Ing. Ján Letko, konateľ                                                                                                                                                                    |
| **Predmet posudzovania**     | Platforma Inventario ako celok (multi-tenant SaaS pre evidenciu a vypožičiavanie majetku)                                                                                                  |
| **Rola LTK pri posudzovaní** | Sprostredkovateľ (čl. 4 ods. 8 GDPR) pre tenant-ov platformy                                                                                                                               |
| **Posúdenie podľa**          | GDPR čl. 35; EDPB Guidelines WP248 rev.01; zoznam ÚOOÚ SR podľa čl. 35 ods. 4 GDPR                                                                                                         |
| **Výstup**                   | Záväzný interný záver + podpora tenant-ov pri ich vlastnom DPIA threshold assessmente                                                                                                      |
| **Súvisiace dokumenty**      | [ROPA Processor view](./gdpr-article-30.md), [ROPA Controller view](./gdpr-article-30-controller.md), [DPA Template](./legal/dpa-template.md), [Sub-processors](./legal/sub-processors.md) |

---

## TL;DR

Platforma Inventario **nepadá pod žiaden z troch obligatórnych triggerov DPIA** podľa GDPR čl. 35 ods. 3. Z deviatich kritérií EDPB Guidelines WP248 rev.01 sa **prísne nesplňa žiadne**, dve sa nachádzajú v hraničnom pásme (systematic monitoring cez audit log; zamestnanci ako potenciálne zraniteľné subjekty), ale ani jedno nesplňa intenzitu, ktorú EDPB pre DPIA požaduje. Zoznam ÚOOÚ SR podľa čl. 35 ods. 4 GDPR neobsahuje operáciu, ktorú by Inventario typovo vykonávalo.

**Záver**: **DPIA nie je povinná** zo strany LTK Solutions ako sprostredkovateľa pre platformu Inventario ako celok. Tento záver sa **nevzťahuje na konkrétneho tenant-a (prevádzkovateľa)**, ktorý musí samostatne posúdiť svoj špecifický use-case (napr. orgán verejnej moci, spracúvanie údajov detí, kombinácia s ďalšími systémami) a v prípade potreby DPIA vyhotoviť. LTK poskytne tenant-om podporu prostredníctvom DPIA Reference Pack (planned, Compliance Fáza 2).

---

## 1. Účel a kontext dokumentu

### 1.1. Prečo robíme threshold assessment

Sprostredkovateľ podľa GDPR nemá explicitnú zákonnú povinnosť vyhotoviť vlastnú DPIA — to je primárne povinnosť prevádzkovateľa (čl. 35 ods. 1). LTK Solutions však tento dokument vyhotovuje z troch dôvodov:

1. **Accountability princíp (čl. 5 ods. 2 GDPR)** — preukázateľný dôkaz, že sme uvážili, či naše spracovanie spadá pod DPIA trigger, a zaznamenali sme výsledok aj odôvodnenie
2. **Podpora tenant-ov pri ich vlastnom posúdení** (čl. 28 ods. 3 písm. f GDPR — sprostredkovateľ je povinný pomáhať prevádzkovateľovi s DPIA) — tenant si tento dokument môže priložiť k vlastnej dokumentácii ako súčasť svojej analýzy
3. **Audit a dozorný orgán** — pripravený dokument pre prípad otázky ÚOOÚ SR alebo iného EU dozorného orgánu

### 1.2. Rozsah a vymedzenie

Tento dokument posudzuje **platformu Inventario ako celok** v rozsahu spracovateľských operácií evidovaných v [ROPA Processor view](./gdpr-article-30.md):

- autentifikácia a správa používateľov (slice #2, #6, #7)
- evidencia a správa majetku (slice #2b, #3)
- vypožičiavanie majetku (slice #5)
- pozvánky používateľov (slice #6c K18)
- audit log (cross-cutting)
- tenant lifecycle (organisations)

**Nepatrí sem** posudzovanie:

- **vlastných business operations LTK Solutions** (HR, fakturácia, marketing webu) — tie sú pokryté v [ROPA Controller view, sekcia 6](./gdpr-article-30-controller.md#6-threshold-assessment-dpia) s vlastným threshold záverom (DPIA nepovinná aj pre controller scope)
- **konkrétnych tenant-specific use-cases**, ktoré môžu pridať vlastné rizikové faktory (napr. tenant z verejného sektora, spracovanie údajov maloletých nad rámec proxy modelu, integrácia s ďalšími systémami) — tenant si robí vlastné posúdenie

### 1.3. Metodika

Posúdenie vychádza z troch zdrojov, v poradí záväznosti:

1. **GDPR čl. 35 ods. 3** — tri obligatórne situácie, kde je DPIA bezpodmienečne povinná
2. **EDPB Guidelines on DPIA (WP248 rev.01)** — devätorové kritériá; ak sú splnené **dve a viac**, DPIA je spravidla potrebná; jedno splnené kritérium môže DPIA odôvodniť pri vyššej intenzite
3. **Zoznam ÚOOÚ SR** spracovateľských operácií podliehajúcich DPIA podľa čl. 35 ods. 4 GDPR — slovenský dozorný orgán publikuje typovaný zoznam

Pre každé kritérium rozhodujeme: ❌ neaplikuje sa / ⚠️ hraničné (zdôvodnenie) / ✅ aplikuje sa.

---

## 2. Predmet posudzovania — Platforma Inventario

### 2.1. Stručný popis

Inventario je **multi-tenant SaaS platforma pre evidenciu a vypožičiavanie majetku**. Cieľová skupina: športové federácie, mestá a obce, vyššie územné celky, športové kluby, školy a školské zariadenia, občianske združenia, neziskové organizácie. Architektúra je multi-tenant s logickou izoláciou cez `organisationId` na úrovni databázových dokumentov (viď [ADR-0010](../decisions/0010-multi-tenant-white-label.md)).

Platforma rieši operatívny problém „kde čo máme a kto si to vzal" — vedenie inventára fyzických aktív, ich kategorizáciu, umiestnenie, stav, vypožičky s schvaľovacím workflow a protokolmi prevzatia/vrátenia.

### 2.2. Kto spracúva čo a v akej role

| Subjekt                                         | Rola                            | Predmet spracovania                                                                                                                                                           |
| ----------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tenant** (federácia, mesto, klub, škola, ...) | Prevádzkovateľ (čl. 4 ods. 7)   | Určuje účel a prostriedky spracovania osobných údajov svojich zamestnancov / členov / spolupracovníkov                                                                        |
| **LTK Solutions, s.r.o.**                       | Sprostredkovateľ (čl. 4 ods. 8) | Hostuje platformu, prevádzkuje infraštruktúru, spracúva údaje výlučne na pokyn Prevádzkovateľa podľa DPA                                                                      |
| **Sub-procesori**                               | Ďalší sprostredkovatelia        | Hosting (Vercel, MongoDB Atlas), e-mail delivery (Ecomail.cz / opt-in Resend), OAuth identita (Microsoft, Google, Apple) — viď [sub-processors.md](./legal/sub-processors.md) |

### 2.3. Kategórie spracúvaných osobných údajov (sumár)

Detail viď [ROPA Processor view, sekcia 1](./gdpr-article-30.md#1-spracovateľské-operácie-article-30-inventory). Sumárne:

- **identifikačné** — meno, priezvisko, displayName, OAuth ID (Entra OID, Google sub, Apple sub), `organisationId`
- **kontaktné** — e-mailová adresa, voliteľne telefón
- **autentifikačné** — argon2id hash hesla, AES-256-GCM šifrovaný TOTP secret, argon2id hashované recovery kódy (žiadne uložené v plaintexte)
- **účtové** — rola, isActive, lastLoginAt, accountType, preferences, organizačná jednotka, tímy
- **transakčné** — kto kedy aký asset vytvoril/upravil/zmazal/vypožičal/vrátil; schvaľovací workflow; digitálny podpis (sken obrázku alebo click-to-sign) na protokoloch
- **audit metadata** — `actor.userId`, `actor.displayName` snapshot, `actor.accountType`, `actor.ipAddress`, `actor.userAgent`, časová pečiatka, typ akcie

### 2.4. Výslovne NIE sú spracúvané

- **Special category data podľa čl. 9 GDPR** — žiadne údaje o rasovom alebo etnickom pôvode, politických názoroch, náboženstve, členstve v odboroch, genetické, biometrické v zmysle definície, zdravotné, sexuálnom živote ani orientácii
- **Údaje o odsúdeniach a trestných činoch podľa čl. 10 GDPR** — žiadne
- **Biometrické údaje** v zmysle čl. 4 ods. 14 GDPR — digitálne podpisy na protokoloch (sken obrázku, click-to-sign) **nie sú biometrickými údajmi**; nedochádza k automatizovanému spracúvaniu osobitne identifikujúcich fyzických/fyziologických charakteristík — viď [ROPA, sekcia 1.3, poznámka k podpisom](./gdpr-article-30.md#13-vypožičiavanie-majetku-loans)
- **Lokačné údaje fyzických osôb** — platforma vedie lokality **aktív** (umiestnenie majetku), nie sledovanie pohybu osôb
- **Behavioral / komunikačná analytika** — žiadny tracking používateľov medzi sessions, žiadne fingerprinting, žiadne content analytics

### 2.5. Hosting a transferový kontext

- **Primárne uloženie**: EÚ — Vercel cdg1/fra1 + MongoDB Atlas eu-central-1 (Frankfurt)
- **E-mail delivery default**: Ecomail.cz, s.r.o. (Česká republika, EÚ)
- **OAuth providers**: Microsoft Ireland, Google Ireland, Apple Distribution International (Írsko); transfer mimo EÚ riešený DPA + SCCs jednotlivých providerov
- **Šifrovanie**: TLS 1.3 in transit; AES-256 at rest (Atlas default); argon2id pre heslá; AES-256-GCM pre TOTP secrets
- **Žiadne cezhraničné prenosy primárneho úložiska** mimo EÚ

---

## 3. Posúdenie podľa GDPR čl. 35 ods. 3 — obligatórne triggery

Čl. 35 ods. 3 GDPR stanovuje tri situácie, kedy je DPIA **bezpodmienečne povinná**. Posúdenie každej:

### 3.1. Písm. a) Systematické a rozsiahle hodnotenie osobných aspektov založené na automatizovanom spracúvaní vrátane profilovania, na základe ktorého sa prijímajú rozhodnutia s právnymi účinkami alebo podobne významnými dôsledkami

**Záver: ❌ Neaplikuje sa.**

**Odôvodnenie**: Inventario nevykonáva profilovanie ani automatizované rozhodovanie podľa čl. 22 GDPR. Žiadne scoring, hodnotenie výkonu, predikcie ani algoritmické rozhodovanie. Schválenie / zamietnutie vypožičky vykonáva manuálne ľudský schvaľovateľ (ASSET_MANAGER alebo ADMIN) — platforma poskytuje workflow, nie automatický verdikt. RBAC role sa udeľujú manuálne tenant administrátorom, nie algoritmicky.

### 3.2. Písm. b) Spracúvanie osobitných kategórií údajov uvedených v článku 9 ods. 1 alebo údajov týkajúcich sa odsúdení podľa článku 10 vo veľkom rozsahu

**Záver: ❌ Neaplikuje sa.**

**Odôvodnenie**: Platforma nešpracúva žiadne special category data podľa čl. 9 (rasový pôvod, politické názory, náboženstvo, odbory, genetické, biometrické, zdravotné, sexuálny život alebo orientácia) ani údaje o odsúdeniach a trestných činoch podľa čl. 10. Bod „vo veľkom rozsahu" je preto neaktuálny — bázová podmienka (existencia takého spracovania vôbec) sa nesplňa.

### 3.3. Písm. c) Systematické monitorovanie verejne prístupných miest vo veľkom rozsahu

**Záver: ❌ Neaplikuje sa.**

**Odôvodnenie**: Inventario nešpracúva údaje z CCTV, IoT senzorov vo verejnom priestore, location-based tracking ani inú formu monitorovania verejne prístupných miest. Lokácie evidované v systéme sa týkajú **aktív** (sklady, kancelárie, regály), nie pohybu fyzických osôb.

### 3.4. Sumár obligatórnych triggerov

| Trigger čl. 35 ods. 3 GDPR                                        | Výsledok |
| ----------------------------------------------------------------- | -------- |
| Písm. a) — automatizované rozhodovanie s legal/significant effect | ❌       |
| Písm. b) — large-scale special categories / criminal data         | ❌       |
| Písm. c) — systematic monitoring of public area                   | ❌       |

**Žiaden obligatórny trigger sa neaplikuje.** Posúdenie pokračuje deviatorovými kritériami EDPB.

---

## 4. Posúdenie podľa EDPB Guidelines WP248 rev.01

EDPB (predtým Article 29 Working Party) v dokumente _Guidelines on Data Protection Impact Assessment (DPIA) and determining whether processing is "likely to result in a high risk" for the purposes of Regulation 2016/679_ (WP248 rev.01, prijaté 4. apríla 2017, schválené EDPB 25. mája 2018) definuje **deväť kritérií**. Praktické pravidlo: ak sú splnené **dve a viac** kritériá, DPIA je spravidla potrebná. Jedno kritérium môže DPIA odôvodniť pri vyššej intenzite.

### 4.1. Prehľadová tabuľka

| #   | Kritérium                                                      | Výsledok | Stručné odôvodnenie                                                                        |
| --- | -------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| 1   | Evaluation alebo scoring                                       | ❌       | Žiadne profilovanie, hodnotenie ani scoring používateľov                                   |
| 2   | Automated decision-making s legal alebo significant effect     | ❌       | Žiadne automatické rozhodnutia s právnym alebo podobne významným dôsledkom                 |
| 3   | Systematic monitoring                                          | ⚠️       | Hraničné — audit log eviduje aktivitu, ale nie je monitorovacia funkcia (viď 4.4)          |
| 4   | Sensitive data alebo data of a highly personal nature          | ❌       | Žiadne čl. 9 / čl. 10 GDPR údaje; obvyklé identifikačné a pracovné                         |
| 5   | Data processed on a large scale                                | ❌       | Typicky stovky až nízke tisíce subjektov per tenant; nedosahuje EDPB definíciu large-scale |
| 6   | Matching alebo combining datasets                              | ❌       | Žiadne kombinovanie datasetov z rôznych zdrojov                                            |
| 7   | Data concerning vulnerable data subjects                       | ⚠️       | Hraničné — zamestnanci ako kategória v power imbalance, ale v slabej intenzite (viď 4.8)   |
| 8   | Innovative use alebo applying new technological solutions      | ❌       | Štandardné CRUD + audit; AI nie je v runtime platforme (Anthropic je dev-only)             |
| 9   | When processing prevents data subjects from exercising a right | ❌       | Subjekty môžu uplatniť práva cez tenant admin alebo priamo                                 |

**Skóre: 0 splnených, 2 hraničné.** Tieto sa rozpisujú nižšie.

### 4.2. Kritérium 1 — Evaluation alebo scoring

**Výsledok: ❌ Neaplikuje sa.**

Inventario neimplementuje žiadne profilovanie podľa čl. 4 ods. 4 GDPR. Nevyhodnocuje sa správanie používateľov, žiadne predikcie, žiadne ratingy. Žiadny credit scoring, žiadny performance evaluation modul. Audit log eviduje _fakty_ o uskutočnených operáciách, nie _hodnotenie_ alebo _odhad_ osobných aspektov.

### 4.3. Kritérium 2 — Automated decision-making

**Výsledok: ❌ Neaplikuje sa.**

Schválenie vypožičky, udelenie role, deaktivácia účtu, schválenie pozvánky — všetky tieto kroky vykonáva manuálne ľudský aktér (ADMIN alebo ASSET_MANAGER). Platforma poskytuje workflow infrastructure (formuláre, notifikácie, audit), ale **rozhodnutie samotné nie je automatizované** v zmysle čl. 22 GDPR.

### 4.4. Kritérium 3 — Systematic monitoring ⚠️ HRANIČNÉ

**Výsledok: ⚠️ Hraničné — analýza nižšie.**

EDPB v WP248 definuje „systematic monitoring" ako spracovanie, ktorým **„are observed, monitored or controlled data subjects, including data collected through 'a systematic and extensive evaluation of personal aspects' or through networks or 'a systematic monitoring of a publicly accessible area' (Article 35(3)(c))"**. Typické príklady: CCTV vo verejnom priestore, location tracking zamestnancov, behavioral analytics, sledovanie zamestnaneckej komunikácie, monitoring on-line aktivity.

**Aplikácia na Inventario**: Platforma vedie **audit log** všetkých významných operácií (viď [ROPA, sekcia 1.5](./gdpr-article-30.md#15-audit-log-cross-cutting)). Tento log obsahuje meno aktéra, IP adresu, časovú pečiatku a typ akcie. Tenant administrátor má read access k tomuto logu v rámci svojho tenant scope.

**Argumenty proti zaradeniu pod „systematic monitoring"**:

1. **Účel a podstata audit logu** — slúži na splnenie povinnosti accountability podľa čl. 5 ods. 2 GDPR a na security incident response. Je to **dôsledok regulácie**, nie monitoring nástroj. Bez audit logu by platforma nesplňovala vlastné GDPR povinnosti.
2. **Rozsah údajov** — audit log eviduje **fakty o vykonaných operáciách** (CRUD akcie na majetku, prihlásenia), nie **správanie zamestnanca** v širšom zmysle. Neeviduje obsah komunikácie, pohyb mimo aplikácie, používanie iných aplikácií, výkon, prestávky.
3. **EDPB Working Party 29 Opinion 2/2017 on data processing at work** — explicitne rozlišuje medzi _legitimate workplace logging_ (povolené, často povinné z compliance dôvodov) a _systematic employee monitoring_ (vyžaduje DPIA). Audit log v rozsahu Inventario spadá pod prvú kategóriu.
4. **Porovnanie s analogickými systémami** — ERP, CRM, helpdesk, HR information system, version control (Git), ticket tracker — všetky vedú audit log v podobnom rozsahu a typovo nevyžadujú DPIA z tohto dôvodu.

**Argumenty pre zaradenie**:

- IP adresa je súčasť audit záznamu, čo môže byť vnímané ako _„kde sa zamestnanec nachádzal"_ (hoci v praxi je to IP z home internet routera alebo firemnej siete, nie geolokácia).
- Tenant administrátor môže audit log použiť na neformálne _„kto čo robí"_ dotazovanie, ktoré sa môže priblížiť monitoringu výkonu.

**Hodnotenie intenzity**: Argumenty proti zaradeniu sú silné a opreté o EDPB výklad. Hraničný status sa zachováva pre transparentnosť, ale **toto kritérium samotné nedosahuje intenzitu, ktorá by vyžadovala DPIA**.

**Mitigácia**: Audit log retention je obmedzená (24 mesiacov pre bežné akcie, 60 mesiacov pre security udalosti); IP adresy sa pseudonymizujú po retention; tenant administrátor je viazaný GDPR povinnosťami voči svojim zamestnancom (musí ich informovať o existencii audit logu v interných predpisoch / pracovnom poriadku — toto je úloha tenant-a, podporujeme ju vzorovou dokumentáciou).

### 4.5. Kritérium 4 — Sensitive data alebo data of a highly personal nature

**Výsledok: ❌ Neaplikuje sa.**

Spracúvané kategórie: identifikačné, kontaktné, pracovné (rola, organisationId), autentifikačné (hashované). Žiadne čl. 9 ani čl. 10 údaje. Žiadne finančné účty (LTK nepristupuje k bankovým údajom — fakturácia je samostatný controller-side proces). Žiadne údaje o súkromnom živote, lokácii bydliska, rodinnom stave. WP248 ako „highly personal" cituje napr. komunikačnú obsahovú analýzu, sledovanie polohy, finančné transakcie a podobne — žiadne z toho sa neuplatňuje.

### 4.6. Kritérium 5 — Large-scale processing

**Výsledok: ❌ Neaplikuje sa.**

EDPB v WP248 odporúča pri určovaní „large-scale" zvážiť: počet dotknutých subjektov, objem dát, trvanie, geografický rozsah. Príklady large-scale uvádza ako: nemocnica, vyhľadávač, ISP, banka, poisťovňa.

**Aplikácia na Inventario**: Typický tenant je organizácia s desiatkami až nízkymi tisíckami zamestnancov / členov. Aj pri viacerých tenantoch (predpoklad 10–50 v strednodobom horizonte) je celková suma dotknutých subjektov v desiatkach tisíc, čo zodpovedá **medium-scale** v EDPB chápaní. Geograficky je rozsah primárne Slovensko + okolité krajiny. Trvanie je dlhodobé, ale to platí pre každý SaaS.

Inventario teda nedosahuje úroveň „large-scale" v zmysle WP248. (Pre porovnanie: jediný tenant nemocnice s 500 zamestnancami pre Inventario nepovažujeme za large-scale; nemocnica spracúvajúca zdravotné záznamy 500 000 pacientov je large-scale.)

**Trigger pre re-assessment**: ak by sa celkový počet dotknutých subjektov na platforme dostal nad 100 000, znovu posúdime toto kritérium.

### 4.7. Kritérium 6 — Matching alebo combining datasets

**Výsledok: ❌ Neaplikuje sa.**

Inventario nekombinuje datasety z rôznych zdrojov mimo platformy. Údaje pochádzajú výlučne z troch interných zdrojov: (a) OAuth identity providery pri prihlásení (e-mail + identifikátor), (b) tenant administrátor pri JIT provisioningu alebo pozvaní, (c) sám používateľ pri vyplnení svojho profilu. Žiadne pripájanie k externým databázam, žiadne data brokers, žiadne enrichment služby.

### 4.8. Kritérium 7 — Data concerning vulnerable data subjects ⚠️ HRANIČNÉ

**Výsledok: ⚠️ Hraničné — analýza nižšie.**

EDPB v WP248 vymenúva ako zraniteľné subjekty: **„children, employees, more vulnerable segments of the population requiring special protection (mentally ill persons, asylum seekers, the elderly, patients, etc.), and in any case where an imbalance in the relationship between the position of the data subject and the controller can be identified"**.

**Aplikácia na Inventario**: Primárna kategória dotknutých subjektov sú **zamestnanci, členovia, externí spolupracovníci tenant-ov**. Zamestnanci sú v dokumente EDPB výslovne uvedení ako kategória s mocenskou nerovnováhou voči zamestnávateľovi.

**Argumenty proti silnému zaradeniu**:

1. **Univerzalita kritéria** — ak by zamestnanci v každom B2B SaaS platili ako „vulnerable" s plnou intenzitou WP248, DPIA by potrebovala doslova každá HR, helpdesk, project management, payroll a ERP aplikácia. To zjavne nie je výklad, ktorý EDPB zamýšľa.
2. **Intencia EDPB** — WP248 v plnom kontexte hovorí o vulnerable v situácii, keď spracúvanie _priamo dopadá_ na zraniteľnosť subjektu (napr. employee monitoring s disciplinárnymi dôsledkami, surveillance zamestnaneckej komunikácie, psychologické testovanie). Inventario nie je v tejto kategórii — je to operatívny inventárny systém, podobný napr. dochádzkovému systému alebo helpdesk-u.
3. **Spôsob používania** — zamestnanec používa Inventario ako pracovný nástroj na evidenciu majetku alebo vypožičanie športovej výbavy. Účasť je súčasťou pracovnoprávneho vzťahu, nie podmienkou nadradenou normám práce. Subjekt môže namietať voči ne-nevyhnutnému spracovaniu (právo námietky čl. 21) cez tenant administrátora a v krajnom prípade ÚOOÚ SR.
4. **Maloletí** — ak tenant používa Inventario pre situáciu, kde dotknutý subjekt je maloletý (napr. mládežnícky športový klub eviduje dresy a vypožičky pre hráčov pod 18), platforma model zachytáva cez **rodiča ako proxy** (`accountType`, rodičovský súhlas v UI je v roadmap). Maloletý sám nemá účet; existujú scenáre, kde je vhodné, aby tenant vykonal vlastné DPIA — toto rieši odporúčanie v sekcii 7.

**Hodnotenie intenzity**: Toto kritérium je technicky splnené v tom zmysle, že primárna populácia (zamestnanci) zodpovedá kategórii uvedenej v WP248. Intenzita však je **nízka** — Inventario nedopadá na zraniteľnosť subjektov v zmysle, ktorý EDPB zamýšľa. Kritérium ostáva v hraničnom statuse, ale samotné nedosahuje intenzitu, ktorá by vyžadovala DPIA.

**Mitigácia**: Subjekty údajov majú práva podľa Kapitoly III GDPR (prístup, oprava, výmaz, obmedzenie, prenosnosť, námietka, sťažnosť dozornému orgánu). Tenant je povinný v internej dokumentácii informovať svojich zamestnancov o spracovaní cez Inventario (Privacy notice na strane tenant-a).

### 4.9. Kritérium 8 — Innovative use alebo new technological solutions

**Výsledok: ❌ Neaplikuje sa.**

Inventario používa **štandardnú architektúru** SaaS aplikácie: Fastify + MongoDB + Next.js + multi-provider OAuth + TOTP MFA podľa RFC 6238 + RBAC + audit log. Žiadne AI / ML v runtime, žiadne IoT, žiadny blockchain, žiadne biometrické rozpoznávanie, žiadna behavioral analytika.

Anthropic Claude AI sa používa **iba pri vývoji** zo strany LTK Solutions (code generation, dokumentácia) a **nemá runtime prístup** k platforme ani k osobným údajom tenant-ov — viď [Sub-processors, sekcia 3.1](./legal/sub-processors.md#31-anthropic-pbc).

**Trigger pre re-assessment**: ak by sa v platforme zaviedli AI features s prístupom k customer dátam (napr. AI-powered search, automated categorisation, recommendation engine), toto kritérium sa znovu posúdi a pravdepodobne sa preklopí na ⚠️ alebo ✅.

### 4.10. Kritérium 9 — Processing prevents data subjects from exercising a right

**Výsledok: ❌ Neaplikuje sa.**

Inventario neblokuje uplatňovanie práv subjektov údajov. Naopak — implementuje funkčnosť pre tenant administrátora, ktorou môže žiadosti subjektov splniť (export, oprava, soft-delete, neskôr aj hard erasure). Subjekt môže svoje práva uplatniť cez tenant administrátora alebo priamo na privacy@inventario.estate (LTK presmeruje do 5 pracovných dní). Žiadny zmluvný „blackout", žiadne podmienky znemožňujúce vymazanie.

### 4.11. Záver EDPB analýzy

| Položka                       | Hodnota                                                    |
| ----------------------------- | ---------------------------------------------------------- |
| Plne splnené kritériá         | **0 z 9**                                                  |
| Hraničné kritériá             | **2 z 9** (kritérium 3 audit log, kritérium 7 zamestnanci) |
| Plne nesplnené kritériá       | **7 z 9**                                                  |
| Intenzita hraničných kritérií | Nízka — argumenty proti zaradeniu prevažujú                |

**Pravidlo EDPB**: 2+ plne splnené kritériá → DPIA spravidla potrebná. **Naše skóre 0 plne + 2 hraničné s nízkou intenzitou je pod prahom DPIA povinnosti.**

---

## 5. Posúdenie podľa zoznamu ÚOOÚ SR (čl. 35 ods. 4 GDPR)

ÚOOÚ SR — slovenský dozorný orgán — publikuje **zoznam spracovateľských operácií, ktoré podliehajú povinnosti vyhotoviť DPIA** podľa čl. 35 ods. 4 GDPR. Zoznam je dostupný na webovej stránke ÚOOÚ SR ([dataprotection.gov.sk](https://dataprotection.gov.sk)).

### 5.1. Posúdenie typových bodov zoznamu

Zoznam ÚOOÚ SR pokrýva typovo nasledujúce kategórie. Pre každú posudzujeme aplikovateľnosť na Inventario:

| Typ operácie zo zoznamu ÚOOÚ SR (parafrázované)                                | Aplikuje sa na Inventario? | Poznámka                                                                               |
| ------------------------------------------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------- |
| Systematické a rozsiahle vyhodnocovanie osobných aspektov vrátane profilovania | ❌                         | Žiadne profilovanie ani scoring                                                        |
| Spracúvanie osobitných kategórií údajov vo veľkom rozsahu                      | ❌                         | Žiadne čl. 9 GDPR údaje                                                                |
| Systematické monitorovanie zamestnancov                                        | ⚠️ → ❌                    | Audit log nie je workplace monitoring v intenzite zoznamu (viď 4.4)                    |
| Spracúvanie biometrických údajov na účely jednoznačnej identifikácie           | ❌                         | Digitálne podpisy na protokoloch nie sú biometrické v zmysle čl. 4 ods. 14             |
| Spracúvanie genetických údajov                                                 | ❌                         | Žiadne                                                                                 |
| Spracúvanie údajov o polohe fyzických osôb vo veľkom rozsahu                   | ❌                         | Lokácie sú aktív, nie osôb                                                             |
| Spracúvanie údajov detí                                                        | ⚠️ podmienené tenant-om    | Iba ak tenant používa Inventario pre maloletých (cez proxy model rodiča) — tenant DPIA |
| Spracúvanie údajov osobitne zraniteľných osôb (väzni, žiadatelia o azyl, ...)  | ❌                         | Nie cieľová skupina Inventario                                                         |
| Spracúvanie s využitím inovatívnych technológií (AI, IoT, biometria)           | ❌                         | Štandardné CRUD + audit, žiadna AI v runtime                                           |
| Kombinovanie alebo párovanie datasetov z rôznych zdrojov                       | ❌                         | Žiadne                                                                                 |
| Spracúvanie údajov bez možnosti uplatniť práva dotknutej osoby                 | ❌                         | Práva implementované cez tenant admin alebo priamo                                     |
| Spracúvanie údajov v rozsahu, ktorý môže viesť k diskriminácii                 | ❌                         | Žiadne                                                                                 |

### 5.2. Sumár ÚOOÚ SR posúdenia

Žiaden bod zoznamu ÚOOÚ SR sa neaplikuje na Inventario v intenzite, ktorá by vyžadovala DPIA. Jediný hraničný bod (systematické monitorovanie zamestnancov) sa po analýze v sekcii 4.4 vyhodnotil ako neaktuálny pre audit log Inventaria.

> **Poznámka k aktualizácii**: Zoznam ÚOOÚ SR sa môže meniť. Tento dokument sa pri každej publikovanej novelizácii zoznamu prehodnocuje (viď sekcia 8 — Triggery pre re-assessment).

---

## 6. Celkové vyhodnotenie

### 6.1. Záväzný záver

Na základe posúdenia:

- **GDPR čl. 35 ods. 3** — žiaden z troch obligatórnych triggerov sa neaplikuje
- **EDPB Guidelines WP248 rev.01** — 0 plne splnených kritérií, 2 hraničné s nízkou intenzitou, 7 plne nesplnených
- **Zoznam ÚOOÚ SR (čl. 35 ods. 4 GDPR)** — žiaden bod sa neaplikuje v intenzite vyžadujúcej DPIA

**Záver**:

> **DPIA podľa čl. 35 GDPR nie je povinná zo strany LTK Solutions, s.r.o. ako sprostredkovateľa pre platformu Inventario ako celok v jej súčasnom funkčnom rozsahu (slice #1 — #7, stav k _\[doplniť dátum publikácie\]_).**

### 6.2. Obmedzenia záveru

Tento záver **NEZAHŔŇA**:

1. **Konkrétneho tenant-a** — prevádzkovateľ má vlastnú povinnosť podľa čl. 35 ods. 1 GDPR posúdiť, či jeho špecifický use-case vyžaduje DPIA. Faktory, ktoré môžu DPIA vyžadovať na strane tenant-a:
   - tenant je orgán verejnej moci v zmysle čl. 35 ods. 10 (kde DPIA môže byť potrebná aj keď platforma sama o sebe nepadá pod trigger)
   - tenant kombinuje Inventario s ďalšími systémami obsahujúcimi citlivé údaje
   - tenant používa Inventario pre populáciu maloletých nad rámec proxy modelu
   - tenant je v sektore so sektorovými predpismi nad rámec GDPR (zdravotníctvo, kritická infraštruktúra, finančný sektor)
   - vlastný zoznam dozorného orgánu členského štátu, v ktorom tenant pôsobí, môže obsahovať dodatočné typové operácie
2. **Budúce rozšírenia funkcionality** — tento záver platí pre aktuálny rozsah platformy. Pred spustením nových features s vyšším rizikovým profilom (AI, biometria, integrovaný geolokačný tracking, scoring) sa záver musí prehodnotiť (viď sekcia 8)
3. **Vlastné business operations LTK Solutions** — pre LTK ako prevádzkovateľa (HR, marketing, fakturácia, vendor management) platí samostatný threshold assessment v [ROPA Controller view, sekcia 6](./gdpr-article-30-controller.md#6-threshold-assessment-dpia), so záverom rovnako negatívnym (DPIA nepovinná) v inom skutkovom rámci

### 6.3. Naša povinnosť pomoci

Hoci DPIA nie je z našej strany povinná, LTK Solutions zostáva podľa čl. 28 ods. 3 písm. f GDPR **povinný poskytovať pomoc prevádzkovateľovi pri jeho vlastnom DPIA**. Túto pomoc zabezpečujeme cez:

1. Tento dokument (technický popis + vyhodnotenie trigger-ov pre platformu ako celok)
2. [ROPA Processor view](./gdpr-article-30.md) s detailmi spracovateľských operácií, kategórií údajov a opatrení
3. [DPA Template](./legal/dpa-template.md) s opatreniami, sub-procesormi, retention a breach notification procedúrami
4. [Sub-processors list](./legal/sub-processors.md) — verejný register s detailmi
5. **DPIA Reference Pack** (planned, Compliance Fáza 2) — pre-filled template DPIA na strane tenant-a, ktorý prevádzkovateľ adaptuje na svoj kontext

---

## 7. Odporúčania pre tenant-ov

Tenant ako prevádzkovateľ si **musí samostatne posúdiť**, či DPIA potrebuje na svojej strane. Praktické odporúčania:

1. **Začať vlastným threshold assessmentom** — analogická analýza ako tento dokument, ale z perspektívy konkrétneho tenant-a. Body, ktoré tenant prehodnotí navyše:
   - Som orgán verejnej moci? (čl. 35 ods. 10 GDPR — niektoré DPIA povinnosti môžu byť odvodené priamo zo zákona)
   - Kombinujem Inventario s inými systémami s vyšším rizikom (zdravotné, biometrické, finančné)?
   - Mám špeciálne populácie subjektov (maloletí, žiadatelia o azyl, atď.)?
   - Je v zozname môjho dozorného orgánu (ÚOOÚ SR pre slovenských tenant-ov) typová operácia, ktorú vykonávam?
2. **Použiť tento dokument ako prílohu** k vlastnému threshold assessmentu — popisuje technický rámec platformy, čo šetrí prácu
3. **Konzultovať s vlastným DPO / GDPR poradcom** — najmä pri verejnom sektore, kde sektorové predpisy môžu DPIA vyžadovať aj nad rámec čl. 35 GDPR
4. **Pri pochybnostiach kontaktovať**: privacy@inventario.estate — poskytneme dodatočné technické informácie a vzorovú dokumentáciu

> **Plánované rozšírenie podpory**: V Compliance Fáze 2 publikujeme **DPIA Reference Pack** na verejnej URL `https://inventario.estate/dpia` s pre-filled DPIA šablónou, ktorú tenant priamo adaptuje. Do tej doby tenant pri potrebe DPIA postupuje vlastnou cestou s našou ad-hoc podporou.

---

## 8. Triggery pre re-assessment

Tento threshold assessment sa **automaticky prehodnotí** pri ktoromkoľvek z nasledujúcich:

| #   | Trigger                                                                                                        | Dopad                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | Pridanie AI / ML features do runtime platformy s prístupom k customer dátam                                    | Kritérium 8 (innovative technology) sa preklopí na ⚠️ alebo ✅; pravdepodobne DPIA potrebná |
| 2   | Pridanie biometrickej autentifikácie (Face ID, Touch ID nad rámec WebAuthn passkeys, fingerprint)              | Kritérium 4 (sensitive data) prehodnotenie; čl. 9 GDPR konzultácia                          |
| 3   | Pridanie geolokácie / location trackingu fyzických osôb                                                        | Kritérium 3 (systematic monitoring) eskalácia; čl. 35 ods. 3 písm. c potenciálne aktivovaný |
| 4   | Pridanie behavioural analytics, fingerprinting, scoring                                                        | Kritériá 1, 2, 3 potenciálne aktivované                                                     |
| 5   | Celkový počet dotknutých subjektov na platforme prekročí 100 000                                               | Kritérium 5 (large-scale) prehodnotenie                                                     |
| 6   | Nový sub-processor v krajine bez adekvátneho rozhodnutia / DPF / SCCs                                          | Posúdenie transferového rizika; potenciálne DPIA nad rámec threshold                        |
| 7   | Tenant v sektore s vlastnou DPIA povinnosťou zo sektorových predpisov (zdravotníctvo, kritická infraštruktúra) | Tenant si robí vlastnú DPIA; LTK poskytuje technickú prílohu                                |
| 8   | Publikácia novej alebo aktualizovanej verzie zoznamu ÚOOÚ SR podľa čl. 35 ods. 4 GDPR                          | Sekcia 5 sa prehodnotí; potenciálne nová kategória                                          |
| 9   | Publikácia novej EDPB guidance, ktorá mení výklad WP248                                                        | Sekcia 4 sa prehodnotí                                                                      |
| 10  | Zmena právnej úpravy (GDPR amendment, ePrivacy nariadenie, AI Act dopady na Inventario)                        | Komplexné prehodnotenie                                                                     |
| 11  | Závažný security incident, ktorý odhalí nové rizikové vektory                                                  | Post-incident analýza môže vyžiadať DPIA aj keď threshold ju formálne nevyžaduje            |

### 8.1. Pravidelný review

Mimo trigger-based re-assessmentu sa dokument **prehodnocuje ročne** (cieľový dátum: 12 mesiacov od poslednej publikovanej verzie). Aj v prípade, že žiaden formálny trigger neaktivoval re-assessment, ročný review je súčasťou accountability princípu (čl. 5 ods. 2 GDPR).

---

## 9. Zmenová história

| Verzia | Dátum                        | Zmena                                                                                                        |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1.0    | _\[doplniť pri publikácii\]_ | Prvá verzia threshold assessmentu pre platformu Inventario ako celok (slice #1 — #7). Záver: DPIA nepovinná. |

---

## 10. Referencie

### Primárne pramene

- [Nariadenie (EÚ) 2016/679 (GDPR)](https://eur-lex.europa.eu/eli/reg/2016/679/oj) — najmä **čl. 35** (DPIA), čl. 36 (predchádzajúca konzultácia), čl. 28 ods. 3 písm. f (povinnosť sprostredkovateľa pomáhať s DPIA), čl. 5 ods. 2 (accountability)
- [Zákon č. 18/2018 Z. z. o ochrane osobných údajov](https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2018/18/) — slovenská implementácia GDPR
- [EDPB Guidelines on DPIA (WP248 rev.01)](https://ec.europa.eu/newsroom/article29/items/611236) — _Guidelines on Data Protection Impact Assessment (DPIA) and determining whether processing is "likely to result in a high risk" for the purposes of Regulation 2016/679_, prijaté 4. apríla 2017, schválené EDPB 25. mája 2018
- [Zoznam ÚOOÚ SR podľa čl. 35 ods. 4 GDPR](https://dataprotection.gov.sk) — zoznam spracovateľských operácií podliehajúcich DPIA, publikovaný slovenským dozorným orgánom

### Sekundárne pramene

- [Article 29 WP Opinion 2/2017 on data processing at work](https://ec.europa.eu/newsroom/article29/items/610169) — výklad pre workplace monitoring a employee data processing
- [EDPB Recommendations 01/2020 on measures that supplement transfer tools](https://edpb.europa.eu/our-work-tools/our-documents/recommendations/recommendations-012020-measures-supplement-transfer_en) — relevantné pre transferové opatrenia sub-processorov

### Interné dokumenty Inventario

- [ROPA Processor view](./gdpr-article-30.md) — detail spracovateľských operácií platformy
- [ROPA Controller view](./gdpr-article-30-controller.md) — vlastné business operations LTK Solutions a ich vlastný threshold (sekcia 6)
- [DPA Template](./legal/dpa-template.md) — zmluvný rámec s tenant-mi vrátane pomoci s DPIA (bod 3.5)
- [Sub-processors list](./legal/sub-processors.md) — register s transferovými mechanizmami
- [ADR-0010 Multi-tenant white-label architektúra](../decisions/0010-multi-tenant-white-label.md) — architektonický kontext
- [ADR-0013 Multi-provider auth self-serve](../decisions/0013-multi-provider-auth-self-serve.md) — auth model

---

**Tento dokument je živý** — pri aktivácii ktoréhokoľvek triggera zo sekcie 8 alebo pri ročnom review sa prehodnocuje, inkrementuje sa verzia a aktualizuje sa zmenová história. Git history slúži ako audit trail samotného dokumentu.
