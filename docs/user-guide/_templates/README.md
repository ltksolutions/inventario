# Templates pre tvorbu dokumentácie

Tento adresár obsahuje **vzorové šablóny** pre 4 typy používateľskej dokumentácie. Vychádzajú z [Diátaxis frameworku](https://diataxis.fr/) – uznávanej metodiky organizácie technickej dokumentácie.

## Štyri typy dokumentov

| Typ              | Účel                | Kedy ho použiť                            |
| ---------------- | ------------------- | ----------------------------------------- |
| **Tutorial**     | Učenie sa           | Onboarding, prvé kroky, "som tu prvýkrát" |
| **How-to Guide** | Riešenie problému   | "Ako urobím X?" – konkrétna úloha         |
| **Use Case**     | Pochopenie kontextu | "Ako to vyzerá od začiatku do konca?"     |
| **Reference**    | Vyhľadanie detailu  | "Aký je presný význam X?"                 |

## Templates

- [`tutorial.template.md`](./tutorial.template.md) – pre Getting Started sekciu
- [`how-to.template.md`](./how-to.template.md) – pre How-To sekciu
- [`use-case.template.md`](./use-case.template.md) – pre Use Cases sekciu
- [`reference.template.md`](./reference.template.md) – pre Reference sekciu

## Ako použiť template

1. Skopíruj template do cieľového adresára:
   ```bash
   cp docs/user-guide/_templates/tutorial.template.md \
      docs/user-guide/getting-started/moj-novy-tutorial.md
   ```
2. Otvor súbor a vyplň všetky `{{ placeholder }}` značky.
3. Odstráň pomocné komentáre `<!-- ... -->`, keď ich už nepotrebuješ.
4. Pridaj link do hlavného `README.md` v `docs/user-guide/`.
5. Pošli pull request.

## Spoločné konvencie

Všetky dokumenty v user-guide dodržujú tieto pravidlá:

### Tón a oslovenie

- **Tykáme** čitateľovi: _„klikneš na tlačidlo Pridať"_ (nie _„kliknite na tlačidlo Pridať"_).
- **Píšeme priamo a stručne.** Žiadne „pre úspešné dokončenie procesu je potrebné...".
- **Predpokladáme priemerného používateľa,** nie programátora.

### Štruktúra

- Každý dokument začína **stručným zhrnutím** v jednej-dvoch vetách – čo sa čitateľ dozvie / čo bude vedieť po jeho prečítaní.
- **Hlavičky H2** sú hlavné kroky alebo sekcie.
- **Hlavičky H3** sú podkroky alebo varianty.
- Na konci pridaj sekciu **„Čo ďalej?"** s linkami na súvisiace dokumenty.

### Screenshoty

- Používame placeholdre v tvare:
  ```markdown
  > 📸 **TODO: insert screenshot** – {{ popis čo má byť na obrázku }}
  ```
- Skutočné screenshoty pridáme po dokončení UI a budeme ich ukladať do `docs/user-guide/_assets/screenshots/`.
- Každý screenshot má **anotácie šípkami a popisom** (napr. „1. Klikni sem, 2. Vyber túto možnosť").
- Pre konzistenciu používame Inventario Blue (`#388fc3`) pre anotácie — viď [`BRAND.md`](../../../BRAND.md). Zámerne farbu produktu, nie tenanta: screenshoty v guide sú spoločné pre všetkých.

### Code bloky a klávesy

- Tlačidlá v UI: **tučné**, napr. _„Klikni na **Požičať**."_
- Klávesové skratky: `` `Ctrl + S` `` alebo `` `Cmd + S` `` (Mac).
- Cesty / URL: `` `/dashboard/assets` ``.
- Vstupné polia: _„Do poľa **E-mail** napíš..."_.

### Linky

- **Interné linky** – relatívne cesty: `[Ako vrátiť majetok](../how-to/vratit-majetok.md)`.
- **Externé linky** – plné URL: `[GitHub Issues](https://github.com/ltksolutions/inventario/issues)`.
- **Linky na konkrétne miesta v aplikácii** – pseudo-cesty: _„Choď na **Menu → Môj majetok → Aktívne zápožičky**."_

### Príklady kódu

V používateľskej príručke kód v zásade **nepoužívame**. Ak potrebuješ ukázať API call alebo skript, odkáž na `docs/api/` alebo `docs/architecture/`.

### Jazyk

- **Slovenský jazyk.** Anglické technické pojmy (asset, dashboard) prekladáme, kde to dáva zmysel (majetok, prehľad), inak ponechávame v origináli a vysvetlíme v [Slovníku pojmov](../reference/slovnik.md).
- Diakritika je povinná. „Pozicit majetok" → ❌. „Požičať majetok" → ✅.

## Kontrola pred odoslaním

Pred publikovaním dokumentu si over:

- [ ] Tykanie a priame oslovenie
- [ ] Žiadne pravopisné chyby (`aspell -l sk` alebo Grammarly)
- [ ] Všetky linky fungujú (relatívne aj externé)
- [ ] Screenshot placeholdre majú jasný popis
- [ ] Sekcia „Čo ďalej?" obsahuje aspoň 2 relevantné odkazy
- [ ] Dokument je prepojený z hlavného `README.md`
