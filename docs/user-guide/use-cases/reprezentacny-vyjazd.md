# Viacdňová akcia: vedúci tímu si berie kompletný set vybavenia

> 🎬 **Scenár:** Pätnásťčlenný tím vyráža na štvordňovú akciu mimo sídla organizácie. Vedúci potrebuje zabezpečiť kompletné vybavenie naprieč rôznymi kategóriami – prezentačnú techniku, IT vybavenie, komunikačné zariadenia a spotrebný materiál.
> 👥 **Zúčastnení:** Vedúci akcie, jeho zástupca, správkyňa skladu, IT správca
> 📅 **Časový rámec:** 2 týždne pred akciou až 1 týždeň po návrate

## Kontext

Viacdňová akcia mimo sídla je logisticky najnáročnejší typ zápožičky:
veľa položiek naraz, viac kategórií, viac schvaľovateľov a tvrdý termín.
Tím cestuje na 4-5 dní a potrebuje:

- **Prezentačnú techniku** – stánok, roll-upy, projektor, ozvučenie
- **IT vybavenie** – notebooky, tablety, kamera na záznam
- **Komunikačné zariadenia** – rádiové stanice pre koordináciu na mieste
- **Spotrebný materiál** – z tých položiek, ktoré sa vedú množstevne

Pred zavedením Inventaria sa takáto evidencia robievala v Exceli a v kombinácii e-mailov. Často sa stávalo, že sa nejaká položka po návrate „stratila vo víre" a doplatila sa až o pol roka neskôr. Tento scenár ukazuje, ako celý proces vyzerá v systéme – od plánovania po vrátenie.

> 💡 Scenár je zámerne konkrétny, ale nie odvetvový. Ak u vás ide o výjazd
> športového tímu, montážnu partiu alebo filmový štáb, kroky sú tie isté —
> mení sa len obsah zoznamu.

## Aktéri

- **Peter Novák, vedúci akcie** – iniciátor zápožičky, zodpovedný za prevzatie a vrátenie kompletného setu
- **Martin Kováč, jeho zástupca** – pomáha s prevzatím a kontrolou, môže prevziať časť vybavenia v Petrovom mene
- **Anna Horváthová, správkyňa skladu** – schvaľuje a vydáva prezentačnú techniku a materiál
- **Tomáš Varga, IT správca** – schvaľuje a vydáva IT techniku (notebooky, tablety, kamera)

## Priebeh

### 📅 14 dní pred akciou: Plánovanie a žiadosť

Peter dostane potvrdený termín akcie a začína plánovať. Prihlási sa do Inventario a v sekcii **Tímové žiadosti** vytvorí **hromadnú žiadosť o zápožičku**.

V žiadosti vyplní:

- **Účel:** „Výjazd tímu – Budapešť, 18.–23. marec"
- **Termín od:** 18. marec, 8:00
- **Termín do:** 23. marec, 20:00
- **Zoznam položiek:**
  - 1× prezentačný stánok (v prepravnom obale)
  - 4× roll-up
  - 1× projektor + 1× ozvučenie
  - 1× kamera na záznam (Sony FX-30)
  - 3× prenosný notebook
  - 2× tablet
  - 5× rádiová stanica

Po odoslaní sa žiadosť **automaticky rozdelí** podľa kategórií:

- Prezentačná technika a materiál → ide na schválenie Anne (skladová správkyňa)
- IT časť → ide na schválenie Tomášovi (IT správca)

> 📸 **TODO: insert screenshot** – Formulár hromadnej žiadosti so zoznamom položiek a rozdelením pod sekcie podľa schvaľovateľov.

> 💡 **Tip:** Detaily o tom, ako vytvoriť hromadnú žiadosť, nájdeš v Hromadná zápožička pre tím _(TODO)_.

### 📅 12 dní pred akciou: Schvaľovanie

Anna aj Tomáš dostanú **e-mailovú notifikáciu** a notifikáciu v systéme. Otvoria si žiadosť a vidia:

- ✅ Termín nezasahuje do iných plánovaných zápožičiek (systém automaticky kontroluje dostupnosť)
- ✅ Peter má oprávnenia na všetky vyžiadané kategórie
- ✅ Žiadne nedoručené predchádzajúce zápožičky

Anna schváli skladovú časť **celú naraz**. Tomáš na IT časti urobí drobnú zmenu – kameru Sony FX-30 nemôže poskytnúť (je v servise), navrhne náhradu Panasonic Lumix GH-6.

Peter dostane notifikáciu o návrhu zmeny a **schválí náhradu**. Tým je celá žiadosť kompletne schválená.

> 📸 **TODO: insert screenshot** – Detail schválenej žiadosti so zelenými ikonami pri každej položke a poznámkou o náhrade kamery.

### 📅 1 deň pred akciou: Príprava a prevzatie

Anna deň vopred **pripraví vybavenie v sklade** – fyzicky vyloží všetky položky na zberné miesto. V systéme každú položku označí ako „Pripravená na prevzatie", čo automaticky:

- Vygeneruje **preberací protokol vo formáte PDF** s logom vašej organizácie
- Pošle Petrovi notifikáciu „Vaša zápožička je pripravená na prevzatie"

Ráno príde Peter spolu s Martinom do skladu. Anna im odovzdá vybavenie a spoločne:

1. **Naskenuje QR kódy** všetkých položiek mobilom – systém ich označí ako „Prevzaté"
2. Skontrolujú **fyzický stav** – Peter pri jednom roll-upe označí „mierne odretý okraj (známe pred zápožičkou)"
3. Obaja **podpíšu protokol** – Anna ako odovzdávajúca, Peter ako preberajúci

> 📸 **TODO: insert screenshot** – Mobilný pohľad na skenovanie QR kódu položky s tlačidlom „Označiť ako prevzaté".

V tom istom čase Peter prejde aj k Tomášovi do IT skladu a podobne prevezme IT časť. Pretože je všetko v jednej žiadosti, **systém vie, že prevzatie je rozdelené medzi dvoch správcov** – Peter má v aplikácii prehľad „2 z 2 prevzatia dokončené".

### 📅 Počas výjazdu: Sledovanie

Počas 4-dňového výjazdu Peter ani Anna nepotrebujú systém otvárať. Všetky položky majú stav „Zapožičané" a termín vrátenia je viditeľný v ich kalendároch.

V deň, kedy sa blíži termín vrátenia (24h pred), Peter dostane **automatickú pripomienku** e-mailom: „Tvoja zápožička sa zajtra končí. Pripravil si veci na vrátenie?"

### 📅 1 deň po návrate: Kontrola a vrátenie

Peter sa s Martinom vrátia do skladu. Pomocou rovnakého procesu, ale naopak:

1. **Naskenujú QR kódy** všetkých vrátených položiek
2. Anna fyzicky **skontroluje stav** – pri jednom roll-upe označí „zlomená noha stojana, treba poslať na opravu"
3. Notebook s ID `LT-2024-008` má praskle sklo – Tomáš ho prijme, ale automaticky vytvorí **servisnú úlohu**

Položky majú teraz tieto výsledné stavy:

| Položka                     | Stav po vrátení |
| --------------------------- | --------------- |
| 1× prezentačný stánok       | ✅ Dostupné     |
| 3× roll-up                  | ✅ Dostupné     |
| 1× roll-up (zlomený stojan) | 🛠️ V servise    |
| 1× projektor                | ✅ Dostupné     |
| 1× ozvučenie                | ✅ Dostupné     |
| 1× Panasonic Lumix GH-6     | ✅ Dostupné     |
| 2× notebook                 | ✅ Dostupné     |
| 1× notebook (LT-2024-008)   | 🛠️ V servise    |
| 2× tablet                   | ✅ Dostupné     |
| 5× rádiová stanica          | ✅ Dostupné     |

Po dokončení sa **automaticky vygeneruje záverečný protokol** so zoznamom vrátených položiek, ich stavom a podpisom oboch strán. PDF sa uloží k zápožičke v archíve a pošle e-mailom Petrovi aj Anne.

> 📸 **TODO: insert screenshot** – Finálny preberací protokol s logom organizácie, zoznamom položiek a stavmi.

## Čo systém pre tento scenár robí

- ✅ **Hromadná žiadosť** spája viaceré položky pod jednu transakciu, aj keď ich schvaľuje viacero správcov
- ✅ **Automatická kontrola dostupnosti** pri vytváraní žiadosti – upozorní na konflikt s inou zápožičkou
- ✅ **Automatické rozdelenie** žiadosti medzi schvaľovateľov podľa kategórie majetku
- ✅ **QR kódy** zrýchľujú prevzatie aj vrátenie – netreba ručne hľadať položku v zozname
- ✅ **Predvyplnené PDF protokoly** vo vizuále vašej organizácie so všetkými údajmi a logom
- ✅ **Pripomienky e-mailom** pred koncom zápožičky
- ✅ **Automatické vytvorenie servisných úloh** pri poškodených položkách
- ✅ **Kompletný audit log** – kto, kedy, čo prevzal, vrátil, v akom stave

## Čo sa stane, keď niečo zlyhá

### Vedúci si zabudne vyžiadať niečo doplnkové

V deň prevzatia Peter zistí, že potrebuje ešte jeden predlžovací kábel. Nemusí vytvárať novú žiadosť – Anna mu vie **pridať položku do existujúcej zápožičky priamo v sklade** ako „dodatočné prevzatie". Anna len musí mať oprávnenie schvaľovať na danú kategóriu.

### Položka sa stratí počas výjazdu

Peter zistí v Budapešti, že chýba jedna rádiová stanica. Otvorí si zápožičku v mobile, klikne na položku **RS-2024-003** a zvolí **Nahlásiť stratu**. Vyplní krátky popis (kde a kedy si to všimol). Systém:

- Označí položku ako 🚨 **„Stratená"**
- Pošle notifikáciu Tomášovi (IT správca) a manažérovi
- Vytvorí záznam v audit logu

Po návrate sa vyúčtovanie rieši interným procesom organizácie – či to bude reklamácia od dodávateľa, alebo iný postup. Inventario dodá podklad (kto, kedy, v akom stave), rozhodnutie nerobí.

### Vedúci nestihne vrátiť včas

Ak by Peter zápožičku nevrátil do termínu, systém po 24 hodinách:

- Označí položky ako 🔴 **„Po termíne"**
- Pošle Petrovi 3 pripomienky (24h, 48h, 72h)
- Informuje Annu a manažéra

Peter môže buď **predĺžiť zápožičku** (ak má oprávnenie a Anna schváli), alebo riskuje administratívne sankcie.

## Z čoho tento scenár ťaží

Pred Inventariom táto logistika znamenala:

- 📧 ~30 e-mailov medzi vedúcim, skladom a IT
- 📊 Manuálne vedený Excel, do ktorého sa občas zabudli zapísať vrátenia
- 📄 Ručne tlačené protokoly bez jednotnej formy
- 🔍 Polročné inventúry, počas ktorých sa zistilo, že chýba pol skladu

Po zavedení Inventaria:

- 📱 **Jedna žiadosť**, dva kliky, schválená cez systém
- 📦 **QR kódy** = prevzatie zo skladu trvá 15 minút namiesto hodiny
- 📋 **Protokoly automaticky** v jednotnom dizajne organizácie
- 🎯 **Real-time prehľad** o tom, čo kde je
- 💰 Organizácia ušetrí na nezvestnom majetku a oprava poškodených vecí prebieha bez prieťahov

## Súvisiace návody a tutoriály

- 🛠️ Hromadná zápožička pre tím _(TODO)_ – konkrétny postup
- 🛠️ Ako predĺžiť zápožičku _(TODO)_
- 🛠️ [Ako vrátiť majetok](../how-to/vratit-majetok.md)
- 📖 Hromadné vydanie vybavenia pre veľkú akciu (60+ osôb) _(TODO)_ – podobný scenár vo väčšom rozsahu
- 📚 [Stavy majetku a zápožičiek](../reference/stavy.md)

---

<sub>Posledná aktualizácia: 2026-09 · Cieľová rola: vedúci akcie, správca skladu, IT správca</sub>
