<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Inventario — Cenová stratégia v1.0

> **Status:** Interný dokument pre Sales calls a vyjednávanie.
> **Audience:** Maintainers, Sales kontakt osoby.
> **Posledná aktualizácia:** 15. máj 2026
> **Verzia:** v1.0

---

## TL;DR

Inventario používa **hybrid pricing model**:

- Na webe (`inventario.estate/pricing`): **Free a Pro Small s konkrétnymi cenami**, vyššie tieri "Kontakt"
- V Sales calls (verejný sektor): **Annual contract model** s 4 veľkostnými kategóriami
- Pre B2B SaaS zákazníkov: **Mesačné per-organisation flat pricing**

**Pozícia na trhu:** 20-40% lacnejší než hlavní západní konkurenti (Asset Panda, EZOfficeInventory, Cheqroom, Sortly), so **EU compliance + slovenskou natívnosťou + forkovateľnosťou** ako differentiátormi.

---

## 1. Princípy cenotvorby

### 1.1 Prečo NIE per-používateľ

- Per-user model motivuje organizácie **neprihlasovať** všetkých zamestnancov
- To vedie k zlému adoption: výpožičky podávajú "v mene niekoho iného"
- Strácame audit trail (= core value proposition)
- **Nahradenie**: flat tier s "soft" používateľským limitom

### 1.2 Prečo NIE per-položka

- Per-asset model motivuje **nepridávať všetko** do evidencie
- Zákazník bojuje s rozpočtom keď chce pridať väčšiu sériu
- Adoption sa zastaví
- **Nahradenie**: flat tier s rozsahmi položiek

### 1.3 Prečo flat per-organisation

- **Predikovateľnosť** pre rozpočet (kľúčové pre verejný sektor)
- **Motivuje plný adoption** — pridaj všetko, pridaj všetkých
- **Jednoduchý invoice** — jeden riadok, jedna faktúra
- **Verejné obstarávanie**: pod €40k/rok bez tendra

### 1.4 Cenové úrovne — slovenské reálie

- Slovenské organizácie sú **lacnejší zákazník** než EU priemer (cca 60-70% benchmarkov)
- Sumy končia na číslach ktoré "neznepokojujú účtovníka": €29, €79, €199, €299
- **Ročná zľava ~17%** (= ekvivalent 10 mesiacov)

---

## 2. Verejný cenník (na webe)

Na `inventario.sportup.sk/pricing` zverejníme tri tieri, z toho dva s konkrétnymi cenami:

### Free — €0/mes

**Pre koho:** Občianske združenia, charity, malé NGO, pilotné nasadenia.

**Limity:**

- 50 položiek majetku
- 10 používateľov
- 100 MB prílohy
- Audit log retention 30 dní

**Bez kreditky. Bez záväzkov. Plne funkčné.**

### Pro Small — **€29/mes** alebo **€290/rok** (ušetríš €58)

**Pre koho:** Malé kluby, ZŠ, malé obce do 2 000 obyvateľov, neziskovky s rastom.

**Limity:**

- 500 položiek majetku
- 25 používateľov
- 1 GB prílohy
- Audit log retention 180 dní
- Custom branding (logo + farby)
- Bulk import z Excel/CSV
- Email podpora (5 pracovných dní SLA)

### Pro Standard — Kontakt

**Pre koho:** Stredné mestá (5-20k obyv.), SŠ, klubové asociácie, stredné firmy.

**Indikatívna cena:** **€79/mes** alebo **€790/rok** ← _povedať v Sales call_

**Limity:**

- 2 000 položiek
- 100 používateľov
- 5 GB prílohy
- Audit log retention 365 dní
- Všetko z Pro Small +
- API access (OpenAPI 3.1)
- Prioritná email podpora (24h SLA)

### Pro Plus — Kontakt

**Pre koho:** Veľké mestá (20-100k obyv.), športové zväzy, krajské organizácie.

**Indikatívna cena:** **€199/mes** alebo **€1 990/rok**

**Limity:**

- 10 000 položiek
- 500 používateľov
- 25 GB prílohy
- Audit log retention 365 dní
- Webhooks (Slack, Teams notifikácie)
- Multi-level approval workflow
- Phone podpora (12h SLA)

### Enterprise — Kontakt

**Pre koho:** VÚC, ministerstvá, krajské úrady, veľké súkromné firmy (>1000 zamestnancov), holdingy.

**Indikatívna cena:** **od €4 990/rok** (custom dohoda)

**Limity:**

- Neobmedzene
- Privátna inštancia (dedikovaný cluster)
- Custom doména (napr. `assets.bratislava.sk`)
- Data Processing Agreement (DPA)
- SLA 99.9% uptime
- Custom OIDC/SAML integrácia
- Dedikovaný account manager (4h SLA)
- Možnosť self-host fork s podporou

---

## 3. Verejný sektor — Annual Contract model

Pre **samosprávy, ministerstvá, VÚC a štátne inštitúcie** ponúkame **annual contract** namiesto mesačného SaaS. Dôvody:

1. **Verejné obstarávanie**: ročná zmluva pasuje do rozpočtových procesov
2. **Pod €40 000/rok** bez tendra (EU pravidlá VO)
3. **Jeden invoice ročne** = menej admin overhead
4. **Predikovateľný cash flow** pre obe strany

### Cenové kategórie podľa veľkosti organizácie

| Veľkosť                           | Annual fee                        | Pre koho                                            |
| --------------------------------- | --------------------------------- | --------------------------------------------------- |
| **Malá** (do 50 zamestnancov)     | **€890/rok**                      | Obec do 2k obyv., malý klub, ZŠ, malá NGO           |
| **Stredná** (51-200 zamestnancov) | **€2 490/rok**                    | Mesto 5-20k obyv., SŠ, stredný klub, regionálna NGO |
| **Veľká** (201-1000 zamestnancov) | **€5 990/rok**                    | Mesto 20-100k obyv., zväz, veľká NGO                |
| **XL** (1000+ zamestnancov)       | **individuálne (od €12 000/rok)** | VÚC, ministerstvo, krajský úrad, holding            |

### Čo annual contract obsahuje

- Plný prístup ku všetkým funkciám Pro Plus tieru
- Privátna inštancia (Stredná+)
- Custom doména (Stredná+)
- Onboarding session (2 hodiny — Malá, 4 hodiny — Stredná, 8 hodín — Veľká, custom — XL)
- SLA podľa kategórie (best-effort → 24h → 12h → 4h)
- DPA (Data Processing Agreement) podľa GDPR

---

## 4. Sanity check vs konkurencia

| Konkurent                  | Porovnateľná cena (Pro Standard ekvivalent) | Naše              | Rozdiel                              |
| -------------------------- | ------------------------------------------- | ----------------- | ------------------------------------ |
| **Asset Panda** (US)       | $120/mes (~€110)                            | €79/mes           | **-28%**                             |
| **EZOfficeInventory** (US) | $99/mes Pro (~€90)                          | €79/mes           | **-12%**                             |
| **Cheqroom** (BE)          | €99/mes Pro                                 | €79/mes           | **-20%**                             |
| **Sortly** (US)            | $49/mes Advanced (~€45)                     | €29/mes Pro Small | **-36%**                             |
| **Slovenský proprietárny** | €150-300/mes (po negociácii €50-80)         | €79/mes           | **-37%**                             |
| **Excel + Google Sheets**  | €0                                          | €0 (Free)         | **=** (ale s nulovou funkcionalitou) |

### Naše differentiators

1. ✅ **20-40% lacnejší** než hlavní západní konkurenti
2. ✅ **EU compliance** (EUPL, REUSE, GDPR Article 30) — výrazne dôležitejšie pre slovenské zákazníky než US
3. ✅ **Slovenská jazyková natívnosť** (kontroly, emaily, support v SK)
4. ✅ **Forkovateľnosť** (anti vendor lock-in)
5. ✅ **Multi-tenant white-label** od základu
6. ✅ **SportUp ekosystém** (na slovenský šport)

---

## 5. Vyjednávanie — guideline pre Sales calls

### 5.1 Štandardné rabaty

| Typ rabatu                        | Možný rozsah                     | Kedy ho dať                                    |
| --------------------------------- | -------------------------------- | ---------------------------------------------- |
| **Annual prepayment**             | -17% (10 mesiacov ekvivalent)    | Default, nepovažuje sa za rabat                |
| **2-ročná zmluva**                | +5% (kombinujeme s annual)       | Po požiadaní zákazníka                         |
| **3-ročná zmluva**                | +10% (kombinujeme s annual)      | Pre veľké organizácie (Pro Plus+)              |
| **Multi-tenant skupina**          | -15% per tenant pri 3+ tenantoch | Mestská skupina, klub asociácia, zväz s členmi |
| **Founding customer** (prvých 10) | -25% prvý rok                    | Logo na webe + case study súhlas               |
| **Open-source kontribútor**       | -50% prvý rok                    | Reálne PRs alebo financovanie ADR              |

### 5.2 Maximálna zľava

**Total stack** by **nemal presiahnuť -40%**. Pod túto úroveň sa už ohrozuje udržateľnosť projektu.

### 5.3 Bezplatné pre

- **Vzdelávacie inštitúcie** (ZŠ, SŠ) s menej ako 200 žiakmi — Free tier dostatočný
- **Otvorené NGO** s rozpočtom pod €50 000/rok — Free alebo Pro Small zadarmo prvý rok
- **Verejné športové podujatia** (jednorazové) — temporary Pro Standard zadarmo na 3 mesiace

### 5.4 Námietky a odpovede

#### "Je to drahé."

> _„Konkurencia robí to isté za 99-150 eur mesačne. My sme open source, fakturujeme v eurách, slovenské fakúry, slovenská podpora. A ak by sme zajtra zbankrotovali, dáta si exportujete a kód si forknete. To je hodnota, ktorú iný neponúkne."_

#### "Môžem to spraviť v Exceli zadarmo."

> _„Áno, môžete. Ale Excel nemá audit log pre NKÚ kontrolu, nepoužíva QR kódy, neuzná podpis ako protokol o prevzatí. A keď vám odíde človek čo Excel maintenoval, máte problém. Toto sú reálne dôvody, prečo organizácie ako vy prechádzajú z Excelu."_

#### "Prečo nemáte zadarmo všetko? Veď ste open source."

> _„Open source neznamená zadarmo. Znamená, že môžete vidieť kód, modifikovať ho a forknúť. Hosting, údržba, podpora, kontroly compliance — to stojí peniaze. Ak si chcete hostovať sami, EUPL-1.2 vám to plne umožňuje a stojí to €0 v licenčných poplatkoch."_

#### "Konkurent nám ponúkol viac za menej."

> _„Pošlite mi linku, pozriem sa. Niekedy je 'viac' v skutočnosti menej — chýba GDPR Article 30, chýba slovenský support, chýba možnosť exportu vlastných dát. Pozrime sa konkrétne na to, čo potrebujete."_

#### "Môžeme dostať 50% zľavu?"

> _„Maximálne -40% celkovo (annual + multi-year + multi-tenant skupina). Nad to už ohrozujeme udržateľnosť projektu, čo by paradoxne ohrozilo aj váš investment do migrácie."_

### 5.5 Trvanie kontraktov

- **Minimum**: 12 mesiacov (annual contract)
- **Štandard**: 12 alebo 24 mesiacov
- **Veľké organizácie**: 24 alebo 36 mesiacov s 5%/10% zľavou
- **Žiadne short-term kontrakty** (3-6 mesiacov) — overhead je príliš vysoký

---

## 6. Príklady cenovania (case studies)

### 6.1 Mesto Pezinok (~20 000 obyv., 250 zamestnancov)

**Profil:** Stredne veľké mesto, 2 800 položiek, 12 oddelení, multi-level approval.

**Návrh:** Pro Plus alebo Veľká annual.

| Možnosť                   | Cena                  | Komentár                               |
| ------------------------- | --------------------- | -------------------------------------- |
| Pro Plus mesačne          | €199/mes = €2 388/rok | Štandardná                             |
| Pro Plus ročne            | €1 990/rok            | -17%                                   |
| **Veľká annual contract** | **€5 990/rok**        | Privátna inštancia, custom doména, DPA |

**Odporúčanie:** Pro Plus ročne (€1 990) ak nepotrebujú custom doménu. Veľká annual (€5 990) ak potrebujú `assets.pezinok.sk`.

### 6.2 ŠK Inter Bratislava (~50 zamestnancov, 200 hráčov)

**Profil:** Mestský klub, 600 položiek, 12 mládežníckych kategórií.

**Návrh:** Pro Standard.

| Možnosť                 | Cena               | Komentár            |
| ----------------------- | ------------------ | ------------------- |
| Pro Standard mesačne    | €79/mes = €948/rok | Štandardná          |
| **Pro Standard ročne**  | **€790/rok**       | -17%                |
| Stredná annual contract | €2 490/rok         | Drahé — nepotrebujú |

**Odporúčanie:** Pro Standard ročne (€790).

### 6.3 SŠ Kremnica (40 učiteľov, 450 žiakov)

**Profil:** Stredná škola, 500 položiek IT + hudobné nástroje + laboratórne pomôcky.

**Návrh:** Free alebo Pro Small.

| Možnosť         | Cena     | Komentár                                  |
| --------------- | -------- | ----------------------------------------- |
| **Free**        | **€0**   | 500 položiek je presne na hranici, ale OK |
| Pro Small ročne | €290/rok | Ak chcú custom branding, väčšie SLA       |

**Odporúčanie:** Free na začiatok (3 mesiace), potom Pro Small ak chcú custom branding pre školský web.

### 6.4 SFZ (1 200+ položiek, 140+ používateľov)

**Profil:** Národný zväz, multi-team setup, foundation contributor.

**Návrh:** Pro Plus + founding customer rabat.

| Možnosť                            | Cena                                      | Komentár                 |
| ---------------------------------- | ----------------------------------------- | ------------------------ |
| Pro Plus ročne                     | €1 990/rok                                | Štandard                 |
| **Pro Plus ročne + founding -25%** | **€1 490/rok prvý rok**, potom €1 990/rok | Logo + case study súhlas |

**Odporúčanie:** Pro Plus s founding rabatom prvý rok ako uznanie za investíciu do projektu.

### 6.5 Bratislavský samosprávny kraj (1500+ zamestnancov)

**Profil:** VÚC, krajská infraštruktúra, multi-departmental.

**Návrh:** XL annual alebo Enterprise.

| Možnosť                | Cena                      | Komentár                                       |
| ---------------------- | ------------------------- | ---------------------------------------------- |
| **XL annual**          | **€12 000-18 000/rok**    | Custom dohoda, privátna inštancia v Bratislave |
| Enterprise + self-host | €8 000 + IT náklady kraja | Ak chcú plnú kontrolu                          |

**Odporúčanie:** XL annual €15 000/rok s 2-ročnou zmluvou (rok 1: €15 000, rok 2: €13 500 po -10% multi-year rabate).

---

## 7. Implementačné kroky

### 7.1 Krátkodobé (do 1 mesiaca)

- [x] Webový cenník (`_pricing.html`) hybrid C — Free a Pro Small s cenami, ostatné Kontakt
- [ ] Pripraviť Stripe / GoPay účet pre Pro Small online platby
- [ ] Pre Enterprise: príprava DPA templátu (GDPR Article 28)
- [ ] Pre verejný sektor: príprava annual contract templátu

### 7.2 Strednodobé (do 3 mesiacov)

- [ ] Pricing kalkulátor na webe (interaktívny)
- [ ] Marketo / HubSpot pre lead tracking
- [ ] Sales playbook PDF na základe tohto dokumentu

### 7.3 Dlhodobé (do 12 mesiacov)

- [ ] Multi-currency support (EUR primary, ale CZK pre českých zákazníkov)
- [ ] Self-service trial extension (1 klik predĺženie na 60 dní)
- [ ] Public benchmark comparison page (`/why-inventario`)

---

## 8. Review cyklus

Tento dokument je **living document**. Review cyklus:

| Frequency      | Čo overiť                                                  |
| -------------- | ---------------------------------------------------------- |
| **Mesačne**    | Nové konkurenti, zmeny v ich cenách                        |
| **Štvrťročne** | Distribučné metriky (počet uzavretých kontraktov per tier) |
| **Polročne**   | Cenové úrovne — sú stále aktuálne s trhom?                 |
| **Ročne**      | Komplet review, prípadne v2.0                              |

**Ďalšia revízia:** november 2026 (po prvých 6 mesiacoch produkcie).

---

## 9. Maintainers a kontakty

| Téma                 | Kontakt                             |
| -------------------- | ----------------------------------- |
| **Pricing diskusie** | inventario@ltk.solutions            |
| **Enterprise calls** | (príď cez inventario@ltk.solutions) |
| **Verejný sektor**   | jan.letko@ltk.solutions (priame)    |

---

**Verzia**: v1.0
**Last updated**: 15. máj 2026
**Status**: Active for v0.3 → v1.0 release period
