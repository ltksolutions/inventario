<!--
SPDX-FileCopyrightText: 2026 LTK Solutions, s.r.o.
SPDX-License-Identifier: CC-BY-4.0
-->

# DPIA Template — pre tenant-ov platformy Inventario

> **Účel**: pred-vyplnená šablóna **posúdenia vplyvu na ochranu osobných údajov (DPIA)** podľa čl. 35 GDPR, ktorú **tenant (prevádzkovateľ)** adaptuje na svoj konkrétny kontext. Technické časti (opis spracovania, opatrenia, sub-processori) sú vyplnené za platformu Inventario; časti špecifické pre tenant-a sú označené `‹DOPLNÍ TENANT›`.
>
> Toto je **plnenie povinnosti sprostredkovateľa pomáhať prevádzkovateľovi s DPIA** podľa čl. 28 ods. 3 písm. f GDPR. LTK Solutions ako sprostredkovateľ **nevyhotovuje DPIA za tenant-a** — DPIA je a zostáva zodpovednosťou prevádzkovateľa.

| Atribút                   | Hodnota                                                                                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Verzia šablóny**        | 1.0                                                                                                                                                                                                            |
| **Posledná aktualizácia** | _\[doplniť pri publikácii\]_                                                                                                                                                                                   |
| **Pripravil**             | LTK Solutions, s.r.o. (sprostredkovateľ)                                                                                                                                                                       |
| **Vyplní a schváli**      | ‹DOPLNÍ TENANT — prevádzkovateľ›                                                                                                                                                                               |
| **Metodika**              | GDPR čl. 35; EDPB Guidelines WP248 rev.01; ICO DPIA template (referenčne)                                                                                                                                      |
| **Súvisiace dokumenty**   | [Threshold Assessment](../threshold-assessment.md), [ROPA Processor view](../gdpr-article-30.md), [DPA Template](./dpa-template.md), [Sub-processors](./sub-processors.md), [Threat Model](../threat-model.md) |

> ⚠️ **Disclaimer**: Táto šablóna je technicko-právny podklad. Tenant ju **musí prispôsobiť** svojmu kontextu a pred finalizáciou **konzultovať s vlastným DPO alebo právnym poradcom** — najmä ak je orgánom verejnej moci, spracúva údaje detí, alebo kombinuje Inventario s inými systémami.

---

## Ako používať túto šablónu

1. **Najprv urob threshold assessment.** Zisti, či vôbec DPIA potrebuješ. Príloha A nižšie ti v tom pomôže. Ak threshold vyjde negatívne a nemáš osobitné okolnosti, DPIA nemusíš vyhotoviť — stačí zdokumentovať threshold a jeho záver.
2. **Ak DPIA potrebuješ** (alebo ju robíš dobrovoľne pre accountability), prejdi sekcie 1–9 a vyplň všetky `‹DOPLNÍ TENANT›` polia.
3. **Časti označené „Inventario (predvyplnené)"** môžeš prevziať tak, ako sú — opisujú platformu, ktorú používaš. Over si len, že zodpovedajú tvojej verzii a konfigurácii.
4. **Schválenie**: finálnu DPIA schvaľuje prevádzkovateľ (štatutár / DPO tenant-a), nie LTK Solutions.

---

## Príloha A (urob najprv) — Threshold: potrebujem DPIA?

Zaškrtni, čo platí pre **tvoje** použitie Inventaria:

### A.1. Obligatórne triggery (čl. 35 ods. 3 GDPR) — stačí jeden „áno"

- [ ] Systematické a rozsiahle automatizované hodnotenie/profilovanie s právnymi alebo podobne významnými účinkami
- [ ] Spracúvanie osobitných kategórií údajov (čl. 9 — zdravie, biometria, atď.) **vo veľkom rozsahu**
- [ ] Systematické monitorovanie verejne prístupných miest vo veľkom rozsahu

> Inventario samo o sebe **ani jeden z týchto triggerov nespĺňa** (viď [Threshold Assessment](../threshold-assessment.md) sekcia 3). Ak ich nezavádza tvoje konkrétne použitie, pokračuj na A.2.

### A.2. EDPB kritériá (WP248) — 2+ „áno" spravidla znamená DPIA

- [ ] Evaluácia / scoring osôb
- [ ] Automatizované rozhodovanie s právnym/významným účinkom
- [ ] Systematické monitorovanie ‹pozor, ak používaš audit log na sledovanie výkonu zamestnancov nad rámec bezpečnosti›
- [ ] Citlivé údaje alebo údaje vysoko osobnej povahy ‹dopĺňaš do Inventaria také údaje?›
- [ ] Veľký rozsah spracovania ‹koľko dotknutých osôb? tisíce+?›
- [ ] Kombinovanie / párovanie datasetov ‹prepájaš Inventario s iným systémom?›
- [ ] Zraniteľné dotknuté osoby ‹deti, pacienti, atď. — používaš Inventario pre takúto skupinu?›
- [ ] Inovatívne technológie
- [ ] Spracovanie bráni výkonu práva dotknutej osoby

### A.3. Osobitné okolnosti tenant-a

- [ ] Som **orgán verejnej moci** (čl. 35 ods. 10 — DPIA môže byť potrebná/odporúčaná)
- [ ] Spracúvam **údaje detí** (napr. mládežnícky klub eviduje výstroj hráčov pod 18)
- [ ] Som v **regulovanom sektore** (zdravotníctvo, kritická infraštruktúra, financie)
- [ ] Operácia je v **zozname ÚOOÚ SR** podľa čl. 35 ods. 4 ‹over na dataprotection.gov.sk›

**Záver threshold:**

```
‹DOPLNÍ TENANT›
[ ] DPIA NIE JE potrebná — dôvod: ...................................
[ ] DPIA JE potrebná — pokračujem sekciami 1–9 nižšie
```

---

## 1. Popis spracovateľskej operácie

### 1.1. Identifikácia prevádzkovateľa

| Pole                     | Hodnota         |
| ------------------------ | --------------- |
| Názov organizácie        | ‹DOPLNÍ TENANT› |
| IČO / právna forma       | ‹DOPLNÍ TENANT› |
| Kontakt DPO (ak je)      | ‹DOPLNÍ TENANT› |
| Zodpovedná osoba za DPIA | ‹DOPLNÍ TENANT› |

### 1.2. Sprostredkovateľ (predvyplnené — Inventario)

| Pole                | Hodnota                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Sprostredkovateľ    | LTK Solutions, s.r.o., Banícka 1894/17, 968 01 Nová Baňa, IČO 45 949 310                             |
| Predmet spracovania | Hosting a prevádzka platformy Inventario (evidencia a vypožičiavanie majetku) v mene prevádzkovateľa |
| Zmluvný rámec       | [DPA podľa čl. 28 GDPR](./dpa-template.md)                                                           |
| Sub-processori      | [Verejný register](./sub-processors.md) — Vercel, MongoDB Atlas, Ecomail (default), OAuth provideri  |

### 1.3. Účel spracovania

| Inventario (predvyplnené)                                           | Tvoj konkrétny účel                                              |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Evidencia fyzického majetku organizácie                             | ‹DOPLNÍ TENANT — napr. „evidencia športovej výstroje federácie"› |
| Vypožičiavanie majetku zamestnancom/členom so schvaľovacím workflow | ‹DOPLNÍ TENANT›                                                  |
| Vedenie audit logu o operáciách (accountability, bezpečnosť)        | ‹DOPLNÍ TENANT›                                                  |

### 1.4. Povaha spracovania (predvyplnené za Inventario)

- **Zber**: JIT provisioning pri OAuth prihlásení / manuálne pozvanie / registrácia e-mailom
- **Uloženie**: MongoDB Atlas, EÚ (eu-central-1, Frankfurt), šifrované at rest (AES-256)
- **Použitie**: evidencia majetku, loan workflow, audit
- **Zdieľanie**: v rámci tenant-a podľa RBAC; žiadne zdieľanie mimo tenant-a
- **Uchovávanie**: podľa retention schedule (viď sekcia 6)
- **Likvidácia**: soft-delete → pseudonymizácia/anonymizácia po retention lehote

### 1.5. Rozsah spracovania

| Pole                      | Inventario (predvyplnené)                                                    | Tvoj rozsah                        |
| ------------------------- | ---------------------------------------------------------------------------- | ---------------------------------- |
| Kategórie dotknutých osôb | Zamestnanci, členovia, externí spolupracovníci tenant-a                      | ‹DOPLNÍ TENANT — vrátane počtu›    |
| Počet dotknutých osôb     | —                                                                            | ‹DOPLNÍ TENANT›                    |
| Kategórie osobných údajov | Identifikačné, kontaktné, autentifikačné (hashované), účtové, audit metadata | ‹DOPLNÍ TENANT ak pridávaš ďalšie› |
| Citlivé údaje (čl. 9)     | **Žiadne** v štandardnej platforme                                           | ‹DOPLNÍ TENANT — pridávaš nejaké?› |
| Geografický rozsah        | Primárne SR + EÚ                                                             | ‹DOPLNÍ TENANT›                    |
| Doba spracovania          | Trvanie zmluvy + retention                                                   | ‹DOPLNÍ TENANT›                    |

---

## 2. Konzultácia so zainteresovanými stranami

| Strana                           | Konzultované?                                 | Výstup                       |
| -------------------------------- | --------------------------------------------- | ---------------------------- |
| Dotknuté osoby / ich zástupcovia | ‹DOPLNÍ TENANT›                               | ‹DOPLNÍ TENANT›              |
| DPO (ak je ustanovený)           | ‹DOPLNÍ TENANT›                               | ‹DOPLNÍ TENANT›              |
| Sprostredkovateľ (LTK)           | ✅ — táto šablóna + ROPA + DPA + Threat Model | Technický podklad poskytnutý |
| IT / bezpečnosť                  | ‹DOPLNÍ TENANT›                               | ‹DOPLNÍ TENANT›              |

---

## 3. Nevyhnutnosť a proporcionalita

### 3.1. Právny základ (čl. 6 GDPR)

| Operácia            | Inventario odporúča                                        | Tvoj právny základ |
| ------------------- | ---------------------------------------------------------- | ------------------ |
| Správa používateľov | Plnenie zmluvy (b) / verejný záujem (e) pre VS             | ‹DOPLNÍ TENANT›    |
| Evidencia majetku   | Oprávnený záujem (f) — ochrana majetku                     | ‹DOPLNÍ TENANT›    |
| Vypožičky           | Plnenie zmluvy (b) / oprávnený záujem (f)                  | ‹DOPLNÍ TENANT›    |
| Audit log           | Zákonná povinnosť (c) — accountability / opráv. záujem (f) | ‹DOPLNÍ TENANT›    |

> **Prevádzkovateľ určuje právny základ** — Inventario poskytuje len odporúčanie. Pri oprávnenom záujme (f) je potrebný **balancing test** (sekcia 3.3).

### 3.2. Zásady spracovania (čl. 5 GDPR)

| Zásada                 | Ako ju Inventario podporuje (predvyplnené)                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| Minimalizácia údajov   | Zbierajú sa len údaje nevyhnutné pre evidenciu a loan workflow; PDF protokoly sa neukladajú (on-demand) |
| Presnosť               | Tenant admin + self-service oprava (čl. 16)                                                             |
| Obmedzenie uchovávania | Retention schedule s automatickou pseudonymizáciou (sekcia 6)                                           |
| Integrita a dôvernosť  | TLS 1.3, AES-256 at rest, argon2id, RBAC, tenant izolácia (viď Threat Model)                            |
| Transparentnosť        | ‹DOPLNÍ TENANT — informuješ svojich zamestnancov privacy notice?›                                       |

### 3.3. Balancing test pre oprávnený záujem (ak ho používaš)

```
‹DOPLNÍ TENANT›
Oprávnený záujem:        ........................................
Nevyhnutnosť:            ........................................
Vplyv na dotknuté osoby: ........................................
Záver (záujem prevažuje / neprevažuje): .........................
```

---

## 4. Identifikácia a hodnotenie rizík

> Inventario poskytuje [Threat Model (STRIDE)](../threat-model.md) ako technický podklad. Nižšie sú **riziká pre práva a slobody dotknutých osôb** (GDPR perspektíva, nie čisto technická).

| #   | Riziko pre dotknuté osoby                                | Zdroj (technický)     | Pravdepod. | Závažnosť | Inventario mitigácia (predvyplnené)                                   |
| --- | -------------------------------------------------------- | --------------------- | ---------- | --------- | --------------------------------------------------------------------- |
| 1   | Neoprávnený prístup k osobným údajom (cross-tenant únik) | Threat Model I-1      | Nízka      | Vysoká    | `organisationId` izolácia, 17 izolačných testov, 404 pri cross-tenant |
| 2   | Krádež identity cez kompromitované konto                 | Threat Model S-1, S-2 | Nízka      | Vysoká    | argon2id, MFA (TOTP/passkeys), rate limiting                          |
| 3   | Únik údajov pri prenose                                  | Threat Model T-2      | Nízka      | Vysoká    | TLS 1.3, HSTS                                                         |
| 4   | Strata údajov / nedostupnosť                             | Threat Model D-5      | Nízka      | Stredná   | Atlas replica set, DR Plan (RPO ≤24h, RTO ≤8h)                        |
| 5   | Nadmerné uchovávanie údajov                              | —                     | Stredná    | Stredná   | Retention schedule + pseudonymizácia (sekcia 6)                       |
| 6   | Dotknutá osoba nemôže uplatniť práva                     | Threat Model (E2E)    | Nízka      | Stredná   | Implementované práva (sekcia 5), kontakt na tenant admin              |
| 7   | ‹DOPLNÍ TENANT — riziká špecifické pre tvoj kontext›     | —                     | ‹...›      | ‹...›     | ‹...›                                                                 |

---

## 5. Opatrenia na zmiernenie rizík

### 5.1. Technické opatrenia (predvyplnené za Inventario)

Prevzaté z [ROPA sekcia 4.1](../gdpr-article-30.md#41-technické) a [Threat Model](../threat-model.md):

- Šifrovanie at rest (AES-256) a in transit (TLS 1.3)
- argon2id pre heslá, AES-256-GCM pre TOTP secrets
- Multi-tenant izolácia (`organisationId` v každom query)
- RBAC s least-privilege
- Append-only audit log
- Rate limiting na citlivých endpointoch
- Zod validácia vstupu/výstupu
- Automatická pseudonymizácia po retention lehote

### 5.2. Organizačné opatrenia tenant-a

```
‹DOPLNÍ TENANT›
[ ] Privacy notice pre dotknuté osoby (informovanie o spracovaní cez Inventario)
[ ] Interný predpis o používaní Inventaria (kto má aký prístup)
[ ] Školenie administrátorov tenant-a
[ ] Pravidlá pre prideľovanie rolí (kto smie byť ADMIN)
[ ] Proces pre vybavovanie žiadostí dotknutých osôb
[ ] ‹ďalšie›
```

### 5.3. Práva dotknutých osôb (ako ich Inventario umožňuje plniť)

| Právo               | Stav v Inventario                       | Ako ho tenant plní                            |
| ------------------- | --------------------------------------- | --------------------------------------------- |
| Prístup (čl. 15)    | ✅ `GET /v1/users/:id` + export         | Tenant admin vyexportuje profil               |
| Oprava (čl. 16)     | ✅ `PATCH`                              | Tenant admin / self-service                   |
| Výmaz (čl. 17)      | ⏳ soft-delete + plánovaný hard erasure | Tenant admin `DELETE`, hard erasure po lehote |
| Obmedzenie (čl. 18) | ⏳ plánované                            | ‹DOPLNÍ TENANT — interný proces medzitým›     |
| Prenosnosť (čl. 20) | ⏳ plánované `GET /v1/me/export`        | ‹DOPLNÍ TENANT›                               |
| Námietka (čl. 21)   | ✅                                      | Cez tenant admin                              |

---

## 6. Retention schedule (predvyplnené za Inventario)

Prevzaté z [ROPA sekcia 6](../gdpr-article-30.md#6-retention-schedule-sumár):

| Kategória                    | Retention      | Akcia po expirácii            |
| ---------------------------- | -------------- | ----------------------------- |
| Aktívni používatelia         | Trvanie zmluvy | —                             |
| Soft-deleted používatelia    | 24 mesiacov    | Pseudonymizácia               |
| Audit log — bežné akcie      | 24 mesiacov    | Pseudonymizácia osobných polí |
| Audit log — auth/security    | 60 mesiacov    | Pseudonymizácia               |
| Audit log — tenant lifecycle | 84 mesiacov    | Pseudonymizácia               |
| Ukončené výpožičky           | 60 mesiacov    | Hard delete                   |

> ‹DOPLNÍ TENANT ak máš vlastné retentné požiadavky (napr. dlhšie pre účtovné/archívne predpisy)›

---

## 7. Konzultácia s dozorným orgánom (čl. 36)

Predchádzajúca konzultácia s ÚOOÚ SR je potrebná **len ak** DPIA preukáže **vysoké reziduálne riziko**, ktoré sa nepodarilo zmierniť.

```
‹DOPLNÍ TENANT›
[ ] DPIA nepreukázala vysoké reziduálne riziko → konzultácia NIE JE potrebná
[ ] Vysoké reziduálne riziko pretrváva → konzultujem ÚOOÚ SR pred spracovaním
```

> Na základe predvyplnených mitigácií a [Threat Modelu](../threat-model.md) (0 vysokých reziduálnych rizík na strane platformy) sa nepredpokladá vysoké reziduálne riziko z titulu samotnej platformy. Tvoje špecifické okolnosti to však môžu zmeniť.

---

## 8. Záver a schválenie

```
‹DOPLNÍ TENANT›

Celkové reziduálne riziko: [ ] nízke  [ ] stredné  [ ] vysoké

Rozhodnutie:
[ ] Spracovanie môže pokračovať s uvedenými opatreniami
[ ] Spracovanie môže pokračovať po doplnení opatrení: ...............
[ ] Potrebná konzultácia s ÚOOÚ SR (čl. 36)
[ ] Spracovanie sa nezačne / sa zastaví

Schválil (meno, funkcia):  ........................................
Dátum:                     ........................................
Dátum ďalšieho prehodnotenia: .....................................
```

---

## 9. Prehodnotenie DPIA

DPIA je živý dokument. Tenant ju prehodnotí pri:

- zmene účelu alebo rozsahu spracovania
- novej funkcionalite platformy s vyšším rizikom (LTK oznámi cez sub-processor/feature notifikáciu)
- bezpečnostnom incidente
- zmene právnej úpravy
- minimálne raz ročne

---

## Zmenová história šablóny

| Verzia | Dátum                        | Zmena                                                       |
| ------ | ---------------------------- | ----------------------------------------------------------- |
| 1.0    | _\[doplniť pri publikácii\]_ | Prvá verzia DPIA šablóny pre tenant-ov (Compliance Fáza 2). |

---

## Referencie

- [GDPR čl. 35 — Posúdenie vplyvu na ochranu údajov](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [GDPR čl. 36 — Predchádzajúca konzultácia](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [EDPB Guidelines WP248 rev.01 — DPIA](https://ec.europa.eu/newsroom/article29/items/611236)
- [Threshold Assessment platformy Inventario](../threshold-assessment.md) — či DPIA vôbec treba
- [ROPA Processor view](../gdpr-article-30.md) — technický opis spracovania
- [DPA Template](./dpa-template.md) — zmluvný rámec
- [Sub-processors](./sub-processors.md) — register sub-processorov
- [Threat Model (STRIDE)](../threat-model.md) — technické riziká a mitigácie

---

**Táto šablóna je živá** — pri zmene platformy alebo právnej úpravy LTK Solutions aktualizuje predvyplnené časti a inkrementuje verziu šablóny. Tenant zodpovedá za aktuálnosť vlastnej vyplnenej DPIA.
