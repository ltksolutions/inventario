<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Ako vyskúšať tlač QR štítkov na Zebra tlačiarni (Browser Print + ZPL)

Technický test ADR-0027 (Zebra ZPL vetva) na reálnom hardvéri — pre teba, nie pre koncového používateľa. Predpokladá, že poznáš appku a vieš sa pohybovať v Swagger UI / curl.

**Stav pred týmto testom:** kód (backend renderer, endpointy, frontend tlačidlá) je hotový a nasadený od 2026-06-02. Chýbajúci write path pre `labelPrinting.mode` bol doplnený a nasadený 2026-07-14 (commit `480586c`) — bez toho by appka vždy defaultovala na PDF, nech by si na tlačiarni robil čokoľvek. Táto vec je teraz vyriešená, zvyšok tohto návodu je **prvý reálny test na hardvéri**, ktorý ešte nikdy neprebehol.

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

Appka dnes **nemá UI prepínač** pre toto nastavenie (len API pole) — nastavuje sa cez Swagger UI.

1. V tom istom prehliadači, kde si prihlásený do `app.inventario.estate` ako ADMIN, otvor novú záložku: `https://api.inventario.estate/docs`.
2. Nájdi `PATCH /v1/organisations/current` a rozbaľ ho, klikni **Try it out**.
3. Do tela requestu vlož (uprav rozmery, ak vaše štítky nie sú 50×25 mm):

   ```json
   {
     "labelPrinting": {
       "mode": "ZEBRA_ZPL",
       "pdfPreset": "avery-l7160",
       "zplLabelWidthMm": 50,
       "zplLabelHeightMm": 25,
       "zplDpi": 203,
       "zplDarkness": 20,
       "finderText": {
         "enabled": false,
         "text": "Našli ste ma? Naskenujte a pomôžte ma vrátiť."
       }
     }
   }
   ```

4. **Execute.** Response 200 s `labelPrinting.mode: "ZEBRA_ZPL"` = úspech. Swagger by mal poslať autentifikačný cookie automaticky (rovnaká domain `inventario.estate`, prihlásený v appke) — ak dostaneš 401, over v DevTools (F12 → Application → Cookies), či `inv_access` cookie existuje pre `.inventario.estate`, prípadne sa v appke znova prihlás a skús znova.
5. Obnov appku (`app.inventario.estate`) — na detaile majetku by sa teraz malo objaviť tlačidlo **„Tlačiť na Zebra"** namiesto/vedľa PDF tlače.

## 4. Testovacia tlač

1. Otvor ktorýkoľvek majetok → **Identifikácia** blok / hlavička → **Tlačiť na Zebra**.
2. Appka pošle ZPL na `localhost:9100` agentovi, ktorý ho doručí na ZD420. Do ~2 sekúnd by mala vypadnúť tlač zo ZD420.
3. Ak agent neodpovie do 2s, appka automaticky spadne na PDF fallback (uvidíš OS tlačový dialóg namiesto priamej tlače) — to je zámerné správanie, nie bug.
4. Vyskúšaj aj dávkovú tlač zo zoznamu majetku (vyber viac položiek → **Tlačiť na Zebra** v hornej lište).

## 5. Čo skontrolovať na vytlačenom štítku

Toto je jadro testu — presne tie riziká, ktoré ADR-0027 označil ako neoverené:

- [ ] **QR kód sa dá naskenovať mobilom** (skús Google Lens aj natívny fotoaparát) — z normálnej vzdialenosti aj z bližšie. Ak sa nezosníma, modul je pri 203 dpi príliš malý — treba zväčšiť `zplLabelWidthMm`/`zplLabelHeightMm` v configu z kroku 3.
- [ ] **Slovenská diakritika** (ľ, š, č, ť, ž, á, ý) v inventárnom čísle/názve majetku je čitateľná, nie skomolená alebo prázdna. Toto testuje `^CI28` (UTF-8) v ZPL builderi.
- [ ] **Text sa nezrezáva** ani nepretiahne mimo štítka pri dlhších názvoch majetku.
- [ ] Ak má SFZ nastavené logo v brandingu — je viditeľné v strede QR a QR sa **aj tak** dá skenovať (logo max. 22 % plochy).
- [ ] Sýtosť tlače (`zplDarkness`) je vyhovujúca — ani príliš svetlá (nezosnímateľná), ani rozmazaná od príliš tmavej.

## 6. Po teste

- Ak niečo z checklistu zlyhalo, napíš mi presne čo (foto štítka pomôže) — doladíme `zplLabelWidthMm`/`zplDpi`/`zplDarkness` v configu, žiadny kód sa meniť nemusí.
- Ak chceš appku vrátiť do PDF režimu (napr. kým sa nedoladí), zopakuj krok 3 s `"mode": "PDF_SHEET"` alebo `"labelPrinting": null`.
- Až po úspešnom teste dáva zmysel riešiť UI prepínač v Nastaveniach (dnes sa to robí len cez Swagger) — to je samostatná menšia úloha, ak budeš chcieť.

---

## Možné problémy

**`http://localhost:9100/available.json` neodpovedá**
Agent nebeží. Skontroluj systémovú lištu / Task Manager, prípadne pretiahni znova z inštalátora.

**Tlačiareň sa neobjaví v `available.json`**
USB: skontroluj driver a kábel. LAN: over IP adresu tlačiarne a že je v rovnakej sieti/VLAN ako PC s agentom.

**PATCH vracia 401**
Nie je poslaný auth cookie. Over v DevTools, či `inv_access` cookie existuje pre doménu `.inventario.estate` (nie len `app.inventario.estate`). Ak nie, over CORS/cookie konfiguráciu — toto by nemal byť bežný prípad, keby sa objavil, napíš mi.

**Appka stále ponúka len PDF tlačidlo**
Skontroluj `GET /v1/organisations/current` cez Swagger — `labelPrinting.mode` musí byť `"ZEBRA_ZPL"`. Ak je `null` alebo `"PDF_SHEET"`, krok 3 sa neuložil.

**Tlač vypadne, ale je prázdna / len čiary**
Zlá kalibrácia tlačiarne (senzor médií) alebo nesprávny typ štítkov (gap vs. continuous). Toto je hardvérová vec na strane ZD420, nie appky — skús kalibráciu priamo na tlačiarni (feed button held / Zebra Setup Utility).

---

<sub>Súvisí: [ADR-0027 — Tlač QR štítkov](../../decisions/0027-qr-label-printing.md), [Ako vytlačiť QR kódy](./vytlacit-qr-kody.md) _(TODO — všeobecný návod pre PDF/koncového používateľa, tento je len pre technický Zebra test)_</sub>
