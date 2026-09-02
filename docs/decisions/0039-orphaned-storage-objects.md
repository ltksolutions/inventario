<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0039. Osirelé objekty v úložisku — denný čistič s 24-hodinovým odkladom

|                   |                                                           |
| ----------------- | --------------------------------------------------------- |
| **Status**        | ✅ Accepted                                               |
| **Dátum**         | 2026-09-02                                                |
| **Autori**        | Ján Letko                                                 |
| **Súvisiace ADR** | [ADR-0037](0037-object-storage-bindata-plus-tenant-s3.md) |

## Kontext

Priamy upload prílohy má dva kroky (ADR-0037): prehliadač nahrá súbor
podpísaným PUT-om priamo do private storu, a až `confirm` obsah overí,
strhne EXIF/XMP a založí záznam v evidencii. Keď druhý krok nedobehne —
zavretá karta, stratené pripojenie — v store zostane objekt, na ktorý
neukazuje nič. **Osirelý objekt.**

Nie je to otázka miesta. Osirelý objekt:

- je **mimo evidencie**, takže sa naň nevzťahuje soft-delete ani `del()`
  podľa `docs/compliance/data-retention-schedule.md`,
- **nefiguruje** v žiadnom výpise, exporte ani odpovedi na žiadosť podľa
  čl. 15 / 17 GDPR,
- a keďže `confirm` nedobehol, **drží pôvodné EXIF vrátane GPS**.

Retenčný rozvrh pritom tvrdil, že EXIF sa strháva „už pri uploade" a že
objekt sa maže spolu s metadátami. Pri osirelom objekte nebolo pravdivé
ani jedno — rozvrh sľuboval viac, než systém robil.

Druhý problém: **nebolo sa ako pozrieť.** `ObjectStorage` nemal `list`,
takže obsah storu nevedela vymenovať ani aplikácia. Nedalo sa teda ani
zistiť, koľko osirelých objektov existuje.

## Možnosti

### Možnosť A: Denný cron s odkladom (zvolené)

`list` do abstrakcie, servisný endpoint na výpis, druhý na zmazanie,
denný Vercel cron. Osirelý = objekt pod `attachments/` bez referencie
v evidencii, starší než 24 hodín.

- Plus: zavrie rozpor s retenčným rozvrhom a rieši aj budúce prípady.
- Plus: `list` sa dá použiť aj na inventúru a diagnostiku.
- Mínus: mazacia cesta v produkte. Chyba v nej znamená stratu dát.

### Možnosť B: Jednorazový skript

Raz vymenovať a zmazať ručne.

- Plus: najmenej kódu, žiadna trvalá mazacia cesta.
- Mínus: **nič nerieši.** Osirelé objekty vznikajú z podstaty toku, takže
  za týždeň sú tam nové a rozvrh je znova nepravdivý.

### Možnosť C: Nechať a priznať v dokumentácii

- Plus: nula rizika zmazania.
- Mínus: GPS v osirelej fotke tam zostane natrvalo a rozvrh zostane
  sľubom, ktorý systém neplní.

### Možnosť D: Strhávať EXIF v prehliadači pred PUT-om

- Plus: odstránilo by to problém pri zdroji.
- Mínus: klientovi sa v tomto veriť nedá — stačí upraviť požiadavku a
  metadáta prejdú. Bezpečnostná kontrola na strane klienta nie je kontrola.

## Rozhodnutie

**Zvolená možnosť A**, s parametrami: odklad **24 hodín**, cron **denne**
o 04:00 UTC (hodinu po retenčnom okne).

Odklad 24 hodín je rezerva proti prebiehajúcemu `confirm`, ktorý reálne
beží **sekundy** po PUT-e. Kratší odklad by zisk nepriniesol a riskoval
by zmazanie objektu práve prebiehajúceho uploadu; dlhší by len držal
fotku s GPS v store bez dôvodu.

### Čo drží mazanie na uzde

Toto je mazacia cesta, takže pravidlá sú prísnejšie než u zvyšku kódu:

1. **Referencie sa čítajú naprieč VŠETKÝMI tenantmi.** Store je
   spoločný; keby bol dotaz tenant-scoped, objekty ostatných tenantov by
   sa javili ako osirelé. Toto je najzradnejšia chyba, aká sa tu dá
   spraviť, a stráži ju samostatný test.
2. **Do množiny referencií ide `storagePathname` aj `storageKey`.** Pri
   privátnych prílohách nesú tú istú hodnotu, takže je to nadbytočné — a
   presne preto to tam je. Nadbytočná referencia znamená nezmazaný
   objekt; chýbajúca znamená stratené dáta.
3. **Referencie sa čítajú AŽ PO vymenovaní storu.** V opačnom poradí by
   príloha vzniknutá medzitým nebola v množine a jej objekt by sa
   zmazal. Takto je najhoršie, čo sa stane, nezmazaný objekt.
4. **Pri neúplnom výpise storu sa nemaže nič.** Ak sa vyčerpá strop
   stránok, `purge` vráti `skipped: true`. Mazať na základe polovičného
   obrazu je horšie než nemazať vôbec.
5. **Výpis je oddelený od mazania.** `GET .../orphans` je bezpečný
   kedykoľvek; mazacia cesta má mať dopredu spôsob, ako sa pozrieť, čo by
   zmizlo.

### Objekt soft-zmazanej prílohy je osirelý — zámerne

Za referenciu sa počítajú len prílohy s `deletedAt: null`. Zmazaná
príloha má podľa retenčného rozvrhu mať zmazaný aj objekt, takže čistič
tým **dobehne zlyhané best-effort mazania** z `DELETE /v1/attachments/:id`.
Overené, že obnovenie prílohy neexistuje — žiadny restore endpoint —
takže sa tým nič nestráca.

## Zostatkové riziko

**Okno, v ktorom nahraná fotka drží GPS, sa dá len skrátiť, nie zrušiť.**
Prvý zápis do storu je vždy s pôvodnými metadátami, lebo strhávanie na
strane klienta nie je kontrola (možnosť D). S 24-hodinovým odkladom a
denným cronom je horná hranica **~2 dni**.

Toto nie je vyriešené, len ohraničené. Ak by sa niekedy ukázalo, že to
nestačí, cesta je nahrávať cez funkciu a nie priamo do storu — čím sa
stratí strop 25 MB a vrátime sa na 4 MB (strop Vercelu). To je obchod,
ktorý sa dnes nevypláca.

## Dôsledky

- `ObjectStorage` má `list` a volajúci **musí** dojsť cyklom po `cursor`
  až po `null`. Jedna stránka nie je celý store; pri mazaní je neúplný
  obraz nebezpečnejší než žiadny.
- Prefix `attachments/` má odteraz jednu definíciu
  (`lib/storage/pathnames.ts`). Dve definície tej istej cesty by
  znamenali, že čistič hľadá inde, než upload ukladá.
- `vercel.json` má druhý cron. Endpoint používa `CRON_SECRET`, nie
  `MIGRATIONS_SECRET` — je to cron-driven hygiena, nie deploy krok.
