<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Ako vyskúšať tlač QR štítkov na Zebra tlačiarni (Browser Print + ZPL)

Technický test ADR-0027 (Zebra ZPL vetva) na reálnom hardvéri — pre teba, nie pre koncového používateľa.

**Stav pred týmto testom:** kód (backend renderer, endpointy, frontend tlačidlá) je hotový a nasadený od 2026-06-02. Chýbajúci write path pre `labelPrinting.mode` bol doplnený 2026-07-14 (commit `480586c`) a odtedy má appka aj bežný UI prepínač v Nastaveniach organizácie (commit `9261a99`) — žiadny Swagger už nie je potrebný, prepnutie módu popisuje krok 3 nižšie. Táto vec je teraz vyriešená, zvyšok tohto návodu je **prvý reálny test na hardvéri**, ktorý ešte nikdy neprebehol.

---

## Predpoklady

- PC (Windows alebo Mac) v **rovnakej sieti** ako Zebra ZD420, alebo tlačiareň pripojená priamo cez USB k tomuto PC.
- Admin práva na PC — treba nainštalovať Browser Print agenta.
- Prihlásenie do Inventario appky ako **ADMIN** v tenante SFZ (na prepnutie `labelPrinting.mode` a na testovaciu tlač).
- Chrome alebo Edge (odporúčané prehliadače pre Browser Print — Firefox mal historicky problémy).

---

## 1. Inštalácia Zebra Browser Print

1. Stiahni agenta zo stránky Zebry: [Browser Print](https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html) (vyber verziu pre svoj OS).
2. Nainštaluj a spusti. Agent beží na pozadí (ikonka v systémovej lište) a vystavuje lokálne API na `http://localhost:9100`.
3. Over, že agent naozaj beží — otvor v prehliadači:

   ```
   http://localhost:9100/available.json
   ```

   Mal by vrátiť JSON so zoznamom dostupných tlačiarní. Ak sa stránka nenačíta / spojenie odmietnuté, agent nebeží — skontroluj, či sa spustil (reštart, prípadne ručne z Start menu / Applications).

## 2. Pripojenie ZD420

- **USB:** zapoj tlačiareň do PC. Windows/macOS by mal automaticky nainštalovať Zebra driver (ak nie, stiahni ho tiež zo stránky Zebry). Browser Print agent USB tlačiareň zvyčajne nájde automaticky.
- **LAN:** tlačiareň musí mať nastavenú IP adresu vo firemnej sieti (konfigurácia siete na tlačiarni je mimo rozsahu tohto návodu — cez Zebra display/menu alebo Zebra Setup Utility). Agent ju nájde cez sieťové vyhľadávanie.

Po pripojení znova skontroluj `http://localhost:9100/available.json` — ZD420 by sa mala objaviť v zozname (`name` pole obsahuje niečo ako "ZD420" alebo výrobné číslo).

## 3. Prepnutie organizácie na ZEBRA_ZPL mód

1. Prihlás sa do appky (`app.inventario.estate`) ako **ADMIN** a otvor **Nastavenia → Organizácia** (`/settings/organisation`).
2. Na desktope klikni na záložku **„QR kódy a štítky"** (na mobile je táto sekcia rovno pod sebou, bez záložiek).
3. Zapni prepínač **„Tlačiť štítky na Zebra termálnej tlačiarni (ZPL)"**. Objaví sa štruktúrované nastavenie:
   - **Šírka štítka (mm)** — default 50, uprav podľa svojich štítkov.
   - **Výška štítka (mm)** — default 25.
   - **Rozlíšenie tlačovej hlavy (DPI)** — ZD420 = 203 dpi (default).
   - **Sýtosť tlače** — 0–30, default 20.
4. Klikni **„Uložiť zmeny"** dole na stránke (spoločné tlačidlo pre celý formulár, nezávislé od aktívnej záložky). Zobrazí sa potvrdenie „Zmeny boli uložené.".
5. Obnov stránku s majetkom (`app.inventario.estate`) — na detaile majetku (a pri dávkovej tlači zo zoznamu) by sa teraz malo objaviť tlačidlo **„Tlačiť na Zebra"** vedľa **„Tlačiť štítok (PDF)"**.

> Pokročilé/diagnostika: rovnaké pole sa dá nastaviť aj priamo cez `PATCH /v1/organisations/current` v Swagger UI (`https://api.inventario.estate/docs`) — pole `labelPrinting` s tvarom `{ mode, pdfPreset, zplLabelWidthMm, zplLabelHeightMm, zplDpi, zplDarkness, finderText }`. Toto už ale bežne netreba, UI prepínač robí presne to isté.

## 4. Testovacia tlač

1. Otvor ktorýkoľvek majetok → **Identifikácia** blok / hlavička → **Tlačiť na Zebra**.
2. Appka pošle ZPL na `localhost:9100` agentovi, ktorý ho doručí na ZD420. Do ~2 sekúnd by mala vypadnúť tlač zo ZD420.
3. Ak agent neodpovie do 2s, appka automaticky spadne na PDF fallback (uvidíš OS tlačový dialóg namiesto priamej tlače) — to je zámerné správanie, nie bug.
4. Vyskúšaj aj dávkovú tlač zo zoznamu majetku (vyber viac položiek → **Tlačiť na Zebra** v hornej lište).

## 5. Čo skontrolovať na vytlačenom štítku

Toto je jadro testu — presne tie riziká, ktoré ADR-0027 označil ako neoverené:

- [ ] **QR kód sa dá naskenovať mobilom** (skús Google Lens aj natívny fotoaparát) — z normálnej vzdialenosti aj z bližšie. Ak sa nezosníma, modul je pri 203 dpi príliš malý — treba zväčšiť šírku/výšku štítka v Nastaveniach (krok 3).
- [ ] **Slovenská diakritika** (ľ, š, č, ť, ž, á, ý) v inventárnom čísle/názve majetku je čitateľná, nie skomolená alebo prázdna. Toto testuje `^CI28` (UTF-8) v ZPL builderi.
- [ ] **Text sa nezrezáva** ani nepretiahne mimo štítka pri dlhších názvoch majetku.
- [ ] Ak má SFZ nastavené logo v brandingu — je viditeľné v strede QR a QR sa **aj tak** dá skenovať (logo max. 22 % plochy).
- [ ] Sýtosť tlače je vyhovujúca — ani príliš svetlá (nezosnímateľná), ani rozmazaná od príliš tmavej.

## 6. Po teste

- Ak niečo z checklistu zlyhalo, napíš mi presne čo (foto štítka pomôže) — doladíme šírku/výšku/DPI/sýtosť v Nastaveniach, žiadny kód sa meniť nemusí.
- Ak chceš appku vrátiť do PDF režimu (napr. kým sa nedoladí), vypni prepínač v kroku 3 a znova ulož.

---

## Možné problémy

**`http://localhost:9100/available.json` neodpovedá**
Agent nebeží. Skontroluj systémovú lištu / Task Manager, prípadne pretiahni znova z inštalátora.

**Tlačiareň sa neobjaví v `available.json`**
USB: skontroluj driver a kábel. LAN: over IP adresu tlačiarne a že je v rovnakej sieti/VLAN ako PC s agentom.

**Appka stále ponúka len PDF tlačidlo**
Skontroluj v Nastaveniach organizácie (záložka „QR kódy a štítky"), či je prepínač „Tlačiť štítky na Zebra termálnej tlačiarni (ZPL)" zapnutý a či si po zapnutí klikol „Uložiť zmeny". Ak si si istý, že je uložené, over aj priamo `GET /v1/organisations/current` cez Swagger — `labelPrinting.mode` musí byť `"ZEBRA_ZPL"`.

**Tlač vypadne, ale je prázdna / len čiary**
Zlá kalibrácia tlačiarne (senzor médií) alebo nesprávny typ štítkov (gap vs. continuous). Toto je hardvérová vec na strane ZD420, nie appky — skús kalibráciu priamo na tlačiarni (feed button held / Zebra Setup Utility).

---

<sub>Súvisí: [ADR-0027 — Tlač QR štítkov](../../decisions/0027-qr-label-printing.md), [Ako vytlačiť QR kódy](./vytlacit-qr-kody.md) _(TODO — všeobecný návod pre PDF/koncového používateľa, tento je len pre technický Zebra test)_</sub>
