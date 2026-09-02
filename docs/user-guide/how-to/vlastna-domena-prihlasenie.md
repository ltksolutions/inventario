<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Ako nastaviť vlastnú doménu pre prihlásenie

Pre ADMIN organizácie, ktorá chce, aby sa jej členovia prihlasovali cez
vlastnú doménu (napr. `majetok.firma.sk`) namiesto `app.inventario.estate`.
Vlastná doména zobrazí vaše logo, farby a **len tie spôsoby prihlásenia**,
ktoré máte povolené v sekcii „Spôsoby prihlásenia" na tej istej stránke —
appka samotná sa pod vlastnou doménou nikdy nevykreslí, len prihlasovacia
obrazovka (po prihlásení vás appka presmeruje na `app.inventario.estate`).

---

## Predpoklady

- Rola **ADMIN** v organizácii.
- Prístup k správe DNS vašej domény (alebo IT/hosting partner, ktorý ho má).
- **Pridanie domény do nášho Vercel projektu je jednorazový krok na našej
  strane** (platform operátor) — nie je plne self-service. Napíšte na
  [support@inventario.estate](mailto:support@inventario.estate) s tým, akú
  doménu chcete použiť, ešte predtým, než nastavíte DNS (krok 3 nižšie).

---

## 1. Zapísanie domény v appke

1. Prihlás sa ako ADMIN a otvor **Nastavenia → Prihlasovanie a domény**
   (`/settings/auth`).
2. V sekcii **„Vlastná doména pre prihlásenie"** zadaj hostname bez
   `https://` a bez cesty — napr. `majetok.firma.sk`.
3. Klikni **„Uložiť zmeny"**. Indikátor pri nadpise sekcie sa zmení z
   „Nenastavená" na „Nastavená" — to len potvrdzuje uloženie v appke,
   doména ešte nemusí byť reálne funkčná (pozri kroky 2–3 nižšie).

## 2. Aktivácia domény na našej strane

Napíš na support@inventario.estate (ak si to neurobil/a už pred krokom 1)
s presným názvom domény. My doménu pridáme do Vercel projektu a pošleme
ti presnú hodnotu CNAME záznamu, ktorý treba nastaviť.

## 3. Nastavenie DNS

U svojho DNS providera (alebo cez IT/hosting partnera) vytvor **CNAME**
záznam pre danú doménu smerujúci na hodnotu, ktorú dostaneš od nás v
kroku 2. Bez tohto záznamu doména nebude fungovať, aj keby bola uložená v
appke (krok 1).

Propagácia DNS zvyčajne trvá pár minút, výjimočne aj niekoľko hodín
(závisí od TTL u vášho providera).

## 4. Overenie

Otvor `https://<vaša-doména>` v prehliadači (Chrome/Edge odporúčané —
pozri poznámku o Safari nižšie). Mala by sa zobraziť prihlasovacia
obrazovka s vaším logom/farbami a len povolenými spôsobmi prihlásenia z
kroku „Spôsoby prihlásenia" na tejto istej stránke `/settings/auth`.

---

## Možné problémy

**Doména vráti 404 alebo sa nenačíta**
DNS ešte nepropagoval, alebo doména ešte nebola pridaná do Vercel
projektu (krok 2) — over, či si nám napísal/a a či DNS CNAME záznam
existuje (napr. cez `dig CNAME <vaša-doména>` alebo online DNS checker).

**Pri ukladaní v kroku 1 sa zobrazí „Custom doména musí byť platné
FQDN..."**
Formát je nesprávny — zadaj len samotný hostname, bez `https://`, bez
cesty za lomkou, malými písmenami (appka ho aj tak automaticky prevedie
na malé písmená).

**„Vlastná doména ... je už používaná iným tenantom"**
Túto doménu už má nastavenú iná organizácia v systéme — over si presný
názov, alebo nás kontaktuj, ak si myslíš, že ide o omyl.

**Po prihlásení ma appka presmerovala na `app.inventario.estate`, nie na
moju doménu**
To je zámer, nie chyba — appka samotná (majetok, výpožičky, nastavenia…)
sa vždy vykresľuje len na `app.inventario.estate`. Vlastná doména slúži
**len** na prihlasovaciu obrazovku.

**Zobrazujú sa mi iné/viac spôsobov prihlásenia, než mám povolené**
Skontroluj, či si klikol/a „Uložiť zmeny" po úprave sekcie „Spôsoby
prihlásenia" nižšie na tej istej stránke. Ak áno a problém trvá, napíš
nám — priraď screenshot.

---

<sub>Súvisí: [ADR-0035 — Vlastná doména organizácie pre prihlásenie](../../decisions/0035-tenant-custom-domain-login.md)</sub>
