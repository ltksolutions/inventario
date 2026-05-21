<!--
SPDX-FileCopyrightText: 2026 LTK Solutions, s.r.o.
SPDX-License-Identifier: CC-BY-4.0
-->

# Breach Notification Plan — Inventario

**Interný procesný dokument** — postup LTK Solutions, s.r.o. pri Porušení ochrany osobných údajov v platforme Inventario podľa čl. 33 a 34 GDPR.

| Atribút                   | Hodnota                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Verzia**                | 1.0                                                                                                                               |
| **Posledná aktualizácia** | _\[doplniť pred prvým go-live\]_                                                                                                  |
| **Vlastník**              | Ing. Ján Letko, konateľ LTK Solutions, s.r.o.                                                                                     |
| **Klasifikácia**          | Interný dokument — nezdieľať verejne                                                                                              |
| **Súvisiace dokumenty**   | [DPA Template](./legal/dpa-template.md), [ROPA Processor view](./gdpr-article-30.md), [Sub-processors](./legal/sub-processors.md) |

> Tento dokument definuje kroky, lehoty a zodpovednosti pri každom zistenom alebo podozrivom Porušení ochrany osobných údajov. **Musí byť vykonaný okamžite** — každá hodina oneskorenia zvyšuje riziko sankcie a škody.

---

## 1. Definície

| Pojem              | Definícia                                                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Porušenie**      | Porušenie bezpečnosti vedúce k náhodnému alebo nezákonnému zničeniu, strate, zmene, neoprávnenému sprístupneniu alebo neoprávnenému prístupu k osobným údajom (čl. 4 ods. 12 GDPR) |
| **T0**             | Okamih, keď LTK Solutions zistí Porušenie alebo dôvodné podozrenie naňho                                                                                                           |
| **Tenant**         | Zákazník platformy Inventario ako prevádzkovateľ osobných údajov                                                                                                                   |
| **ÚOOÚ SR**        | Úrad na ochranu osobných údajov Slovenskej republiky                                                                                                                               |
| **Dotknuté osoby** | Fyzické osoby, ktorých osobné údaje boli Porušením ohrozené                                                                                                                        |

---

## 2. Klasifikácia závažnosti

Pred každou notifikačnou akciou ohodnoť závažnosť podľa tejto tabuľky:

| Úroveň                           | Popis                                                     | Príklady                                                                                                  | Čas do akcie                      |
| -------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **P1 — Kritická**                | Únik alebo neoprávnený prístup k osobným údajom potvrdený | Exfiltrácia databázy, prelomenie tenant izolácie, kompromitácia administrátorského účtu s prístupom k PII | Ihneď                             |
| **P2 — Vysoká**                  | Pravdepodobné Porušenie, prebieha vyšetrovanie            | Anomálny prístup k databáze, podozrivý API traffic, neočakávaný export dát                                | Do 4 hodín                        |
| **P3 — Stredná**                 | Potenciálne Porušenie, nízke riziko pre dotknuté osoby    | Strata nezašifrovaných záložných súborov bez PII, krátky výpadok bez úniku dát                            | Do 24 hodín                       |
| **P4 — Nízka / Falošný poplach** | Incident bez zistiteľného dopadu na osobné údaje          | Brute-force pokusy bez úspechu, spam na kontaktný formulár                                                | Zdokumentovať, žiadna notifikácia |

> **Pravidlo**: v pochybnostiach klasifikuj **vyššie** a reaguj rýchlejšie. Je oveľa lepšie odhaliť falošný poplach po 72 hodinách ako meškať s reálnym incidentom.

---

## 3. Rozhodovací strom — kedy notifikovať

Splňa incident aspoň jednu z podmienok?

- Osobné údaje boli sprístupnené neoprávnenej osobe
- Osobné údaje boli zmenené alebo zničené bez oprávnenia
- Osobné údaje sú nedostupné dlhšie ako 72 hodín

Ak **ÁNO** → povinná notifikácia ÚOOÚ SR do 72h (čl. 33 GDPR) + notifikácia Tenanta do 24h (DPA bod 3.7.1)

Ak **NIE** → zdokumentovať ako security event bez Porušenia, monitorovať ďalej

Po potvrdení notifikačnej povinnosti posúď ešte: hrozí „high risk" pre práva a slobody Dotknutých osôb (napr. krádež identity, finančná škoda, diskriminácia)?

Ak **ÁNO** → navyše povinná priama notifikácia Dotknutých osôb (čl. 34 GDPR)

Ak **NIE** → zdokumentovať dôvod, prečo priama notifikácia nie je nutná

---

## 4. Kroky pri incidente (časová os)

### T0 — Zistenie (okamžite)

- [ ] Zaznamenať presný čas T0 do incidentového logu
- [ ] Predbežne klasifikovať závažnosť (sekcia 2)
- [ ] **NEUMAZÁVAŤ** žiadne logy, záznamy ani e-maily — zachovávanie dôkazov je povinné

### T0 + 1 hodina — Containment

- [ ] Identifikovať zdroj a rozsah Porušenia
- [ ] Vykonať okamžité opatrenia na zastavenie úniku:
  - revoke kompromitovaných JWT tokenov
  - suspension dotknutého Tenant účtu (`status: SUSPENDED`) ak ide o tenant-level incident
  - zmena kompromitovaných API kľúčov a env secrets
  - blokovanie útočníkovej IP na Vercel firewall ak relevantné
  - rotácia `MFA_SECRET_ENCRYPTION_KEY` ak bola kompromitovaná
- [ ] Odoslať predbežnú správu Tenantovi (šablóna v sekcii 7.1)

### T0 + 4 hodiny — Posúdenie

- [ ] Zistiť presné kategórie a rozsah dotknutých osobných údajov
- [ ] Odhadnúť počet Dotknutých osôb
- [ ] Vyhodnotiť riziká pre Dotknuté osoby
- [ ] Rozhodnúť: povinná notifikácia ÚOOÚ SR? (sekcia 3)
- [ ] Rozhodnúť: povinná priama notifikácia Dotknutých osôb?

### T0 + 24 hodín — Formálna notifikácia Tenanta (povinná podľa DPA)

- [ ] Odoslať formálne oznámenie na GDPR kontakt Tenanta (šablóna v sekcii 7.2)
- [ ] CC: legal@inventario.estate a security@inventario.estate
- [ ] Oznámenie musí obsahovať: povahu Porušenia, kategórie a odhadovaný počet dotknutých osôb a záznamov, pravdepodobné dôsledky, prijaté opatrenia, kontakt pre ďalšie informácie

### T0 + 72 hodín — Notifikácia ÚOOÚ SR (ak povinná)

- [ ] Podať oznámenie elektronicky cez formulár na [dataprotection.gov.sk](https://dataprotection.gov.sk)
- [ ] Ak nie sú k dispozícii všetky informácie, podať čiastočné oznámenie s poznámkou „vyšetrovanie prebieha"
- [ ] Uložiť kópiu oznámenia + potvrdenie podania do interného archívu

### T0 + 72 hodín — Notifikácia Dotknutých osôb (ak povinná podľa čl. 34)

- [ ] Notifikovať priamo e-mailom každú Dotknutú osobu (alebo cez Tenant administrátora)
- [ ] Obsah podľa šablóny 7.4 — jasný jazyk, praktické odporúčania
- [ ] Zdokumentovať odoslaných, dátum a čas

### T0 + 7 dní — Post-mortem

- [ ] Vykonať interný post-mortem: čo sa stalo, prečo, ako zabrániť
- [ ] Aktualizovať bezpečnostné opatrenia
- [ ] Pre P1 incidenty: publikovať verejný post-mortem cez GitHub Security Advisory
- [ ] Aktualizovať tento dokument ak odhalil medzery

---

## 5. Kontakty

| Rola                         | Osoba / Inštitúcia | Kontakt                         |
| ---------------------------- | ------------------ | ------------------------------- |
| **Incident Commander (LTK)** | Ing. Ján Letko     | security@inventario.estate      |
| **GDPR kontakt LTK**         | Ing. Ján Letko     | privacy@inventario.estate       |
| **ÚOOÚ SR**                  | Dozorný orgán SR   | statny.dozor@pdp.gov.sk         |
| **Vercel incident**          | Vercel Support     | https://vercel.com/help         |
| **MongoDB Atlas incident**   | MongoDB Support    | https://www.mongodb.com/support |
| **Ecomail incident**         | Ecomail Support    | https://www.ecomail.cz/podpora  |

> Keď Sub-processor hlási incident na svojej strane, akceptuj oznámenie a okamžite spusti tento plán od T0.

---

## 6. Evidencia incidentov

Každý incident (vrátane falošných poplachov P4) sa zaznamenáva do interného záznamu. Šablóna:

```
Číslo incidentu:  INC-YYYY-NNN
Dátum a čas T0:
Klasifikácia:     P1 / P2 / P3 / P4
Popis:
Dotknuté komponenty:
Dotknuté osobné údaje (kategória, odhadovaný počet subjektov):
Prijaté opatrenia (s timestamps):
Notifikácia Tenanta:       ÁNO / NIE  |  Dátum:
Notifikácia ÚOOÚ SR:       ÁNO / NIE  |  Dátum:  |  Ref. číslo:
Notifikácia Dotknutých osôb: ÁNO / NIE  |  Dátum:  |  Dôvod ak NIE:
Post-mortem dátum:
Lekcie a opatrenia:
```

---

## 7. Šablóny správ

### 7.1. Predbežná správa Tenantovi (T0 + 1 hodina)

```
Predmet: [INVENTARIO SECURITY ALERT] Bezpečnostný incident – predbežná správa

Dobrý deň,

informujeme Vás, že sme zaznamenali bezpečnostný incident, ktorý sa môže
týkať Vašich dát na platforme Inventario.

Vyšetrovanie prebieha. Pošleme Vám podrobné formálne oznámenie do 24 hodín
od zistenia incidentu (T0: [dátum a čas]).

Prijaté opatrenia: [vypísať].

V prípade otázok kontaktujte security@inventario.estate.

S pozdravom,
Ing. Ján Letko, LTK Solutions, s.r.o.
```

### 7.2. Formálne oznámenie Tenantovi (do 24 hodín)

```
Predmet: [INVENTARIO] Oznámenie o porušení ochrany osobných údajov

Dobrý deň,

v súlade s bodom 3.7.1 Zmluvy o spracúvaní osobných údajov (DPA) Vám oznamujeme:

1. POVAHA PORUŠENIA
   [popis]

2. KATEGÓRIE A ODHADOVANÝ POČET DOTKNUTÝCH OSÔB
   [kategórie / počet]

3. KATEGÓRIE A ODHADOVANÝ POČET DOTKNUTÝCH ZÁZNAMOV
   [typy dát / počet]

4. PRAVDEPODOBNÉ DÔSLEDKY
   [popis rizík]

5. PRIJATÉ A PLÁNOVANÉ OPATRENIA
   [zoznam s timestamps]

6. KONTAKT PRE ĎALŠIE INFORMÁCIE
   security@inventario.estate

Ako Prevádzkovateľ osobných údajov máte povinnosť posúdiť, či toto Porušenie
podlieha oznámeniu ÚOOÚ SR (do 72h od zistenia, čl. 33 GDPR) a/alebo
priamej notifikácii Dotknutých osôb (čl. 34 GDPR). Poskytujeme plnú súčinnosť.

S pozdravom,
Ing. Ján Letko, konateľ, LTK Solutions, s.r.o.
```

### 7.3. Oznámenie Dotknutým osobám (ak povinné podľa čl. 34)

```
Predmet: Oznámenie o bezpečnostnom incidente – Inventario

Dobrý deň,

oznamujeme Vám, že došlo k bezpečnostnému incidentu, ktorý sa týka
Vašich osobných údajov v platforme Inventario.

ČO SA STALO
[jasný opis bez technického žargónu]

KTORÉ VAŠE ÚDAJE SÚ DOTKNUTÉ
[zrozumiteľný zoznam]

ČO ODPORÚČAME
[praktické kroky – zmena hesla, sledovanie účtov, atď.]

ČO SME UŽ UROBILI
[zoznam opatrení]

KONTAKT
privacy@inventario.estate

S pozdravom,
LTK Solutions, s.r.o.
```

---

## 8. Detekcia a monitorovanie

Nastaviť pred prvým go-live:

- **MongoDB Atlas Anomaly Detection** — alert pri nezvyčajnom náraste read/write operácií alebo prístupe z neznámej IP
- **Audit log monitoring** — pravidelný prehľad záznamov so `severity: CRITICAL` v kolekcii `audit_logs`
- **Failed login rate** — alert pri > 20 zlyhaných pokusoch / 15 min / IP (rate limiting je implementovaný, logging treba overiť)
- **Vercel Security alerts** — zapnúť notifikácie v Vercel dashboard

Manuálne indikátory na eskaláciu:

- Zákazník nahlási podozrenie na neoprávnený prístup
- Osobné údaje z Inventario sa objavia na verejných kanáloch
- Neočakávané zmeny v databáze bez zodpovedajúcich audit log záznamov
- Sub-processor hlási vlastný incident

---

## 9. Tabletop cvičenie (pred go-live)

Pred prvým produkčným launchom vykonaj aspoň jedno simulované cvičenie:

1. Vymysli scenár, napr.: „Zákazník nahlási, že vidí dáta iného tenanta v UI"
2. Prejdi celý postup podľa tohto dokumentu krok po kroku
3. Zaznamenaj kde sú medzery alebo chýbajúce prístupy
4. Aktualizuj tento dokument

---

## 10. Zmenová história

| Verzia | Dátum                      | Zmena                                 |
| ------ | -------------------------- | ------------------------------------- |
| 1.0    | _\[doplniť pred go-live\]_ | Prvá verzia pre platformu Inventario. |

---

**Klasifikácia**: Interný dokument. Nezdieľať verejne.
