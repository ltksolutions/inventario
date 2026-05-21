<!--
SPDX-FileCopyrightText: 2026 LTK Solutions, s.r.o.
SPDX-License-Identifier: CC-BY-4.0
-->

# Všeobecné obchodné podmienky používania platformy Inventario

**Terms of Service (ToS)** medzi LTK Solutions, s.r.o. ako poskytovateľom a Zákazníkom ako objednávateľom Služby Inventario.

| Atribút dokumentu               | Hodnota                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------- |
| **Verzia šablóny**              | 1.0                                                                              |
| **Dátum vydania**               | _\[doplniť pri publikácii\]_                                                     |
| **Účinnosť**                    | Od dátumu publikácie na https://inventario.estate/terms                          |
| **Jazyk autoritatívnej verzie** | Slovenský jazyk                                                                  |
| **Použitie**                    | Hosted SaaS variant Služby. Self-hosted variant sa riadi licenciou EUPL-1.2.     |
| **Vzťah k DPA**                 | ToS tvorí Hlavnú zmluvu v zmysle DPA. DPA má prednosť vo veciach spracúvania OÚ. |

> ⚠️ **Disclaimer**: Tento dokument je technicko-právna šablóna pripravená podľa praxe B2B SaaS a slovenského obchodného práva. **Pred prvým použitím s reálnym zákazníkom musí byť pripomienkovaný slovenským advokátom** špecializujúcim sa na IT a obchodné právo. Šablóna nie je právnym stanoviskom a nenahrádza individuálne právne poradenstvo.

---

## ZMLUVNÉ STRANY

### Poskytovateľ

| Pole                 | Hodnota                                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| **Obchodné meno**    | **LTK Solutions, s.r.o.**                                                        |
| **Sídlo**            | Banícka 1894/17, 968 01 Nová Baňa, Slovenská republika                           |
| **IČO**              | 45 949 310                                                                       |
| **DIČ**              | 2023148017                                                                       |
| **IČ DPH**           | SK2023148017                                                                     |
| **Zápis**            | Obchodný register Okresného súdu Banská Bystrica, oddiel: Sro, vložka č. 19280/S |
| **Konateľ**          | Ing. Ján Letko                                                                   |
| **Kontakt zmluvy**   | legal@inventario.estate                                                          |
| **Kontakt podpora**  | support@inventario.estate                                                        |
| **Bankové spojenie** | SK27 5600 0000 0071 8437 9001                                                    |

(ďalej len **„Poskytovateľ"** alebo **„LTK Solutions"**)

### Zákazník

Právnická osoba alebo fyzická osoba — podnikateľ, ktorá si objednala alebo používa Službu (definovaná nižšie) prostredníctvom registrácie účtu, akceptácie týchto Podmienok alebo uzavretia Order Form (definované nižšie).

(ďalej len **„Zákazník"**)

(Poskytovateľ a Zákazník ďalej spoločne ako **„Zmluvné strany"** a samostatne ako **„Zmluvná strana"**)

---

## PREAMBULA

A. Poskytovateľ je obchodnou spoločnosťou poskytujúcou softvérovú platformu **Inventario** — SaaS riešenie pre evidenciu, správu a vypožičiavanie majetku — dostupnú na doméne `inventario.estate` (ďalej **„Platforma"** alebo **„Služba"**).

B. Zdrojový kód Platformy je publikovaný ako open-source softvér pod licenciou **EUPL-1.2**. Tieto Podmienky upravujú **hosted SaaS** poskytovanie Služby zo strany Poskytovateľa. Pre **self-hosted** používanie Platformy si Zákazník nasadzuje softvér vlastnými prostriedkami pod podmienkami licencie EUPL-1.2 a tieto Podmienky sa naňho neuplatňujú.

C. Tieto Podmienky upravujú práva a povinnosti Zmluvných strán v súvislosti s poskytovaním Služby vrátane registrácie, platobných podmienok, dostupnosti, zodpovednosti, ochrany osobných údajov a ukončenia zmluvy.

D. Tieto Podmienky predstavujú **Hlavnú zmluvu** v zmysle Zmluvy o spracúvaní osobných údajov (DPA) podľa čl. 28 GDPR, ktorá je k Podmienkam neoddeliteľne pripojená alebo sa s nimi uzatvára samostatne.

---

## 1. DEFINÍCIE A VÝKLAD

### 1.1. Definície

V týchto Podmienkach majú nasledovné výrazy význam pridelený im v tomto článku, ak z kontextu nevyplýva inak:

| Pojem                      | Význam                                                                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Platforma** / **Služba** | Softvérová platforma Inventario poskytovaná Poskytovateľom na doméne `inventario.estate` a jej subdoménach, vrátane všetkých modulov, funkcionalít, API rozhraní a doplnkových služieb              |
| **Zákazník**               | Právnická osoba alebo fyzická osoba — podnikateľ, ktorá využíva Službu na základe týchto Podmienok                                                                                                  |
| **Účet**                   | Tenant prostredie Zákazníka v Platforme reprezentované dokumentom v kolekcii `organisations` s prideleným `organisationId`                                                                          |
| **Používateľ**             | Fyzická osoba, ktorej Zákazník vytvoril prístup k Účtu (zamestnanec, externý spolupracovník, člen organizácie Zákazníka)                                                                            |
| **Administrátor**          | Používateľ s rolou ADMIN, ktorý spravuje Účet Zákazníka v Platforme                                                                                                                                 |
| **Order Form**             | Samostatný dokument špecifikujúci konkrétny plán, ceny, trvanie a osobitné dojednania medzi Zmluvnými stranami; pre subscription Plány aktivované cez web sa Order Form nahrádza online objednávkou |
| **Plán**                   | Cenová úroveň podľa aktuálneho cenníka publikovaného na `inventario.estate/pricing` (Free, Pro Small, Pro Standard, Pro Plus, Enterprise, Annual Contract pre verejný sektor)                       |
| **Cenník**                 | Aktuálny verejný cenník Služby publikovaný na `inventario.estate/pricing` v dobe uzavretia Order Form alebo individuálne dohodnutý cenník v Order Form                                              |
| **Predplatné**             | Opakované poskytovanie Služby v konkrétnom Pláne za pravidelnú odplatu (mesačne alebo ročne)                                                                                                        |
| **Fakturačné obdobie**     | Obdobie, za ktoré je Predplatné fakturované — mesačné alebo ročné podľa zvoleného Plánu                                                                                                             |
| **Účinný dátum**           | Dátum aktivácie Účtu (pre Free Plán) alebo dátum úspešnej platby prvého Fakturačného obdobia (pre platené Plány) alebo dátum podpisu Order Form                                                     |
| **Dáta Zákazníka**         | Všetky údaje, ktoré Zákazník alebo jeho Používatelia vkladajú do Služby, vrátane Osobných údajov spracúvaných podľa DPA, ako aj všetky obsahy súborov a príloh                                      |
| **Osobné údaje**           | Akékoľvek informácie týkajúce sa identifikovanej alebo identifikovateľnej fyzickej osoby (čl. 4 ods. 1 GDPR)                                                                                        |
| **DPA**                    | Zmluva o spracúvaní osobných údajov (Data Processing Agreement) medzi Zmluvnými stranami podľa čl. 28 GDPR                                                                                          |
| **AUP**                    | Acceptable Use Policy — Pravidlá prijateľného používania Služby uvedené v Prílohe 1 týchto Podmienok                                                                                                |
| **SLA**                    | Service Level Agreement — Dohoda o úrovni poskytovaných služieb uvedená v Prílohe 2 týchto Podmienok                                                                                                |
| **Beta funkcie**           | Funkcie Služby výslovne označené ako „Beta", „Preview", „Experimental" alebo podobne, ktoré sú poskytované bez záruky stability                                                                     |
| **Vyššia moc**             | Mimoriadne nepredvídateľné a neodvrátiteľné prekážky, ktoré nevznikli v dôsledku konania alebo nečinnosti Zmluvnej strany                                                                           |
| **Pracovný deň**           | Deň, ktorý nie je sobota, nedeľa ani štátny sviatok podľa kalendára Slovenskej republiky                                                                                                            |
| **GDPR**                   | Nariadenie Európskeho parlamentu a Rady (EÚ) 2016/679                                                                                                                                               |
| **Občiansky zákonník**     | Zákon č. 40/1964 Zb. Občiansky zákonník v znení neskorších predpisov                                                                                                                                |
| **Obchodný zákonník**      | Zákon č. 513/1991 Zb. Obchodný zákonník v znení neskorších predpisov                                                                                                                                |

### 1.2. Výklad

Pojmy nedefinované v bode 1.1 majú význam priradený im v príslušných právnych predpisoch Slovenskej republiky a EÚ. Nadpisy slúžia len pre orientáciu a nemajú interpretačný význam. Odkazy na ustanovenia právnych predpisov sa vykladajú vrátane neskorších noviel.

### 1.3. Hierarchia dokumentov

V prípade rozporu medzi dokumentmi tvoriacimi zmluvný rámec medzi Zmluvnými stranami sa uplatňuje nasledovné poradie prednosti (od najvyššej k najnižšej):

1. Individuálne dojednaný Order Form (ak existuje a obsahuje výslovne odchylné dojednanie)
2. Tieto Podmienky a ich prílohy (AUP, SLA)
3. DPA — má prednosť pred týmito Podmienkami **výlučne v otázkach spracúvania Osobných údajov**
4. Aktuálny Cenník publikovaný na `inventario.estate/pricing`
5. Dokumentácia Služby publikovaná na `docs.inventario.estate` (ak existuje)

---

## 2. PREDMET A UZAVRETIE ZMLUVY

### 2.1. Predmet

Poskytovateľ sa zaväzuje poskytovať Zákazníkovi Službu v rozsahu zvoleného Plánu a Zákazník sa zaväzuje Službu používať v súlade s týmito Podmienkami a uhrádzať dohodnutú odplatu (s výnimkou Free Plánu).

### 2.2. Spôsob uzavretia zmluvy

2.2.1. **Online registrácia (Free Plán a samoobslužné platené Plány)**: Zmluva medzi Zmluvnými stranami sa uzaviera okamihom, keď:

- (a) Zákazník dokončí registráciu Účtu na `inventario.estate` alebo `app.inventario.estate` a
- (b) Zákazník akceptuje tieto Podmienky a DPA aktívnym úkonom (napríklad zaškrtnutím checkboxu „Súhlasím s Podmienkami a DPA") a
- (c) pre platené Plány — Zákazník úspešne uhradí prvé Fakturačné obdobie.

  2.2.2. **Order Form (Enterprise, Annual Contract pre verejný sektor, individuálne dojednania)**: Zmluva medzi Zmluvnými stranami sa uzaviera podpisom Order Form oboma Zmluvnými stranami (elektronickým podpisom alebo vlastnoručným podpisom). Order Form môže obsahovať odchylné dojednania od týchto Podmienok, ktoré majú v rozsahu odchýlky prednosť pred Podmienkami.

  2.2.3. **Konkludentné uzavretie**: Začatie používania Služby Zákazníkom po doručení týchto Podmienok je tiež považované za akceptáciu Podmienok.

### 2.3. Spôsobilosť uzavrieť zmluvu

2.3.1. Zákazník vyhlasuje, že:

- (a) je právnickou osobou alebo fyzickou osobou — podnikateľom platne založeným a registrovaným podľa právneho poriadku, ktorému podlieha;
- (b) osoba registrujúca Účet je oprávnená konať v mene Zákazníka a zaväzovať ho;
- (c) má všetky potrebné súhlasy, povolenia a oprávnenia potrebné na uzavretie a plnenie tejto zmluvy;
- (d) údaje poskytnuté pri registrácii sú pravdivé, úplné a aktuálne.

  2.3.2. **Spotrebitelia (fyzické osoby — nepodnikatelia)** nie sú cieľovou skupinou Služby. Služba je B2B produkt určený pre právnické osoby a podnikateľov. Poskytovateľ si vyhradzuje právo neuzavrieť zmluvu so spotrebiteľom alebo už uzavretú zmluvu so spotrebiteľom vypovedať.

### 2.4. Akceptácia týchto Podmienok ako zmluva na diaľku

Tieto Podmienky sú uzatvárané ako zmluva na diaľku v zmysle Obchodného zákonníka. Poskytovateľ pred uzavretím zmluvy sprístupní Zákazníkovi tieto Podmienky v textovej forme na svojej webovej stránke. Zákazník má možnosť si Podmienky prečítať, vytlačiť a uložiť.

---

## 3. ÚČET ZÁKAZNÍKA

### 3.1. Registrácia Účtu

3.1.1. Zákazník vytvára Účet cez registračný formulár dostupný na `inventario.estate` alebo prostredníctvom OAuth poskytovateľa (Microsoft Entra ID, Google, Apple).

3.1.2. Pri registrácii Zákazník zadáva najmä:

- (a) názov organizácie Zákazníka;
- (b) kontaktný e-mail Administrátora;
- (c) v prípade plateného Plánu — fakturačné údaje a údaje o platobnej metóde.

  3.1.3. Po úspešnej registrácii Poskytovateľ aktivuje Účet a sprístupní funkcionalitu Plánu Zákazníkovi.

### 3.2. Bezpečnosť Účtu

3.2.1. Zákazník je zodpovedný za zachovanie dôvernosti prístupových údajov svojich Používateľov a za všetky aktivity vykonané pod ich Účtami.

3.2.2. Zákazník je povinný:

- (a) vyžadovať od svojich Používateľov dostatočne silné heslá (Služba implementuje minimálne nároky na heslo);
- (b) **odporúčane vyžadovať dvojfaktorovú autentifikáciu (MFA)** pre rolu ADMIN a rolu ASSET_MANAGER prostredníctvom konfigurácie `Organisation.settings.mfa.policy`;
- (c) bezodkladne informovať Poskytovateľa na `security@inventario.estate` pri podozrení na neautorizovaný prístup k Účtu.

  3.2.3. Poskytovateľ nezodpovedá za škodu vzniknutú v dôsledku porušenia povinností Zákazníka podľa bodu 3.2.

### 3.3. Správa Používateľov

3.3.1. Administrátor Zákazníka má právo vytvárať, upravovať, deaktivovať a vymazávať Používateľov v rámci svojho Účtu cez funkcionalitu Služby.

3.3.2. Zákazník zodpovedá za to, že:

- (a) všetci Používatelia, ktorých prizve do Účtu, sú oprávnení používať Službu;
- (b) priraďuje Používateľom adekvátne roly podľa princípu najmenšieho privilégia;
- (c) deaktivuje účty Používateľov, ktorí už nemajú dôvod prístupu (napríklad po skončení pracovného pomeru).

### 3.4. Pravdivosť údajov

Zákazník je povinný udržiavať svoje fakturačné a kontaktné údaje aktuálne. Pri zmene údajov ich Zákazník bezodkladne aktualizuje cez nastavenia Účtu alebo oznámi Poskytovateľovi e-mailom na `support@inventario.estate`.

---

## 4. PLÁNY A CENNÍK

### 4.1. Plány Služby

4.1.1. Poskytovateľ poskytuje Službu v niekoľkých Plánoch, ktoré sa líšia rozsahom funkcionality, limitmi (počet Používateľov, počet evidovaných položiek majetku, veľkosť úložiska, retention audit logu), úrovňou podpory a cenou.

4.1.2. Aktuálny zoznam Plánov, ich obsahu a cien je publikovaný na `inventario.estate/pricing`. Konkrétne ceny pre Enterprise Plán a Annual Contract pre verejný sektor sú dohodnuté individuálne v Order Form.

4.1.3. **Free Plán** je poskytovaný bezplatne s funkcionálnymi a kvantitatívnymi obmedzeniami. Poskytovateľ je oprávnený Free Plán upraviť alebo zrušiť s primeraným predstihom najmenej 30 kalendárnych dní.

### 4.2. Zmena Plánu

4.2.1. **Upgrade**: Zákazník môže prejsť na vyšší Plán kedykoľvek cez nastavenia Účtu alebo na základe dodatku k Order Form. Nový Plán nadobúda účinnosť okamžite a Zákazník dopláca pomerný rozdiel za zostávajúce obdobie aktuálneho Fakturačného obdobia.

4.2.2. **Downgrade**: Zákazník môže prejsť na nižší Plán k poslednému dňu aktuálneho Fakturačného obdobia. Pri downgrade na Free Plán Zákazník zodpovedá za zníženie objemu dát do limitov nového Plánu; ak tak neurobí, Poskytovateľ je oprávnený obmedziť funkcionalitu (read-only mód) do uvedenia dát do súladu s limitmi Plánu.

4.2.3. **Pri downgrade sa nevracajú** uhradené poplatky za nevyužité obdobie aktuálneho Fakturačného obdobia, ak sa Zmluvné strany v Order Form nedohodli inak.

### 4.3. Limity a prekročenie limitov

4.3.1. Každý Plán má kvantitatívne limity uvedené v Cenníku. Tieto limity sú vynucované technicky alebo soft (warning notifikácia).

4.3.2. Pri prekročení tvrdých technických limitov je funkcionalita rozšírená nad limit obmedzená (napríklad nemožnosť pridať ďalší majetok). Pri prekročení soft limitov Poskytovateľ informuje Zákazníka e-mailom a vyzve ho buď k uvedeniu objemu do limitu Plánu, alebo k upgrade na vyšší Plán.

4.3.3. Ak Zákazník neuvedie objem do limitu ani neprejde na vyšší Plán do **30 kalendárnych dní** od výzvy, Poskytovateľ je oprávnený obmedziť funkcionalitu Účtu (read-only mód).

---

## 5. PLATOBNÉ PODMIENKY

### 5.1. Cena a fakturácia

5.1.1. Cena za používanie Služby je stanovená v Cenníku alebo individuálne v Order Form. Všetky ceny sú uvádzané **v EUR bez DPH**, ak nie je výslovne uvedené inak. K cene sa pripočítava DPH v zákonnej sadzbe.

5.1.2. Poskytovateľ vystavuje **elektronickú faktúru** v zmysle zákona č. 222/2004 Z. z. o DPH a doručuje ju Zákazníkovi e-mailom na fakturačnú adresu uvedenú v nastaveniach Účtu alebo v Order Form. Zákazník súhlasí s elektronickou fakturáciou.

5.1.3. Fakturačné obdobie:

- (a) **Mesačné Plány** (Pro Small, Pro Standard, Pro Plus mesačná verzia): faktúra je vystavená v deň aktivácie Plánu a následne každý kalendárny mesiac;
- (b) **Ročné Plány** (Pro Small annual, Pro Standard annual, Pro Plus annual, Annual Contract pre verejný sektor): faktúra je vystavená v deň aktivácie Plánu a následne každý rok k výročnému dátumu;
- (c) **Enterprise**: podľa Order Form (typicky ročne).

### 5.2. Splatnosť faktúr

5.2.1. **Online platba (samoobsluha)**: Poplatok za Plán je automaticky strhávaný z platobnej karty Zákazníka v deň vystavenia faktúry. Pri zlyhanej platbe Poskytovateľ opakuje pokus o strhnutie do 7 kalendárnych dní; po neúspešnom opakovanom pokuse môže byť Účet pozastavený podľa bodu 8.

5.2.2. **Bankový prevod (Enterprise, Annual Contract)**: Splatnosť faktúry je **14 kalendárnych dní** od dátumu vystavenia, ak Order Form neuvádza inak.

5.2.3. **Verejný sektor**: U Zákazníkov, ktorí sú orgánmi verejnej moci alebo verejnoprávnymi inštitúciami, je splatnosť **30 kalendárnych dní** podľa zákona č. 25/2006 Z. z. o verejnom obstarávaní (alebo iného platného predpisu).

### 5.3. Omeškanie s platbou

5.3.1. Pri omeškaní s úhradou faktúry je Poskytovateľ oprávnený požadovať **úrok z omeškania** v zákonnej výške podľa § 369 Obchodného zákonníka a nariadenia vlády č. 21/2013 Z. z.

5.3.2. Poskytovateľ je oprávnený **pozastaviť poskytovanie Služby** Zákazníkovi v omeškaní s úhradou viac ako **14 kalendárnych dní**, a to po predchádzajúcom upozornení doručenom e-mailom najmenej 7 dní pred pozastavením.

5.3.3. Pozastavenie Služby z dôvodu omeškania s platbou **nezbavuje Zákazníka povinnosti uhradiť** dlžnú sumu vrátane úroku z omeškania a prípadných ďalších nákladov spojených s vymáhaním.

### 5.4. Zmena Cenníka

5.4.1. Poskytovateľ je oprávnený zmeniť Cenník. O zmene Cenníka informuje Zákazníka e-mailom najmenej **30 kalendárnych dní** pred účinnosťou novej ceny.

5.4.2. Zmena Cenníka sa **nevzťahuje na aktuálne prebiehajúce Fakturačné obdobie**. Nová cena sa uplatňuje od nasledujúceho Fakturačného obdobia.

5.4.3. Ak Zákazník so zmenou Cenníka **nesúhlasí**, má právo vypovedať zmluvu bezdôvodne k poslednému dňu aktuálneho Fakturačného obdobia. Pokračovanie v používaní Služby po účinnosti novej ceny sa považuje za akceptáciu novej ceny.

5.4.4. **Annual Contract pre verejný sektor**: Cena dohodnutá v Order Form pre Annual Contract platí počas celého ročného obdobia. Zmena ceny pre nasledujúce ročné obdobie je oznámená najmenej **60 kalendárnych dní** pred koncom aktuálneho ročného obdobia.

### 5.5. Vrátenie peňazí

5.5.1. **Mesačné Plány**: Bezdôvodné vrátenie peňazí nie je možné. Zákazník môže Plán kedykoľvek vypovedať a Služba mu zostáva poskytovaná do konca uhradeného Fakturačného obdobia.

5.5.2. **Ročné Plány**: Bezdôvodné vrátenie peňazí nie je možné. Zákazník môže Plán vypovedať s účinnosťou k poslednému dňu Fakturačného obdobia.

5.5.3. **Vrátenie pri vážnom porušení povinností Poskytovateľa**: Ak Poskytovateľ podstatným spôsobom poruší svoje povinnosti podľa týchto Podmienok a porušenie neodstráni ani do 30 dní od písomnej výzvy Zákazníka, Zákazník má právo:

- (a) vypovedať zmluvu s okamžitou účinnosťou a
- (b) požadovať vrátenie pomernej časti uhradenej ceny za nevyužité obdobie.

---

## 6. PRÁVA A POVINNOSTI ZÁKAZNÍKA

### 6.1. Právo používať Službu

Počas platnosti zmluvy a po úhrade príslušných poplatkov má Zákazník nevýhradné, neprenosné, časovo obmedzené právo používať Službu prostredníctvom svojho Účtu a v rozsahu zvoleného Plánu.

### 6.2. Akceptovateľné použitie

6.2.1. Zákazník sa zaväzuje používať Službu v súlade s **Pravidlami prijateľného používania (AUP)** uvedenými v **Prílohe 1** týchto Podmienok.

6.2.2. Najzávažnejšie zakázané praktiky (neúplný výpočet):

- (a) používanie Služby na nezákonné účely alebo na podporu nezákonnej činnosti;
- (b) nahrávanie obsahu, ktorý porušuje práva tretích osôb (autorské, ochranné známky, súkromie);
- (c) snaha o získanie neoprávneného prístupu k Službe alebo k dátam iných Zákazníkov;
- (d) penetration testing alebo security probing Služby bez predchádzajúceho písomného súhlasu Poskytovateľa;
- (e) využívanie Služby na rozosielanie nevyžiadanej elektronickej pošty (spam);
- (f) reverse engineering, decompilácia alebo inú reprodukciu Služby v rozpore s licenciou EUPL-1.2 a osobitnými ustanoveniami EUPL pre práva užívateľa;
- (g) prevádzkovanie Služby spôsobom, ktorý znižuje jej dostupnosť pre iných Zákazníkov (DoS, neprimerané API rate vyžadovanie nad rámec dohodnutých limitov);
- (h) vkladanie údajov osobitných kategórií (čl. 9 GDPR) do voľnotextových polí bez vlastného právneho základu na takéto spracúvanie.

  6.2.3. Porušenie AUP môže viesť k pozastaveniu alebo ukončeniu Účtu podľa bodu 8.

### 6.3. Zodpovednosť za Dáta Zákazníka

6.3.1. Zákazník je **výlučným vlastníkom** Dát Zákazníka, ktoré vkladá do Služby. Poskytovateľ nezískava k Dátam Zákazníka žiadne vlastnícke ani autorské právo nad rámec práva spracúvať ich na účely poskytovania Služby podľa DPA.

6.3.2. Zákazník je zodpovedný za to, že má **právny základ** na spracúvanie všetkých Osobných údajov, ktoré vkladá do Služby (čl. 6 a v relevantných prípadoch čl. 9 GDPR), a že splnil **informačné povinnosti** voči dotknutým osobám (čl. 13 a 14 GDPR).

6.3.3. Zákazník je povinný **plniť práva dotknutých osôb** podľa kapitoly III GDPR (čl. 15 — 22) ako prevádzkovateľ v rozsahu, v akom mu to umožňuje funkcionalita Služby. Poskytovateľ poskytuje Zákazníkovi súčinnosť podľa DPA.

### 6.4. Súčinnosť pri zmene Sub-procesora

Ak Poskytovateľ oznámi zmenu Sub-procesora v zmysle DPA, Zákazník je povinný riadne posúdiť oznámenie v dohodnutej lehote a oznámiť prípadnú námietku Poskytovateľovi najneskôr v lehote uvedenej v DPA.

### 6.5. Notifikácia o incidente alebo zraniteľnosti

Ak Zákazník zistí akúkoľvek bezpečnostnú zraniteľnosť, podozrenie na únik dát alebo iný incident týkajúci sa Služby, je povinný bezodkladne (najneskôr do 24 hodín) informovať Poskytovateľa na `security@inventario.estate`.

---

## 7. PRÁVA A POVINNOSTI POSKYTOVATEĽA

### 7.1. Poskytovanie Služby

7.1.1. Poskytovateľ sa zaväzuje poskytovať Službu v súlade s týmito Podmienkami, v dohodnutom rozsahu Plánu a s úrovňou dostupnosti podľa **SLA** v **Prílohe 2** týchto Podmienok.

7.1.2. Poskytovateľ priebežne vyvíja a zlepšuje Službu. Nové funkcionality sú zavádzané postupne a sú dostupné podľa zvoleného Plánu Zákazníka. Poskytovateľ je oprávnený zmeniť, doplniť alebo zrušiť jednotlivé funkcionality Služby, pričom úroveň poskytovania Služby ako celku sa zmenou nesmie podstatne znížiť.

### 7.2. Podpora

7.2.1. Poskytovateľ poskytuje Zákazníkovi technickú podporu v rozsahu zvoleného Plánu prostredníctvom kanálov uvedených na `inventario.estate/support` alebo `docs.inventario.estate`.

7.2.2. Štandardná podpora je poskytovaná v slovenskom a anglickom jazyku v pracovných dňoch.

7.2.3. Cieľové reakčné časy (SLA podpory) sú uvedené v **Prílohe 2** a sú podmienené použitím správneho kanálu na konkrétny typ požiadavky.

### 7.3. Plánovaná odstávka (maintenance window)

7.3.1. Poskytovateľ je oprávnený plánovať odstávky Služby (maintenance windows) na vykonanie údržby, aktualizácií, bezpečnostných opatrení alebo iných potrebných operácií.

7.3.2. **Plánované odstávky** sa Poskytovateľ snaží uskutočňovať mimo bežných pracovných hodín (typicky v noci alebo cez víkend stredoeurópskeho času). O plánovanej odstávke s očakávanou nedostupnosťou Služby viac ako 30 minút Poskytovateľ informuje Zákazníka e-mailom najmenej **48 hodín vopred**.

7.3.3. **Neplánované odstávky** v reakcii na bezpečnostné incidenty alebo kritické chyby môže Poskytovateľ vykonať bez predchádzajúceho upozornenia. O takejto odstávke informuje bezodkladne po jej zistení.

7.3.4. Čas plánovaných odstávok v rozsahu do 4 hodín mesačne **sa nezapočítava** do výpočtu dostupnosti pre účely SLA.

### 7.4. Bezpečnosť

7.4.1. Poskytovateľ implementuje a udržiava primerané technické a organizačné opatrenia na zabezpečenie Služby v rozsahu uvedenom v **Prílohe 2 DPA** (Technické a organizačné opatrenia).

7.4.2. V prípade bezpečnostného incidentu Poskytovateľ postupuje podľa **DPA bod 3.7** (Porušenie ochrany osobných údajov) a podľa interného Breach Notification Plan.

### 7.5. Beta funkcie

7.5.1. Poskytovateľ môže Zákazníkovi sprístupniť **Beta funkcie** označené ako „Beta", „Preview" alebo „Experimental". Beta funkcie sú poskytované **bez akejkoľvek záruky stability, dostupnosti, funkčnosti alebo bezpečnosti**.

7.5.2. SLA podľa Prílohy 2 sa **na Beta funkcie nevzťahuje**. Poskytovateľ je oprávnený Beta funkciu kedykoľvek upraviť alebo zrušiť bez predchádzajúceho oznámenia.

7.5.3. Použitie Beta funkcií je dobrovoľné. Zákazník používa Beta funkcie na vlastnú zodpovednosť.

### 7.6. Audit log a monitoring

7.6.1. Poskytovateľ je oprávnený monitorovať technickú prevádzku Služby (systémové logy, výkonové metriky, security events) na účely zabezpečenia jej riadneho fungovania a bezpečnosti.

7.6.2. Audit log obsahuje záznamy o operáciách v rámci Účtu Zákazníka a slúži na splnenie povinnosti accountability podľa čl. 5 ods. 2 GDPR. Detaily sú uvedené v DPA a [ROPA Processor view](../gdpr-article-30.md).

---

## 8. POZASTAVENIE A UKONČENIE ÚČTU

### 8.1. Pozastavenie zo strany Poskytovateľa

8.1.1. Poskytovateľ je oprávnený **pozastaviť Účet** Zákazníka v týchto prípadoch:

- (a) **omeškanie s platbou** podľa bodu 5.3.2;
- (b) **podstatné porušenie AUP** (bod 6.2) — pri menej závažných porušeniach Poskytovateľ Zákazníka najprv vyzve k náprave;
- (c) **podozrenie na bezpečnostný incident** ohrozujúci ostatných Zákazníkov platformy alebo integritu Služby;
- (d) **právny príkaz** orgánu verejnej moci alebo súdu;
- (e) **podozrenie na nezákonnú činnosť** Zákazníka súvisiacu s používaním Služby.

  8.1.2. Pozastavenie Účtu Zákazníkovi oznámi Poskytovateľ e-mailom Administrátorovi spolu s odôvodnením a krokmi potrebnými na obnovenie funkčnosti.

  8.1.3. Počas pozastavenia Účtu **Zákazník stráca prístup** k funkcionalite Služby, ale Dáta Zákazníka zostávajú zachované. Faktúrácia pokračuje v pôvodnom režime, ak Poskytovateľ neoznámi inak.

### 8.2. Ukončenie zmluvy

8.2.1. **Ukončenie zo strany Zákazníka** je možné:

- (a) **kedykoľvek bez udania dôvodu** pri samoobslužných Plánoch (Free, Pro Small, Pro Standard, Pro Plus) — výpoveď je účinná k poslednému dňu aktuálneho Fakturačného obdobia;
- (b) **k dátumu výročia Order Form** pri Plánoch dohodnutých v Order Form (Enterprise, Annual Contract) — výpoveď musí byť doručená najmenej 30 dní pred dátumom výročia;
- (c) **s okamžitou účinnosťou** pri vážnom porušení povinností Poskytovateľa podľa bodu 5.5.3.

  8.2.2. **Ukončenie zo strany Poskytovateľa** je možné:

- (a) **30-dňovou výpovedou bez udania dôvodu** doručenou e-mailom (typicky v prípade strategickej zmeny Služby alebo skončenia poskytovania Plánu);
- (b) **s okamžitou účinnosťou** pri:
  - závažnom porušení AUP Zákazníkom;
  - omeškaní s platbou viac ako 30 dní po lehote splatnosti;
  - nezákonnej činnosti Zákazníka;
  - zámernom uvedení nepravdivých údajov pri registrácii;
  - opakovanom porušení týchto Podmienok aj po výzve k náprave.

    8.2.3. **Výpoveď** musí byť doručená e-mailom na kontakt druhej Zmluvnej strany. Pri samoobslužných Plánoch postačí ukončenie cez nastavenia Účtu.

### 8.3. Dôsledky ukončenia

8.3.1. Po ukončení zmluvy Poskytovateľ:

- (a) **zachová Dáta Zákazníka v Účte** po dobu **30 kalendárnych dní** od dátumu ukončenia v read-only móde, počas ktorých Zákazník môže Dáta exportovať;
- (b) po uplynutí 30-dňovej lehoty **vymaže** Dáta Zákazníka v zmysle DPA bod 3.8;
- (c) audit log záznamy uchová podľa DPA bod 3.8.3 v pseudonymizovanej podobe;
- (d) Zákazníkovi vystaví **písomné potvrdenie** o vymazaní podľa DPA bod 3.8.5.

  8.3.2. **Export Dát Zákazníka**: Počas 30-dňovej lehoty po ukončení Zákazník môže exportovať Dáta cez:

- (a) funkcionalitu Služby (JSON / CSV export tenant prostredia);
- (b) na žiadosť Zákazníka — kompletný export celého Účtu vrátane príloh poskytnutý Poskytovateľom v rozumnej lehote (typicky 5 pracovných dní).

  8.3.3. Po ukončení zmluvy **zostávajú v platnosti** ustanovenia o:

- (a) ochrane Dôvernej informácie (sekcia 11);
- (b) duševnom vlastníctve (sekcia 9);
- (c) obmedzení zodpovednosti (sekcia 13);
- (d) náhrade škody (sekcia 14);
- (e) rozhodnom práve a riešení sporov (sekcia 17);
- (f) povinnostiach plynúcich z DPA (najmä mlčanlivosti a vrátení/vymazaní Osobných údajov).

---

## 9. DUŠEVNÉ VLASTNÍCTVO

### 9.1. Duševné vlastníctvo Poskytovateľa

9.1.1. **Zdrojový kód Platformy** je publikovaný ako open-source softvér pod licenciou **EUPL-1.2** na repozitári `github.com/ltksolutions/inventario` (alebo aktuálne uvedenej adrese v dokumentácii). Práva užívateľa k zdrojovému kódu sú stanovené licenciou EUPL-1.2.

9.1.2. **Hosted SaaS poskytovanie Služby** Poskytovateľom je samostatná služba nad rámec licencie EUPL-1.2. Tieto Podmienky upravujú práva a povinnosti pri tomto hostovanom poskytovaní.

9.1.3. **Ochranná známka „Inventario"**, logo, brand identity a vizuálne prvky **nie sú** súčasťou open-source licencie a sú chránené ako duševné vlastníctvo Poskytovateľa. Zákazník nadobúda obmedzené právo používať ochrannú známku „Inventario" výlučne na účely identifikácie Služby v internej komunikácii a v marketingových materiáloch popisujúcich integráciu / nasadenie Služby u Zákazníka.

9.1.4. **Dokumentácia Služby** publikovaná na `docs.inventario.estate` je licencovaná pod **CC-BY-4.0**, ak nie je výslovne uvedené inak.

### 9.2. Duševné vlastníctvo Zákazníka

9.2.1. Zákazník zostáva výlučným vlastníkom Dát Zákazníka a všetkých duševných práv k nim.

9.2.2. Zákazník udeľuje Poskytovateľovi **nevýhradnú, neprenosnú, časovo obmedzenú licenciu** používať Dáta Zákazníka výlučne na účely poskytovania Služby v zmysle týchto Podmienok a DPA. Licencia končí ukončením zmluvy s výnimkou toho, čo Poskytovateľ potrebuje na splnenie zákonných povinností (napríklad účtovných).

### 9.3. Spätná väzba

9.3.1. Ak Zákazník poskytne Poskytovateľovi spätnú väzbu, návrhy na zlepšenie alebo nápady na nové funkcionality, Poskytovateľ je oprávnený ich použiť **bez akéhokoľvek záväzku voči Zákazníkovi** a bez odplaty.

9.3.2. Ak Zákazník zverejní spätnú väzbu vo verejnom kanáli (GitHub issues, public roadmap), Zákazník súhlasí s tým, že spätná väzba sa stáva súčasťou verejnej diskusie o vývoji Služby.

### 9.4. Open-source príspevky

Ak Zákazník alebo jeho Používatelia prispievajú do open-source repozitára Platformy (cez pull requests, issues, code reviews), takéto príspevky sa riadia **CONTRIBUTING.md** repozitára a sú licencované pod EUPL-1.2 (kód) alebo CC-BY-4.0 (dokumentácia) podľa typu príspevku.

---

## 10. OCHRANA OSOBNÝCH ÚDAJOV

### 10.1. DPA ako neoddeliteľná súčasť

10.1.1. Ochrana Osobných údajov spracúvaných Poskytovateľom v mene Zákazníka sa riadi **Zmluvou o spracúvaní osobných údajov (DPA)** podľa čl. 28 GDPR. DPA je publikovaná na `inventario.estate/legal/dpa` a tvorí **neoddeliteľnú súčasť** týchto Podmienok.

10.1.2. Akceptáciou týchto Podmienok Zákazník akceptuje aj DPA. Pre Enterprise Plán môžu byť individuálne dojednanie v Order Form.

### 10.2. Privacy Policy

Spracúvanie Osobných údajov, ktoré Poskytovateľ spracúva ako prevádzkovateľ (návštevníci webu, marketing, vlastná komunikácia so Zákazníkom), sa riadi **Privacy Policy** publikovanou na `inventario.estate/privacy`.

### 10.3. Sub-processors

Aktuálny zoznam sub-procesorov Poskytovateľa je publikovaný na `inventario.estate/sub-processors`. Notifikácia o zmenách je upravená v DPA bod 3.4.

### 10.4. Cookies

10.4.1. Webová stránka `inventario.estate` a aplikácia `app.inventario.estate` používajú **technicky nevyhnutné cookies** na fungovanie Služby (autentifikačné cookies, session cookies). Tieto cookies nevyžadujú samostatný súhlas.

10.4.2. Pre **analytické cookies** alebo **marketingové cookies**, ktoré môžu byť v budúcnosti zavedené, si Poskytovateľ vyžiada samostatný súhlas Zákazníka prostredníctvom cookie bannera v zmysle § 109 zákona č. 452/2021 Z. z. o elektronických komunikáciách.

---

## 11. DÔVERNOSŤ A MLČANLIVOSŤ

### 11.1. Dôverné informácie

11.1.1. Za **Dôverné informácie** sa považujú všetky neverejné informácie, ktoré jedna Zmluvná strana sprístupní druhej v súvislosti s plnením zmluvy, najmä:

- (a) Dáta Zákazníka;
- (b) technické a obchodné informácie o Službe (architektúra, internal know-how, plánovaný roadmap);
- (c) cenové dojednania v Order Form;
- (d) interná dokumentácia a security praktiky.

### 11.2. Povinnosť zachovávať mlčanlivosť

11.2.1. Každá Zmluvná strana sa zaväzuje:

- (a) zachovávať mlčanlivosť o Dôverných informáciách druhej strany;
- (b) používať Dôverné informácie výlučne na účely plnenia tejto zmluvy;
- (c) sprístupňovať Dôverné informácie len takým osobám (zamestnanci, dodávatelia), ktoré ich nevyhnutne potrebujú pre plnenie zmluvy a sú zaviazaní k mlčanlivosti minimálne v rozsahu týchto Podmienok.

  11.2.2. Povinnosť mlčanlivosti trvá **počas trvania zmluvy a po dobu 5 rokov** po jej skončení.

### 11.3. Výnimky

Povinnosť mlčanlivosti sa **nevzťahuje** na informácie, ktoré:

- (a) sú alebo sa stanú verejne známymi bez zavinenia prijímajúcej Zmluvnej strany;
- (b) prijímajúca Zmluvná strana legálne získala od tretej strany bez záväzku mlčanlivosti;
- (c) prijímajúca Zmluvná strana je povinná zverejniť na základe zákona, súdneho rozhodnutia alebo rozhodnutia orgánu verejnej moci (s tým, že o tom druhú Zmluvnú stranu vopred informuje, ak je to právne prípustné).

### 11.4. Reference & marketing

11.4.1. Poskytovateľ je oprávnený **uviesť meno a logo Zákazníka** vo svojich marketingových materiáloch (webová stránka, prezentácie, case studies, výročné správy) ako referenciu, ak Zákazník neuvedie inak.

11.4.2. Pri publikácii **detailnej case study** s konkrétnymi informáciami o nasadení Služby u Zákazníka si Poskytovateľ vyžiada predchádzajúci písomný súhlas Zákazníka.

11.4.3. Zákazník je oprávnený kedykoľvek odvolať súhlas s použitím loga / mena ako referencie e-mailom na `legal@inventario.estate`. Odvolanie je účinné do 30 dní (čas potrebný na aktualizáciu materiálov).

---

## 12. ZÁRUKY

### 12.1. Záruka Poskytovateľa

12.1.1. Poskytovateľ vyhlasuje a zaručuje, že:

- (a) je oprávnený poskytovať Službu v rozsahu týchto Podmienok;
- (b) Služba bude poskytovaná s primeranou odbornou starostlivosťou v súlade s aktuálnym stavom techniky;
- (c) Služba bude poskytovaná v dostupnosti podľa **SLA** v Prílohe 2;
- (d) implementoval technické a organizačné opatrenia podľa GDPR a Prílohy 2 DPA;
- (e) ku zdrojovému kódu Platformy nepriamo zdokumentovaným spôsobom v `LICENSES/` adresári repozitára a `REUSE.toml` súbore má alebo zabezpečil licenčné práva potrebné na poskytovanie Služby a nie sú mu známe žiadne žaloby alebo nároky tretích osôb proti týmto právam.

  12.1.2. Žiadne ďalšie záruky, výslovné alebo implicitné, sa neposkytujú. Poskytovateľ najmä **negarantuje**:

- (a) že Služba bude vyhovovať konkrétnym špecifickým potrebám Zákazníka, ktoré neboli vopred písomne dohodnuté;
- (b) že Služba bude úplne bezchybná alebo bez prerušení (s výnimkou rámca SLA);
- (c) že Služba bude kompatibilná so všetkými existujúcimi alebo budúcimi systémami Zákazníka.

### 12.2. Záruka Zákazníka

Zákazník vyhlasuje a zaručuje, že:

- (a) je oprávnený uzavrieť túto zmluvu a má splnené všetky nevyhnutné povinnosti voči svojim Používateľom a dotknutým osobám;
- (b) Dáta Zákazníka, ktoré vkladá do Služby, sú v súlade s právnymi predpismi a neporušujú práva tretích osôb;
- (c) má právny základ na spracúvanie Osobných údajov, ktoré vkladá do Služby (čl. 6 a v relevantných prípadoch čl. 9 GDPR);
- (d) splnil informačné povinnosti voči dotknutým osobám (čl. 13 a 14 GDPR);
- (e) bude používať Službu v súlade s AUP a týmito Podmienkami.

---

## 13. OBMEDZENIE ZODPOVEDNOSTI

### 13.1. Vylúčenie zodpovednosti za nepriamu škodu

13.1.1. Žiadna Zmluvná strana **nezodpovedá** druhej Zmluvnej strane za:

- (a) ušlý zisk;
- (b) stratu obchodných príležitostí;
- (c) stratu dobrej povesti;
- (d) stratu obchodných dát Zákazníka mimo rozsah ustanovený v SLA a DPA;
- (e) inú nepriamu alebo následnú škodu vrátane škody spôsobenej prerušením podnikania, a to bez ohľadu na to, či bola druhá Zmluvná strana o možnosti vzniku takejto škody informovaná.

### 13.2. Maximálny limit zodpovednosti

13.2.1. **Celková agregovaná zodpovednosť Poskytovateľa** vyplývajúca z týchto Podmienok alebo súvisiaca s nimi (vrátane porušenia zmluvy, deliktu, neoprávnenej výpovede, nedbanlivosti alebo inej príčiny) je **obmedzená** súhrnnou sumou **uhradených poplatkov Zákazníkom za Službu** počas **12 mesiacov** bezprostredne predchádzajúcich udalosti, ktorá vznik nároku spôsobila.

13.2.2. Pre **Free Plán** je maximálna agregovaná zodpovednosť Poskytovateľa **EUR 100** (sto eur) za všetky udalosti spolu.

### 13.3. Výnimky z obmedzenia

13.3.1. Obmedzenia v bodoch 13.1 a 13.2 sa **NEVZŤAHUJÚ** na:

- (a) škodu spôsobenú **úmyselne** alebo z **hrubej nedbanlivosti**;
- (b) škodu na **živote, zdraví** alebo škodu, za ktorú zákon nedovoľuje obmedziť zodpovednosť;
- (c) škodu vzniknutú z **porušenia povinnosti zachovávať mlčanlivosť** (sekcia 11);
- (d) škodu z **porušenia povinností pri spracúvaní Osobných údajov** podľa DPA a GDPR — tu sa uplatňujú samostatné limity podľa čl. 82 GDPR;
- (e) povinnosť **uhradiť** dlžné poplatky za Službu.

### 13.4. Oprávnené reklamácie

Aby Zákazník mohol uplatniť nárok na náhradu škody, musí Poskytovateľa **písomne vyzvať** s opisom porušenia a vyčíslením škody **najneskôr do 90 kalendárnych dní** od momentu, keď sa o vzniku škody dozvedel alebo mohol dozvedieť. Po uplynutí tejto lehoty nárok **zaniká**.

---

## 14. NÁHRADA ŠKODY (INDEMNIFICATION)

### 14.1. Odškodnenie zo strany Zákazníka

14.1.1. Zákazník sa zaväzuje **odškodniť Poskytovateľa** za všetky priame škody, náklady (vrátane primeraných nákladov na právne zastúpenie) a pokuty, ktoré vzniknú v dôsledku:

- (a) porušenia AUP Zákazníkom alebo jeho Používateľmi;
- (b) Dát Zákazníka, ktoré porušujú práva tretích osôb;
- (c) spracúvania Osobných údajov v Službe **bez právneho základu** zo strany Zákazníka ako prevádzkovateľa;
- (d) nezákonnej činnosti Zákazníka alebo jeho Používateľov v súvislosti so Službou.

### 14.2. Odškodnenie zo strany Poskytovateľa

14.2.1. Poskytovateľ sa zaväzuje **odškodniť Zákazníka** za priame škody a primerané náklady na právne zastúpenie, ktoré vzniknú v dôsledku **úspešne uplatneného nároku tretej strany**, že používanie Služby Zákazníkom v súlade s týmito Podmienkami **porušuje duševné vlastníctvo** tretej strany platnej v EÚ.

14.2.2. Odškodnenie podľa bodu 14.2.1 je podmienené tým, že Zákazník:

- (a) bezodkladne písomne informuje Poskytovateľa o uplatnenom nároku;
- (b) ponechá Poskytovateľovi výhradné právo na obranu a urovnanie sporu;
- (c) poskytne Poskytovateľovi primeranú súčinnosť pri obrane;
- (d) bez predchádzajúceho súhlasu Poskytovateľa neuskutoční žiadne uznanie nároku alebo urovnanie.

  14.2.3. Odškodnenie podľa bodu 14.2.1 sa **nevzťahuje** na nároky tretích strán vyplývajúce z:

- (a) modifikácie Služby Zákazníkom alebo treťou stranou;
- (b) kombinácie Služby s iným softvérom alebo systémom Zákazníka;
- (c) použitia Služby v rozpore s týmito Podmienkami alebo dokumentáciou.

  14.2.4. V prípade úspešného nároku tretej strany na obmedzenie alebo zákaz používania Služby je Poskytovateľ oprávnený podľa vlastnej voľby:

- (a) získať pre Zákazníka licenciu na pokračovanie v používaní Služby;
- (b) modifikovať Službu tak, aby neporušovala práva tretej strany;
- (c) ukončiť poskytovanie Služby Zákazníkovi a vrátiť pomernú časť uhradených poplatkov za nevyužité obdobie.

### 14.3. Limit indemnifikácie

Celková výška odškodnenia podľa tejto sekcie 14 je obmedzená limitom uvedeným v bode 13.2, ak právny predpis neuvádza inak.

---

## 15. VYŠŠIA MOC

### 15.1. Definícia

Za **Vyššiu moc** sa považujú mimoriadne nepredvídateľné a neodvrátiteľné prekážky, ktoré nevznikli v dôsledku konania alebo nečinnosti Zmluvnej strany, najmä:

- (a) prírodné katastrofy (zemetrasenia, povodne, požiare, búrky);
- (b) vojnové konflikty, terroristické útoky, občianske nepokoje;
- (c) štátne zásahy, embargá, sankcie;
- (d) celonárodné výpadky telekomunikačnej infraštruktúry alebo elektrickej siete;
- (e) pandémie alebo epidémie ovplyvňujúce schopnosť plniť zmluvu;
- (f) výpadky cloud providerov (Vercel, MongoDB Atlas) mimo kontroly Poskytovateľa, ktoré spôsobia výpadok dlhší ako **8 hodín**.

### 15.2. Účinok Vyššej moci

15.2.1. V prípade Vyššej moci sa povinnosti dotknutej Zmluvnej strany **pozastavujú** po dobu trvania prekážky a primeranú dobu po jej zániku, potrebnú na obnovenie plnenia.

15.2.2. Dotknutá Zmluvná strana **bezodkladne informuje** druhú Zmluvnú stranu o vzniku, charaktere a očakávanom trvaní Vyššej moci.

15.2.3. Ak Vyššia moc trvá viac ako **30 kalendárnych dní**, **každá Zmluvná strana** má právo vypovedať zmluvu s okamžitou účinnosťou. V takom prípade Poskytovateľ vráti Zákazníkovi pomernú časť uhradených poplatkov za nevyužité obdobie.

---

## 16. ZMENA PODMIENOK

### 16.1. Oprávnenie meniť Podmienky

16.1.1. Poskytovateľ je oprávnený jednostranne meniť tieto Podmienky najmä v dôsledku:

- (a) zmien v právnych predpisoch;
- (b) zavedenia nových funkcionalít Služby;
- (c) zmien v architektúre alebo poskytovateľoch infraštruktúry;
- (d) odôvodnenej potreby zlepšenia ochrany Zákazníka, bezpečnosti alebo používateľského zážitku.

### 16.2. Oznámenie o zmene

16.2.1. O zmene Podmienok Poskytovateľ informuje Zákazníka:

- (a) **e-mailom** na kontakt Administrátora Účtu;
- (b) **zverejnením** novej verzie Podmienok na `inventario.estate/terms` s vyznačením dátumu účinnosti;
- (c) **najmenej 30 kalendárnych dní** pred účinnosťou zmeny.

  16.2.2. Pri zmenách, ktoré sú **iba upresnením, opravou typografických chýb alebo nemajú podstatný vplyv** na práva a povinnosti Zákazníka, môže byť oznamovacia lehota skrátená.

### 16.3. Akceptácia / odmietnutie zmeny

16.3.1. Ak Zákazník **nesúhlasí** so zmenou Podmienok, má právo:

- (a) vypovedať zmluvu **bezdôvodne** k poslednému dňu aktuálneho Fakturačného obdobia alebo
- (b) odmietnuť zmenu pre **aktuálne Fakturačné obdobie**, pričom Podmienky v platnej verzii pred zmenou sa uplatňujú do konca aktuálneho Fakturačného obdobia.

  16.3.2. **Pokračovanie v používaní Služby** po účinnosti novej verzie Podmienok sa považuje za akceptáciu zmeny.

  16.3.3. **Pri zmenách Podmienok v dôsledku zmien právnych predpisov** sa odmietnutie zmeny podľa bodu 16.3.1 nepripúšťa, ak by takéto odmietnutie viedlo k porušeniu právnych predpisov zo strany Poskytovateľa. V takom prípade má Zákazník iba právo vypovedať zmluvu.

---

## 17. ZÁVEREČNÉ USTANOVENIA

### 17.1. Rozhodné právo

Tieto Podmienky a všetky vzťahy z nich vyplývajúce sa riadia **právnym poriadkom Slovenskej republiky**, najmä Obchodným zákonníkom, Občianskym zákonníkom, GDPR a Zákonom o ochrane osobných údajov, s vylúčením kolíznych noriem.

### 17.2. Riešenie sporov

17.2.1. Zmluvné strany sa zaväzujú pokúsiť sa vyriešiť akýkoľvek spor vyplývajúci z týchto Podmienok primárne **rokovaním** v dobrej viere.

17.2.2. Ak rokovanie nevedie k vyriešeniu sporu do **60 kalendárnych dní** od jeho začatia, je daný spor príslušný **vecne a miestne príslušnému súdu Slovenskej republiky podľa sídla Poskytovateľa** (Okresný súd Žiar nad Hronom, resp. Krajský súd v Banskej Bystrici).

17.2.3. Pre spory týkajúce sa **spracúvania Osobných údajov** sa primárne uplatňuje DPA a osobitné dojednania v nej, vrátane práva dotknutých osôb obrátiť sa na ÚOOÚ SR alebo súd podľa čl. 77 — 79 GDPR.

### 17.3. Postúpenie zmluvy a práv

17.3.1. **Zákazník** nesmie postúpiť zmluvu alebo akékoľvek práva a povinnosti z nej vyplývajúce na tretiu osobu bez predchádzajúceho **písomného súhlasu** Poskytovateľa.

17.3.2. **Poskytovateľ** je oprávnený postúpiť zmluvu na svojho právneho nástupcu pri reštrukturalizácii, fúzii, akvizícii alebo predaji podniku, pričom o tom Zákazníka informuje s primeraným predstihom. Zákazník v takom prípade má **právo vypovedať zmluvu** bezdôvodne k dátumu účinnosti postúpenia.

### 17.4. Komunikácia

17.4.1. Všetky oznámenia podľa týchto Podmienok sa vykonávajú **e-mailom**:

- (a) zo strany Poskytovateľa — na e-mail Administrátora uvedený v Účte;
- (b) zo strany Zákazníka — na príslušný kontakt Poskytovateľa:
  - **zmluvné záležitosti**: `legal@inventario.estate`
  - **technická podpora**: `support@inventario.estate`
  - **GDPR**: `privacy@inventario.estate`
  - **security incidents**: `security@inventario.estate`

    17.4.2. E-mail sa považuje za doručený **prvým pracovným dňom** nasledujúcim po dni odoslania, ak nie je doručenkou alebo iným spôsobom preukázané skoršie doručenie.

    17.4.3. **Písomné oznámenia** (napríklad výpovedi pri Order Form zmluvách) sa odporúčajú doručovať aj poštou alebo elektronickým podpisom.

### 17.5. Oddeliteľnosť

Ak sa niektoré ustanovenie týchto Podmienok stane neplatným, neúčinným alebo nevykonateľným, **ostatné ustanovenia zostávajú v platnosti**. Neplatné ustanovenie sa nahradí ustanovením, ktoré najlepšie zodpovedá pôvodnému zámeru Zmluvných strán a je v súlade s platnými právnymi predpismi.

### 17.6. Žiadne vzdanie sa práva

Nevyužitie alebo oneskorené využitie ktoréhokoľvek práva alebo nároku zo strany ktorejkoľvek Zmluvnej strany sa **nepovažuje za vzdanie sa** tohto práva alebo nároku.

### 17.7. Úplná zmluva

Tieto Podmienky vrátane príloh, DPA a aktuálneho Cenníka tvoria **úplnú a jedinú zmluvu** medzi Zmluvnými stranami v predmete úpravy a nahrádzajú všetky predchádzajúce ústne aj písomné dohody, vyhlásenia, sľuby alebo dojednania týkajúce sa rovnakého predmetu. Výnimku tvorí Order Form, ktorý môže obsahovať odchylné dojednania.

### 17.8. Jazyk a verzie

17.8.1. Tieto Podmienky sú vyhotovené v **slovenskom jazyku**. Anglická alebo iná jazyková verzia, ak existuje, slúži iba na informačné účely; v prípade rozporu **má prednosť slovenská verzia**.

17.8.2. Pre Order Form a individuálne dojednania platí jazyk dohodnutý v Order Form.

### 17.9. Účinnosť

Tieto Podmienky nadobúdajú účinnosť **dňom akceptácie Zákazníkom** v zmysle bodu 2.2 alebo dňom podpisu Order Form, podľa toho, ktorý nastane skôr.

---

## KONTAKTY

| Účel kontaktu                     | E-mail / adresa                            |
| --------------------------------- | ------------------------------------------ |
| **Zmluvné záležitosti, ToS**      | legal@inventario.estate                    |
| **Technická podpora**             | support@inventario.estate                  |
| **GDPR, ochrana osobných údajov** | privacy@inventario.estate                  |
| **Bezpečnostné incidenty**        | security@inventario.estate                 |
| **Fakturácia**                    | billing@inventario.estate                  |
| **Verejná webová stránka**        | https://inventario.estate                  |
| **Dokumentácia**                  | https://docs.inventario.estate             |
| **Sub-processors register**       | https://inventario.estate/sub-processors   |
| **DPA**                           | https://inventario.estate/legal/dpa        |
| **Privacy Policy**                | https://inventario.estate/privacy          |
| **Cenník**                        | https://inventario.estate/pricing          |
| **Status / SLA monitoring**       | https://status.inventario.estate (planned) |

**Poskytovateľ**: LTK Solutions, s.r.o., Banícka 1894/17, 968 01 Nová Baňa, IČO: 45 949 310, IČ DPH: SK2023148017, OR OS Banská Bystrica, oddiel Sro, vložka 19280/S, konateľ Ing. Ján Letko

---

# PRÍLOHA 1 — PRAVIDLÁ PRIJATEĽNÉHO POUŽÍVANIA (AUP)

## A. Účel a rozsah

Tieto Pravidlá prijateľného používania (Acceptable Use Policy, ďalej **„AUP"**) stanovujú, akým spôsobom Zákazník a jeho Používatelia môžu používať Službu. Porušenie AUP môže viesť k pozastaveniu alebo ukončeniu Účtu podľa bodu 8 Podmienok.

## B. Zakázané obsahy

Zákazník sa zaväzuje neukladať do Služby a neprenášať prostredníctvom Služby obsah, ktorý:

1. **Porušuje právne predpisy**:
   - propaguje násilie, terorizmus alebo extrémizmus;
   - obsahuje detskú pornografiu alebo iné materiály sexuálnej povahy s neplnoletými osobami;
   - propaguje nenávisť na základe rasy, národnosti, pôvodu, náboženstva alebo iných chránených dôvodov;
   - porušuje pravidlá hospodárskej súťaže.

2. **Porušuje práva tretích osôb**:
   - autorské diela bez licencie alebo súhlasu autora;
   - chránené ochranné známky alebo iné označenia;
   - obchodné tajomstvo tretích strán;
   - osobné údaje tretích strán bez právneho základu na ich spracúvanie.

3. **Predstavuje malware alebo zlomyseľný kód**:
   - vírusy, trójske kone, ransomware;
   - exekutovateľné súbory určené na neoprávnené získanie prístupu;
   - scripts určené na prelomenie bezpečnostných opatrení.

4. **Obsahuje osobitné kategórie údajov bez právneho základu**:
   - genetické, biometrické, zdravotné údaje;
   - údaje o rasovom alebo etnickom pôvode;
   - údaje o politických názoroch, náboženstve, sexuálnej orientácii;
   - vkladá voľnotextovo do polí, ktoré nie sú špecificky určené na takéto údaje.

## C. Zakázané praktiky

Zákazník sa zaväzuje **nepoužívať Službu na**:

1. **Bezpečnostné útoky**:
   - DoS / DDoS útoky proti Službe alebo iným cieľom prostredníctvom Služby;
   - penetration testing Služby bez predchádzajúceho písomného súhlasu Poskytovateľa;
   - exploitácia bezpečnostných zraniteľností (vrátane responsible disclosure — viď bod E);
   - port scanning, network probing, brute-force pokusy proti Službe.

2. **Neoprávnený prístup**:
   - pokusy získať prístup k Účtom iných Zákazníkov;
   - pokusy obísť oprávnenia (RBAC), tenant isolation, MFA;
   - používanie cudzích prihlasovacích údajov.

3. **Spam a nevyžiadanú komunikáciu**:
   - rozosielanie nevyžiadanej obchodnej komunikácie cez e-mailové notifikácie Služby;
   - hromadné vytváranie účtov pre marketingové účely;
   - phishing alebo iné podvodné komunikácie.

4. **Zneužitie zdrojov**:
   - cryptocurrency mining alebo iné záťažové operácie nesúvisiace s primárnym účelom Služby;
   - extrémne API rate above dohodnutými limitmi;
   - storage abuse — používanie príloh ako náhrady cloud storage pre nesúvisiace súbory;
   - automated scraping iných tenantov alebo prevádzkovateľa.

5. **Reverse engineering**:
   - dekompilácia, disassembly alebo iná reprodukcia hostnutého kódu Služby nad rámec práv udelených licenciou EUPL-1.2 pre publikovaný zdrojový kód;
   - benchmark publikácia bez predchádzajúceho súhlasu Poskytovateľa.

6. **Anti-competitive activities**:
   - prevádzkovanie konkurenčnej služby na infraštruktúre Inventario;
   - automated reseller bez výslovného súhlasu Poskytovateľa.

## D. Acceptable use

Zákazník je naopak **oprávnený a podporovaný**:

- používať Službu na evidenciu majetku organizácie a vypožičky;
- prizvať svojich zamestnancov, členov a externých spolupracovníkov ako Používateľov;
- exportovať svoje dáta;
- prispievať do open-source repozitára Platformy podľa CONTRIBUTING.md;
- nahlasovať bugs, security vulnerabilities (responsible disclosure) a UX problémy.

## E. Responsible disclosure

1. Ak Zákazník alebo iný subjekt **objaví bezpečnostnú zraniteľnosť** v Službe:
   - bezodkladne ju oznámi e-mailom na `security@inventario.estate`;
   - **nezverejní** ju verejne pred dohodnutým termínom (typicky 90 dní od oznámenia alebo po vydaní fixu);
   - **nevyužije** zraniteľnosť na získanie neoprávneného prístupu, exfiltrácie dát ani iné nezákonné účely.

2. Poskytovateľ:
   - potvrdí prijatie oznámenia do **48 hodín**;
   - oznámi reporter-ovi plán riešenia v rozumnej lehote;
   - poďakuje sa reporter-ovi vo verejnej **Hall of Fame** stránke (`security.inventario.estate`), ak si reporter želá byť spomenutý;
   - **nezaviaže právne kroky** proti reporter-ovi, ktorý postupoval v dobrej viere v rámci tohto procesu.

## F. Vynucovanie AUP

1. **Drobné porušenia** rieši Poskytovateľ varovaním a výzvou k náprave do **7 kalendárnych dní**.

2. **Závažné porušenia** môžu viesť k:
   - **okamžitému pozastaveniu** Účtu (bod 8.1 Podmienok);
   - **ukončeniu zmluvy** s okamžitou účinnosťou (bod 8.2 Podmienok);
   - **trestnoprávnym alebo občianskoprávnym** opatreniam, ak je relevantné.

3. **Pri podozrení na trestnoprávne konanie** Poskytovateľ je oprávnený a v relevantných prípadoch povinný oznámiť skutočnosti **orgánom činným v trestnom konaní** a zachovať relevantné dôkazy (audit log) v súlade s GDPR a Zákonom o ochrane osobných údajov.

---

# PRÍLOHA 2 — DOHODA O ÚROVNI POSKYTOVANÝCH SLUŽIEB (SLA)

## A. Účel a rozsah

Táto Dohoda o úrovni poskytovaných služieb (Service Level Agreement, ďalej **„SLA"**) stanovuje minimálne parametre kvality Služby poskytovanej Poskytovateľom Zákazníkovi a opatrenia v prípade ich nedodržania.

**SLA sa nevzťahuje na Free Plán** (best-effort) a na **Beta funkcie**.

## B. Dostupnosť Služby

### B.1. Definícia dostupnosti

**Dostupnosť** Služby sa meria mesačne ako percento času, počas ktorého je Služba prístupná Zákazníkom prostredníctvom verejne dostupných endpointov (`app.inventario.estate`, `api.inventario.estate`).

Dostupnosť sa vypočítava podľa vzorca:

```
Dostupnosť (%) = (Celkový čas mesiaca − Nedostupný čas) / Celkový čas mesiaca × 100
```

### B.2. Minimálne ciele dostupnosti

| Plán                            | Cieľová dostupnosť (mesačne)   |
| ------------------------------- | ------------------------------ |
| Free                            | Best-effort (bez záruky)       |
| Pro Small                       | **99,5 %**                     |
| Pro Standard                    | **99,7 %**                     |
| Pro Plus                        | **99,9 %**                     |
| Enterprise / Annual Contract XL | **99,95 %** (alebo Order Form) |

### B.3. Vylúčenia z merania nedostupnosti

Do nedostupnosti sa **nezapočítava**:

- (a) **plánovaná odstávka** oznámená najmenej 48 hodín vopred (do 4 hodín mesačne);
- (b) **nedostupnosť spôsobená Vyššou mocou** (bod 15 Podmienok);
- (c) **nedostupnosť spôsobená Zákazníkom** alebo jeho infraštruktúrou (zlé pripojenie, miestne firewall, chybná konfigurácia DNS);
- (d) **nedostupnosť spôsobená nesúladom Dát Zákazníka** s limitmi Plánu (read-only mód);
- (e) **nedostupnosť Beta funkcií**;
- (f) **odstávky vyžiadané pre security incident response** v rozsahu primeranom riziku.

## C. Service credits za nedodržanie SLA

### C.1. Výpočet service credit

Pri nedosiahnutí cieľovej dostupnosti za daný mesiac má Zákazník nárok na **service credit** vo forme zníženia poplatku za nasledujúce Fakturačné obdobie:

| Skutočná dostupnosť (mesačne) | Service credit (z mesačného poplatku) |
| ----------------------------- | ------------------------------------- |
| **≥ Cieľová**                 | 0 %                                   |
| Cieľová − 0,5 %               | **10 %**                              |
| Cieľová − 1,0 %               | **25 %**                              |
| < Cieľová − 1,5 %             | **50 %**                              |

### C.2. Uplatnenie service credit

1. Zákazník **požiada o service credit** e-mailom na `legal@inventario.estate` do **30 kalendárnych dní** od konca mesiaca, v ktorom k nedosiahnutiu SLA došlo. Po uplynutí tejto lehoty nárok zaniká.

2. Žiadosť obsahuje:
   - obdobie, ktorého sa žiadosť týka;
   - identifikáciu Účtu;
   - opis vzniknutých problémov, ak sú Zákazníkovi známe.

3. Poskytovateľ rozhodne o žiadosti do **15 pracovných dní** a v prípade uznania nároku zníži poplatok v najbližšom Fakturačnom období o priznaný service credit.

4. Service credits **nie sú prevoditeľné v hotovosti** a nemožno ich kombinovať s ďalšími zľavami nad rámec dohodnutého maxima 40 % z Cenníka.

### C.3. Service credits ako výlučný nárok

Service credits podľa tejto SLA predstavujú **výlučný nárok** Zákazníka z titulu nedodržania dostupnosti Služby. Týmto nie sú dotknuté práva Zákazníka:

- vypovedať zmluvu pri vážnom porušení povinností Poskytovateľa (bod 5.5.3 Podmienok);
- nárokovať si náhradu škody nad rámec service credits len v prípadoch uvedených v bode 13.3 Podmienok.

## D. SLA podpory (reakčné časy)

### D.1. Kategorizácia incidentov

| Severity          | Definícia                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **P1 — Kritický** | Služba je úplne nedostupná pre všetkých Používateľov Zákazníka; alebo strata / poškodenie dát Zákazníka; alebo aktívny security incident |
| **P2 — Vysoký**   | Kľúčová funkcionalita Služby (autentifikácia, CRUD operácie majetku, vypožičky) je nedostupná alebo závažne degradovaná                  |
| **P3 — Stredný**  | Niektorá funkcia Služby nefunguje korektne, ale existujú workaroundy                                                                     |
| **P4 — Nízky**    | Kozmetická chyba, dotaz na funkcionalitu, návrh na zlepšenie                                                                             |

### D.2. Cieľové reakčné časy (Time To Response — TTR)

| Severity / Plán | Free        | Pro Small   | Pro Standard | Pro Plus    | Enterprise  |
| --------------- | ----------- | ----------- | ------------ | ----------- | ----------- |
| **P1**          | 5 prac. dní | 24 h        | 12 h         | 4 h         | **2 h**     |
| **P2**          | Best-effort | 48 h        | 24 h         | 12 h        | 6 h         |
| **P3**          | Best-effort | 5 prac. dní | 3 prac. dni  | 2 prac. dni | 1 prac. deň |
| **P4**          | Best-effort | Best-effort | 5 prac. dní  | 5 prac. dní | 3 prac. dni |

> **Pozn.**: Reakčný čas (TTR) znamená čas od prijatia oznámenia o incidente do prvej zmysluplnej reakcie Poskytovateľa. **Neuvádza čas vyriešenia incidentu (Time To Resolve)**, ktorý je vždy podmienený povahou incidentu.

### D.3. Kanály podpory

- **Email** (`support@inventario.estate`) — všetky Plány;
- **Webový support portál** (`support.inventario.estate`) — _planned_;
- **Telefónna podpora** (`+421 ...`) — Pro Plus a Enterprise;
- **Dedikovaný account manager** — Enterprise (4-hodinová reakcia v pracovné dni).

## E. Continuous improvement a transparentnosť

1. **Status stránka**: Poskytovateľ prevádzkuje status stránku (`status.inventario.estate` — _planned_), ktorá v reálnom čase ukazuje stav komponentov Služby.

2. **Post-mortem reports**: Pre incidenty severity P1, ktoré boli spôsobené Poskytovateľom, Poskytovateľ publikuje verejný post-mortem report do **5 pracovných dní** od ukončenia incidentu, s opisom príčiny, dopadu a opatrení na predchádzanie.

3. **Mesačný SLA report** pre Enterprise: Poskytovateľ zasiela Enterprise Zákazníkom mesačný report dostupnosti a podpory za uplynulý mesiac.

---

**KONIEC PODMIENOK A PRÍLOH**

---

## Kontrolný zoznam pred prvým publikáciou (interný, nepatrí do publikovanej verzie)

- [x] Doplnená vložka v Obchodnom registri (sekcia Poskytovateľ) — _19280/S, OS Banská Bystrica_
- [ ] Zriadené mailboxy `legal@`, `support@`, `billing@` na `inventario.estate`
- [ ] Pripravená stránka `https://inventario.estate/terms` (publikácia ToS)
- [ ] Pripravená stránka `https://inventario.estate/legal/dpa` (publikácia DPA)
- [ ] Pripravená stránka `https://inventario.estate/privacy` (Privacy Policy — Fáza 1)
- [ ] Pripravená stránka `https://inventario.estate/pricing` (Cenník — aktuálny)
- [ ] Pripravená stránka `https://inventario.estate/sub-processors` (Sub-processors register)
- [ ] Pripravený mechanizmus checkboxu „Súhlasím s Podmienkami a DPA" v registračnom flow `app.inventario.estate`
- [ ] Pripravený **Cookie banner** (pre prípad zavedenia non-essential cookies)
- [ ] Pripravený šablónovaný **Order Form** pre Enterprise a Annual Contract
- [ ] Pripravený mechanizmus **e-mailovej notifikácie o zmene Podmienok** (30 dní vopred)
- [ ] **Status stránka** `status.inventario.estate` — _planned_
- [ ] **Šablóna pripomienkovaná slovenským advokátom špecializujúcim sa na IT a obchodné právo** ⚠️
