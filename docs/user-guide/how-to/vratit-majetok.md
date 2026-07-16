# Ako vrátiť majetok

> 🎯 **Cieľ:** Vrátiť zapožičaný majetok do skladu a uzavrieť aktívnu zápožičku.
> 👤 **Pre koho:** Každý, kto má aktívnu zápožičku
> ⏱️ **Trvanie:** 3–5 minút na vrátenie 1–3 položky, viac pri hromadných

## Predpoklady

- Máš aktívnu zápožičku v systéme
- Si fyzicky v sklade, kde má prebehnúť vrátenie
- Položky sú **fyzicky pri tebe** (správca ich preberie)

## Postup

### 1. Otvor svoju aktívnu zápožičku

V menu choď na **Moje zápožičky → Aktívne**. Klikni na zápožičku, ktorú ideš vrátiť.

> 📸 **TODO: insert screenshot** — Detail aktívnej zápožičky s tlačidlom „Vrátiť" v pravej hornej časti

### 2. Spusti proces vrátenia

Klikni na **Vrátiť**. Systém ťa prevedie cez kontrolný proces.

> 💡 **Tip:** Vrátenie môžeš spustiť aj ty (vypožičiavajúci), aj správca skladu. Druhá strana musí len potvrdiť.

### 3. Skontroluj stav položiek (spolu so správcom)

Pre každú položku v zápožičke:

1. **Naskenuj QR kód** (alebo vyber zo zoznamu)
2. **Vyber aktuálnu kondíciu** — Excellent / Good / Fair / Poor / Unusable
3. **Voliteľne pridaj poznámku** — napríklad „Mierne poškriabaný kryt"
4. **Voliteľne nahraj fotky** poškodení (mobil ti otvorí kameru)
5. Označ **„Potrebuje servis"**, ak je vec nepoužiteľná

> 📸 **TODO: insert screenshot** — Mobilný pohľad na položku počas vrátenia: foto, kondícia (dropdown), poznámka, checkbox „Vyžaduje servis"

> ⚠️ **Pozor:** Ak je položka **stratená alebo veľmi poškodená**, vyber **„Nahlásiť ako stratenú/zničenú"**. Systém vytvorí samostatný **incident** a postupuje sa podľa interného procesu SFZ (reklamácia/vyúčtovanie).

### 4. Pridaj záverečnú poznámku

Voliteľná **poznámka k celej zápožičke** — napríklad celkový dojem, neobvyklé okolnosti, návrhy na zlepšenie skladovacích podmienok.

### 5. Podpíš protokol o vrátení

Obaja (ty + správca) **kliknete na podpis**. Systém:

- Vygeneruje **PDF protokol o vrátení** s logom SFZ
- Uzavrie zápožičku (stav `RETURNED` alebo `DAMAGED`)
- Pošle obom e-mailom kópiu protokolu

> 📸 **TODO: insert screenshot** — Finálny protokol o vrátení s digitálnymi podpismi a zoznamom položiek

## Po dokončení

- Položky sa automaticky **aktualizujú** v evidencii:
  - V poriadku → `AVAILABLE` (môže si ich zase niekto požičať)
  - Vyžadujú servis → `IN_SERVICE` (automaticky vznikne servisná úloha)
  - Stratené → `LOST` (vznikne incident)
- Zápožička sa presunie z **Aktívne** do **História**
- Ty aj správca dostanete e-mailom finálny PDF protokol

## Možné problémy

### Nemôžem nájsť „Vrátiť" tlačidlo

- Zápožička musí byť v stave **🔵 Aktívna** alebo **🔴 Po termíne** — ak je už `RETURNED`, vrátiť sa nedá znova
- **Skontroluj, či nie si v „História"** — tam tlačidlo nie je

### Stratil som jednu položku z hromadnej zápožičky

Nie je problém — pri vrátení označ konkrétnu položku ako **„Nahlásiť ako stratenú"**. Ostatné položky sa vrátia normálne. Stratená položka pôjde do separátneho incidentu.

### Zápožička je po termíne

Vráť ju aj tak — systém ti dovolí. Záznam ostane v audit logu, že si meškal, ale samotné vrátenie je vždy možné.

### Správca nemá čas teraz vrátiť

Môžeš spustiť **„Predbežné vrátenie"** — naskenuješ položky, ale protokol nepodpíšeš. Správca to dokončí v rámci pracovných hodín.

> ⚠️ **Pozor:** Pri „Predbežnom vrátení" si stále zodpovedný za majetok, kým správca formálne nepodpíše protokol.

## Vrátenie od osoby (viac zápožičiek naraz)

Ak má jedna osoba požičaný majetok z **viacerých rôznych zápožičiek** naraz
(napr. notebook z jednej žiadosti, monitor z inej), správca (ASSET_MANAGER
alebo ADMIN) nemusí riešiť každú zápožičku osobitne. Na detaile osoby
(**Používatelia → [meno osoby]**) je tlačidlo **„Vrátiť majetok"**, ktoré:

- zobrazí **všetko**, čo osoba aktuálne má požičané, cez všetky jej zápožičky,
- umožní vybrať **ľubovoľnú podmnožinu** kusov na vrátenie (nemusí byť naraz
  všetko z jednej zápožičky),
- vytvorí **jeden konsolidovaný protokol o vrátení**, aj keď vrátené kusy
  pochádzajú z rôznych pôvodných zápožičiek.

Zápožička, ktorej sa vrátila len časť kusov, prejde do stavu **„Čiastočne
vrátená"** — zvyšné kusy ostávajú u osoby, kým sa nevrátia aj tie.

> 💡 Pôvodné tlačidlo **„Vrátiť"** na detaile jednej konkrétnej zápožičky
> (popísané vyššie) ostáva k dispozícii bezo zmeny — je rýchlejšie, keď sa
> vracia **celá jedna** zápožička naraz. „Vrátiť majetok" na detaile osoby je
> doplnková cesta pre prípady s viacerými zápožičkami alebo čiastočným
> vrátením.

## Súvisiace návody

- 🛠️ [Ako si požičať majetok](./poziciat-majetok.md)
- 🛠️ [Ako predĺžiť zápožičku](./predlzit-zapozicku.md)
- 📖 [Scenár: Poškodené zariadenie a postup pri reklamácii](../use-cases/poskodene-zariadenie.md) _(TODO)_
- 📚 [Stavy majetku a zápožičiek](../reference/stavy.md)

---

<sub>Posledná aktualizácia: 2026-07-16 · Cieľová rola: zamestnanec, externý používateľ, správca</sub>
