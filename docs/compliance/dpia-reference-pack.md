<!--
SPDX-FileCopyrightText: 2026 LTK Solutions, s.r.o.
SPDX-License-Identifier: CC-BY-4.0
-->

# DPIA Reference Pack — Inventario

> **Verejný dokument.** Pomôcka pre zákazníka (prevádzkovateľa), ktorý zvažuje alebo vypracúva posúdenie vplyvu na ochranu údajov (DPIA, čl. 35 GDPR) pre svoje nasadenie Inventaria. Verejná verzia: https://inventario.estate/dpia
>
> Toto je **referenčná pomôcka**, nie hotová DPIA. LTK Solutions je sprostredkovateľ a podľa čl. 28 ods. 3 písm. f) poskytuje prevádzkovateľovi súčinnosť — predvyplnené technické fakty, ktoré si prevádzkovateľ doplní o svoj kontext. Plnú editovateľnú šablónu poskytneme zákazníkovi na vyžiadanie ([`legal/dpia-template.md`](./legal/dpia-template.md)).
>
> ⚠️ **Disclaimer**: Nejde o právne poradenstvo. Záväznosť DPIA a jej obsah posúďte s vlastným poradcom / zodpovednou osobou.

| Pole                 | Hodnota                                           |
| -------------------- | ------------------------------------------------- |
| **Verzia**           | 1.0                                               |
| **Dátum**            | 2026-06-11                                        |
| **Sprostredkovateľ** | LTK Solutions, s.r.o. · privacy@inventario.estate |
| **Metodika**         | GDPR čl. 35 + EDPB Guidelines WP248 rev.01        |

---

## Krok 1 — Potrebujete vôbec DPIA? (Threshold)

DPIA je povinná, ak spracovanie pravdepodobne predstavuje **vysoké riziko** pre práva a slobody osôb (čl. 35 ods. 1). Posúďte:

**Obligatórne triggery (čl. 35 ods. 3):** systematické a rozsiahle hodnotenie/profilovanie · rozsiahle spracovanie osobitných kategórií · systematické monitorovanie verejne prístupných priestorov.

**Kritériá EDPB (WP248) — počítajte, koľko ich platí:** hodnotenie/skórovanie · automatizované rozhodovanie s právnym účinkom · systematické monitorovanie · citlivé údaje · rozsiahle spracovanie · prepájanie datasetov · zraniteľné osoby (napr. maloletí) · inovatívne použitie technológie · bránenie výkonu práva/zmluvy. **2 a viac kritérií ⇒ zvyčajne treba DPIA.**

> Pre typické nasadenie Inventaria (evidencia majetku organizácie, bežní zamestnanci, žiadne profilovanie ani osobitné kategórie) **väčšina prevádzkovateľov DPIA nepotrebuje**. Posúdenie sa môže zmeniť, ak spracúvate údaje **maloletých** (kluby/školy) alebo vo veľkom rozsahu — vtedy DPIA odporúčame. Pre celoplatformové predposúdenie viď [`threshold-assessment.md`](./threshold-assessment.md).

## Krok 2 — Popis spracovania (predvyplnené Inventariom)

- **Účel:** evidencia majetku a správa jeho vypožičiavania v rámci organizácie.
- **Povaha:** multi-tenant SaaS, dáta v EÚ (Vercel cdg1/fra1, MongoDB Atlas eu-central-1).
- **Kategórie údajov:** identifikačné (meno, OAuth ID), kontaktné (e-mail, voliteľne telefón), účtové (roly, stav), autentifikačné (hash hesla, MFA secret), custody majetku (kto si požičal/odovzdal), digitálny podpis protokolu, audit metadáta. **Žiadne osobitné kategórie (čl. 9).**
- **Dotknuté osoby:** zamestnanci a spolupracovníci organizácie; pri kluboch/školách potenciálne maloletí (cez rodiča ako proxy — vyžaduje rodičovský súhlas v UI).
- **Príjemcovia / sub-processori:** Vercel, MongoDB, Ecomail, Microsoft, Google — viď https://inventario.estate/sub-processors.
- **Doba uchovávania:** viď [Data Retention Schedule](./data-retention-schedule.md).

## Krok 3 — Nevyhnutnosť a proporcionalita

- **Právny základ (čl. 6):** typicky písm. b) plnenie zmluvy (pracovnoprávny vzťah / interná evidencia) alebo písm. e) verejný záujem (verejný sektor); pre prevenciu strát písm. f) oprávnený záujem. **Právny základ určuje prevádzkovateľ.**
- **Zásady (čl. 5):** minimalizácia (len nevyhnutné polia), obmedzenie účelu, obmedzenie uchovávania (automatický retenčný job), integrita a dôvernosť (šifrovanie, RBAC).

## Krok 4 — Riziká a opatrenia (mapované na náš Threat Model)

| Riziko pre práva osôb                     | Opatrenie platformy                                                  |
| ----------------------------------------- | -------------------------------------------------------------------- |
| Neoprávnený prístup / cross-tenant únik   | Server-side tenant scoping, 404 na cudzie dáta, 17 izolačných testov |
| Únik prihlasovacích údajov                | argon2id heslá, AES-256-GCM MFA, MFA politika per-tenant             |
| Strata/zmena dát                          | Denné zálohy (90 dní), point-in-time recovery, append-only audit log |
| Nedostatok transparentnosti/zodpovednosti | Audit log (kto-čo-kedy), export práv (čl. 20), ROPA                  |
| Prenos mimo EÚ                            | Primárne uloženie v EÚ; US dodávatelia kryti DPF + SCCs              |

Platformový threat model: **32 hrozieb, 0 vysokých reziduálnych** ([`threat-model.md`](./threat-model.md)).

## Krok 5 — Práva dotknutých osôb

Inventario poskytuje nástroje na výkon práv: prístup/export (`GET /v1/me/export`), oprava (`PATCH /v1/me`), výmaz (`DELETE /v1/auth/me`), obmedzenie. Žiadosti dotknutých osôb adresovaných sprostredkovateľovi postupujeme prevádzkovateľovi bez zbytočného odkladu.

## Krok 6 — Konzultácia s dozorným orgánom (čl. 36)

Ak DPIA aj po opatreniach indikuje **vysoké reziduálne riziko**, prevádzkovateľ konzultuje **ÚOOÚ SR** (Hraničná 12, 820 07 Bratislava, dataprotection.gov.sk) pred začatím spracovania.

## Krok 7 — Záver, schválenie, prehodnotenie

DPIA schvaľuje prevádzkovateľ (resp. jeho zodpovedná osoba) a prehodnocuje ju pri zmene rozsahu/účelu spracovania, minimálne periodicky.

---

## Ako získať plnú šablónu

Editovateľnú predvyplnenú DPIA šablónu (vrátane Prílohy A threshold testu a 7 rizikových scenárov) poskytneme zákazníkovi pri onboardingu alebo na vyžiadanie: **privacy@inventario.estate**.

## Zmenová história

| Verzia | Dátum      | Zmena                                                                                 |
| ------ | ---------- | ------------------------------------------------------------------------------------- |
| 1.0    | 2026-06-11 | Prvá verejná verzia — odvodená z `legal/dpia-template.md` a `threshold-assessment.md` |

## Referencie

- [`legal/dpia-template.md`](./legal/dpia-template.md) — plná šablóna
- [`threshold-assessment.md`](./threshold-assessment.md) · [`threat-model.md`](./threat-model.md) · [`data-retention-schedule.md`](./data-retention-schedule.md)
