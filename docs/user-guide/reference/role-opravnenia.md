<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Role a oprávnenia

Tento dokument je **úplná referencia toho, kto môže čo** v Inventariu. Použi ho, keď
nevieš, akú rolu používateľ potrebuje na danú akciu, alebo prečo dostáva chybu
„nemáte oprávnenie" (HTTP 403).

Zdroj pravdy je kód: roly v
[`packages/shared-types/src/enums/user-role.ts`](../../../packages/shared-types/src/enums/user-role.ts)
a ich vynucovanie cez `requireRole` / `requireMinRole` v
[`apps/api/src/plugins/auth.ts`](../../../apps/api/src/plugins/auth.ts). Model rolí
definuje [ADR-0029](../../decisions/0029-single-hierarchical-role.md).

## Štyri role

| Rola            | Úroveň | Pre koho                            | Stručne                                                                  |
| --------------- | :----: | ----------------------------------- | ------------------------------------------------------------------------ |
| `EMPLOYEE`      |   1    | Interný zamestnanec                 | Požičiava si (pre seba aj v mene inej osoby), vidí vlastné výpožičky     |
| `EXTERNAL`      |   1    | Externý spolupracovník, dobrovoľník | Rovnaká úroveň ako EMPLOYEE, len iný **typ** vzťahu k organizácii        |
| `ASSET_MANAGER` |   2    | Správca majetku                     | Eviduje majetok, schvaľuje a vydáva výpožičky, tlačí QR, rieši protokoly |
| `ADMIN`         |   3    | Administrátor                       | Plný prístup — používatelia, role, nastavenia, mazanie                   |

> 💡 Rola je **per-membership jedna hodnota** (nie pole). Ten istý človek môže mať
> v rôznych organizáciách rôzne role.

### Hierarchia

Role tvoria lineárnu hierarchiu úrovní prístupu — vyššia rola **dedí** oprávnenia
nižších:

```
ADMIN (3)  ⊃  ASSET_MANAGER (2)  ⊃  EMPLOYEE / EXTERNAL (1)
```

Kontrola „má používateľ aspoň túto úroveň?" sa robí cez `roleSatisfies(actual, required)`:

- `roleSatisfies('ADMIN', 'ASSET_MANAGER')` → ✅ (ADMIN je vyššie)
- `roleSatisfies('EMPLOYEE', 'ASSET_MANAGER')` → ❌ (EMPLOYEE je nižšie)
- `roleSatisfies('EXTERNAL', 'EMPLOYEE')` → ✅ (rovnaká úroveň)

### EMPLOYEE vs EXTERNAL

`EMPLOYEE` a `EXTERNAL` majú **zámerne rovnakú úroveň prístupu** — z hľadiska
oprávnení sú rovnocenné. Líšia sa len **typom vzťahu** k organizácii (interný
zamestnanec vs externý spolupracovník). Na rozlíšenie typu treba porovnať priamo
`role === 'EXTERNAL'`, nie cez úroveň. Dnes žiadna funkcia nedáva EXTERNAL menej
ani viac než EMPLOYEE; rozlíšenie slúži na evidenciu a budúce politiky.

## Matica oprávnení

Minimálna rola potrebná pre danú operáciu. „Všetci" = EMPLOYEE, EXTERNAL,
ASSET_MANAGER aj ADMIN.

| Oblasť                                     | Čítanie / zoznam                                 | Vytvorenie / úprava | Mazanie / správa |
| ------------------------------------------ | ------------------------------------------------ | ------------------- | ---------------- |
| **Majetok** (assets)                       | Všetci                                           | ASSET_MANAGER       | ADMIN            |
| **Sklad** (stock pohyby)                   | Všetci                                           | ASSET_MANAGER       | ADMIN            |
| **Kategórie**                              | Všetci                                           | ASSET_MANAGER       | ADMIN            |
| **Lokality**                               | Všetci                                           | ASSET_MANAGER       | ADMIN            |
| **Stavy majetku** (conditions)             | Všetci                                           | ASSET_MANAGER       | ADMIN            |
| **Prílohy** (attachments)                  | Všetci                                           | ASSET_MANAGER       | ASSET_MANAGER    |
| **QR štítky** (tlač)                       | Všetci                                           | —                   | —                |
| **Výpožičky** (loans)                      | Všetci¹                                          | ASSET_MANAGER²      | ASSET_MANAGER    |
| **Žiadosti o výpožičku**                   | Všetci¹                                          | Všetci (žiadosť)³   | autor / ADMIN⁴   |
| **Preberacie protokoly**                   | Všetci                                           | ASSET_MANAGER       | ASSET_MANAGER    |
| **Zoznam členov** (`/members`)             | Všetci                                           | —                   | —                |
| **Členstvá** (role, správa)                | ADMIN                                            | ADMIN               | ADMIN            |
| **Pozvánky**                               | ASSET_MANAGER                                    | ASSET_MANAGER       | ASSET_MANAGER    |
| **Používatelia** (zoznam, detail, úprava)⁶ | ASSET_MANAGER / ADMIN                            | ADMIN               | ADMIN            |
| **Nastavenia organizácie**⁵                | Všetci (čítanie)                                 | ADMIN               | ADMIN            |
| **Audit log**                              | automatický zápis — needitovateľný (GDPR čl. 30) | —                   | —                |

¹ Viditeľnosť výpožičiek závisí od role — viď [Výpožičky: kto čo vidí](#výpožičky-kto-čo-vidí).
² Schválenie, vydanie priamej výpožičky, vrátenie a označenie za stratené robí ASSET_MANAGER alebo ADMIN.
³ Žiadosť o výpožičku môže podať ktokoľvek (pre seba aj v mene inej osoby — viď nižšie).
⁴ Žiadosť môže zrušiť len jej **autor** alebo **ADMIN**.
⁵ Vrátane brandingu (logo, farby, font) a nastavení prihlasovania/domén — všetko len ADMIN.
⁶ Do 2026-07-14 samostatná stránka „Osoby" (len ASSET_MANAGER). Zlúčené do jednej stránky
„Používatelia", ktorá od 2026-07-14 (detail+editácia používateľa) ponuka dva samostatné
vstupné body zo zoznamu:

- **Detail používateľa** (klik na meno) — ASSET_MANAGER aj ADMIN. Read-only: meno,
  priezvisko, email v hlavičke + zoznam všetkého vypožičaného majetku (aktuálny aj
  minulý) s danými dátumami a preklikom na detail daného majetku.
- **Editačný dialóg** (ikona ceruzky) — **len ADMIN**. Zmena mena, priezviska, emailu
  (len pri `LOCAL` účte — pozri „Typy účtov" nižšie), roly, aktívny účet, odobratie
  z organizácie. Neobsahuje výpožičky — na to slúži detail.

## Výpožičky: kto čo vidí

- **ASSET_MANAGER a ADMIN** vidia **všetky** výpožičky v organizácii a môžu ich
  filtrovať podľa majetku či vypožičiavateľa.
- **EMPLOYEE a EXTERNAL** vidia v „Moje výpožičky" len výpožičky, kde sú
  **vypožičiavateľom** (borrower). Cudzie výpožičky nevidia.

### Žiadosť v mene inej osoby

Žiadosť o výpožičku má **žiadateľa** (kto ju podal) a **beneficiára** (pre koho je).
Ak beneficiár nie je sám žiadateľ, musí to byť **aktívny člen** organizácie — systém
to overí. Vďaka tomu môže napr. asistent požiadať o výpožičku pre svojho vedúceho.

### Životný cyklus akcií

| Akcia                        | Kto smie                                 |
| ---------------------------- | ---------------------------------------- |
| Podať žiadosť                | Všetci (pre seba / aktívneho člena)      |
| Zrušiť vlastnú žiadosť       | Autor žiadosti alebo ADMIN               |
| Schváliť / zamietnuť žiadosť | ASSET_MANAGER, ADMIN                     |
| Vydať priamu výpožičku       | ASSET_MANAGER, ADMIN                     |
| Vrátiť výpožičku             | ASSET_MANAGER, ADMIN                     |
| Označiť za stratené          | ASSET_MANAGER, ADMIN                     |
| Podpísať preberací protokol  | Obe strany (odovzdávajúci + preberajúci) |

## Typy účtov (autentifikácia)

Rola hovorí **čo používateľ smie**; typ účtu hovorí **ako sa prihlasuje**. Sú to
nezávislé veci.

| Typ účtu   | Prihlásenie                                      |
| ---------- | ------------------------------------------------ |
| `ENTRA_ID` | Microsoft Entra ID (SSO) — typicky interní ľudia |
| `LOCAL`    | E-mail + heslo (prípadne Google/Apple) — externí |

> Povolené spôsoby prihlásenia a politiku domén nastavuje ADMIN v
> **Nastavenia → Prihlasovanie a domény** (viď [ADR-0030](../../decisions/0030-registration-providers-and-entra-domain.md)).

> 💡 **Zmena emailu (ADMIN editácia používateľa, od 2026-07-14):** ADMIN môže priamo
> prepísať email len pri `LOCAL` účtoch. Pri `ENTRA_ID` (OAuth) účtoch je email v
> správe providera (Microsoft/Google) a systém zmenu odmietne — používateľ si
> musí zmeniť adresu priamo u providera.

---

<sub>Posledná aktualizácia: 2026-07-14 · Zdroj pravdy: `user-role.ts` + `auth.ts` (ADR-0029).
Pri zmene RBAC v kóde aktualizuj aj túto referenciu.</sub>
