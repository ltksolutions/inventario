# Nový zamestnanec dostáva pracovné vybavenie

> 🎬 **Scenár:** Marián nastúpil ako nový analytik do oddelenia rozvoja mládeže. V deň nástupu treba zabezpečiť kompletné IT vybavenie a prístupy.
> 👥 **Zúčastnení:** HR oddelenie, IT správca, manažér nového zamestnanca, Marián (nový zamestnanec)
> 📅 **Časový rámec:** Týždeň pred nástupom až 2 týždne po nástupe

## Kontext

Onboarding nového zamestnanca SFZ je rutinný proces, ktorý sa opakuje 20–30× ročne. Pred Asset Managementom išlo o reťazec e-mailov medzi HR, IT a manažérom, pričom sa často stávalo, že zamestnanec mal v deň nástupu **„len kávu a heslo k Wi-Fi"**, kým notebook prišiel až o tri dni neskôr.

Tento scenár ukazuje, ako predstihnúť problémy vďaka:

- **Šablónam zápožičiek** (pre štandardných „onboarding balíčkov" podľa pozície)
- **Plánovaným zápožičkám** (vznikajú vopred, prevezmú sa v deň nástupu)
- **Integrácii s Entra ID** (účet v aplikácii sa vytvorí automaticky po pridaní do Active Directory)

## Aktéri

- **Marián Polák, nový zamestnanec** — analytik mládežníckeho rozvoja, prvý deň 1. apríla
- **Lucia Hricová, HR partner** — pripravuje administratívu pred nástupom
- **Tomáš Varga, IT správca** — pripravuje notebook, mobil, accounty
- **Igor Šimko, manažér** — vedúci oddelenia rozvoja mládeže, schvaľuje rozsah vybavenia

## Priebeh

### 📅 Týždeň pred nástupom: HR zakladá zápožičku vopred

Lucia z HR dostane od Igora potvrdenie, že Marián nastúpi 1. apríla na pozíciu „Analytik mládežníckeho rozvoja". V Inventario klikne na **Šablóny zápožičiek** a vyberie predpripravenú šablónu **„Onboarding — Analytik"**, ktorá obsahuje:

- Notebook MacBook Air M3 (alebo ekvivalent)
- iPhone (pracovný mobil)
- Externý monitor 27"
- Klávesnica + myš
- Sluchátka pre online stretnutia

> 📸 **TODO: insert screenshot** — Galéria šablón zápožičiek so šablónami pre rôzne pozície (Analytik, Tréner, Asistent, Office manažér)

Lucia upraví termín — od `2025-04-01 08:00` (deň nástupu, ráno) — a **odošle žiadosť** s poznámkou „Onboarding M. Polák". V tomto bode Marián ešte **nemá účet** v Asset Managemente (lebo nie je v Active Directory).

> 💡 **Tip:** Pri zápožičkách pre osobu, ktorá ešte nemá účet, sa použije **„placeholder identifikátor"** (meno + plánovaný e-mail). Po prvom prihlásení sa zápožička automaticky priradí k novovytvorenému účtu.

### 📅 5 dní pred nástupom: IT pripravuje vybavenie

Tomáš dostane notifikáciu o novej žiadosti od HR. Otvorí ju a vidí presný zoznam s plánovaným termínom. Tomáš:

1. **Schváli žiadosť** (s drobnou zmenou — namiesto „MacBook Air M3" priradí konkrétny kus zo skladu, sériové číslo `MB-2024-014`)
2. **Pripraví notebook**:
   - Inštalácia macOS + StandardBuilt SFZ image
   - Pripojenie k MDM (Mobile Device Management)
   - Pred-konfigurácia Outlook, Teams, Slack
3. **Pripraví mobil**:
   - eSIM aktivácia
   - Pred-konfigurácia firemných apps
4. **Označí položky ako „Pripravené na prevzatie"**

> 📸 **TODO: insert screenshot** — Tomášov dashboard s nastavenou onboarding zápožičkou v stave „Pripravené na prevzatie"

### 📅 1 deň pred nástupom: Aktivácia účtov

Vďaka integrácii s Microsoft Entra ID sa **Mariánov účet** automaticky vytvorí, keď ho IT pridá do AD skupiny „SFZ Employees". Marián dostane:

- **Welcome e-mail** od Inventario s linkom na aktiváciu
- Inštrukcie pre prvé prihlásenie (rovnaké ako pri každom novom zamestnancovi)

V tom okamihu sa **zápožička z placeholderu prepojí na reálny účet** Mariána.

> 💡 **Tip:** Marián môže ešte pred nástupom prejsť cez **virtuálny onboarding tutoriál** v aplikácii — ukáže mu, kde nájde svoje zápožičky, ako požiadať o ďalšie veci, atď.

### 📅 Deň nástupu: Prevzatie

8:30 — Marián príde, dostane orientačnú prehliadku. 9:30 — ide s Luciou k Tomášovi do IT skladu.

Tomáš otvorí v systéme Mariánovu zápožičku, **naskenuje QR kódy** všetkých 5 položiek, spolu prejdú stav každého kusu (notebook nový → `EXCELLENT`, ostatné rovnako). Marián digitálne **podpíše preberací protokol**.

V momente podpisu:

- Notebook, mobil, monitor, klávesnica, myš, sluchátka → stav `BORROWED`
- Zápožička → stav `ACTIVE`
- Mariánovi prichádza e-mailom **PDF protokol o prevzatí**
- V audit logu vzniká záznam s časom, IP adresou a snapshotom polí

10:00 — Marián je za stolom, prihlásený do notebooku, môže začať pracovať.

> 📸 **TODO: insert screenshot** — Mariánovo zobrazenie „Moje zápožičky" s aktívnou onboarding zápožičkou a 5 položkami

### 📅 Týždeň po nástupe: Dopĺňanie podľa potreby

Marián zistí, že na analýzu videí potrebuje aj **druhý externý monitor** a **kvalitnejšie sluchátka**. Otvorí v aplikácii **Majetok → IT → Periférie**, nájde dostupné položky a podá žiadosť. Tentokrát si vystačí sám — bez HR ani manažéra:

1. Vyhľadá monitor → klikne **Požičať** → vyplní účel „Práca s videoobsahom"
2. Žiadosť ide automaticky Tomášovi
3. Tomáš schváli do hodiny (jednoduchá štandardná žiadosť)
4. Marián si po obede vyzdvihne v sklade

Detaily nájdeš v [Ako si požičať majetok](../how-to/poziciat-majetok.md).

## Čo systém pre tento scenár robí

- ✅ **Šablóny zápožičiek** — onboarding balíčky podľa pozície sa nedefinujú zakaždým ručne
- ✅ **Placeholder identifikátory** — zápožička vznikne aj pred vytvorením účtu, prepojí sa automaticky
- ✅ **Entra ID integrácia** — žiadne ručné vytváranie účtov, žiadne zabudnuté práva
- ✅ **Plánovaný termín v budúcnosti** — IT vie pripraviť veci vopred, nie len v deň nástupu
- ✅ **Predvyplnené protokoly v SFZ vizuále** — žiadne ručné dokumenty
- ✅ **Self-service pre ďalšie veci** — zamestnanec si vie pridať vybavenie sám, bez HR

## Čo sa stane, keď niečo zlyhá

### Marián nakoniec nenastúpi

Lucia v deň pred nástupom dostane informáciu, že Marián odmietol ponuku. Otvorí žiadosť a klikne **Zrušiť**. Položky sa automaticky vrátia na `AVAILABLE`, Tomáš dostane notifikáciu.

### Marián odíde po 3 mesiacoch

V tom prípade prebehne **offboarding** — opačný proces:

1. HR otvorí Mariánovu zápožičku
2. Klikne **Iniciovať vrátenie**
3. Tomáš s Mariánom prejdú každú položku, skontrolujú stav
4. Stratené alebo poškodené veci sa riešia podľa interného procesu

Po dokončení vrátenia sa Mariánov **účet deaktivuje** (Entra ID + Asset Management). Audit log uchová celú jeho zápožičkovú históriu.

### V deň nástupu chýba jedna položka

Sluchátka sa medzitým rozbili a sú v servise. Tomáš v žiadosti **navrhne náhradu** (iné dostupné sluchátka). Lucia (alebo Marián, ak už má účet) potvrdí, a všetko pokračuje.

## Z čoho tento scenár ťaží

| Pred Asset Managementom                                | Po zavedení                             |
| ------------------------------------------------------ | --------------------------------------- |
| Reťazec e-mailov medzi HR ↔ IT ↔ manažérom             | Jedna žiadosť cez šablónu               |
| Notebook chodil 1–3 dni po nástupe                     | Pripravený deň pred nástupom            |
| Účet sa zakladal ručne                                 | Automaticky cez Entra ID synchronizáciu |
| Papierové protokoly                                    | Digitálne PDF s podpismi                |
| „Kto má aktuálne čo?" — Excel, ktorý sa neaktualizoval | Real-time prehľad v systéme             |
| Pri odchode zamestnanca sa zabudlo vrátiť niečo        | Automatický offboarding workflow        |

## Súvisiace návody a tutoriály

- 🚀 [Tvoje prvé prihlásenie](../getting-started/prve-prihlasenie.md)
- 🛠️ [Ako si požičať majetok](../how-to/poziciat-majetok.md)
- 📖 [Reprezentačný výjazd: hromadná zápožička pre tím](./reprezentacny-vyjazd.md)
- 📚 [Stavy majetku a zápožičiek](../reference/stavy.md)

---

<sub>Posledná aktualizácia: 2025-01 · Cieľová rola: HR, IT správca, nový zamestnanec</sub>
