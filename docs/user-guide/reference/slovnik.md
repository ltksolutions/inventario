# Slovník pojmov

Vysvetlenie pojmov, ktoré používame v Inventario. Pojmy sú zoradené **abecedne**.

> 💡 Hľadáš konkrétny stav majetku alebo zápožičky? Pozri [Stavy majetku a zápožičiek](./stavy.md).

---

## A

### Asset (majetok)

Jednotlivá fyzická položka v evidencii — notebook, mobil, projektor, kamera, náradie. Každý kus má **vlastný záznam** so svojím inventárnym číslom, históriou a stavom — aj keď je v sklade 15 rovnakých notebookov, je to 15 nezávislých záznamov.

### Asset Manager (správca majetku)

Rola používateľa, ktorý eviduje majetok, schvaľuje zápožičky a zodpovedá za fyzický sklad. Detaily v [Role a oprávnenia](./role-opravnenia.md).

### Audit log

Nemenný (append-only) záznam všetkých významných akcií v systéme. Hovorí kto, kedy, čo a odkiaľ. Slúži na bezpečnostnú forenziku a GDPR compliance.

---

## E

### Entra ID (Microsoft Entra)

Microsoft Entra ID je cloudová identitná služba (predtým **Azure Active Directory**). Interní zamestnanci sa cez ňu prihlasujú do Inventaria jediným kliknutím (SSO). Externí používatelia majú lokálne účty s e-mailom a heslom.

### Externý používateľ

Používateľ, ktorý **nie je zamestnancom organizácie** — externý spolupracovník, dobrovoľník, hosť. Má lokálny účet (nie Entra ID) a obmedzený rozsah oprávnení.

---

## H

### Hromadná zápožička

Žiadosť o zápožičku, ktorá obsahuje **viacero položiek naraz**, často z rôznych kategórií (napr. prezentačný stánok + 3 notebooky + 5 rádiových staníc). Typický scenár pri viacdňových akciách mimo sídla.

---

## I

### Inventárne číslo

Unikátny identifikátor každého kusu majetku vo formáte `PREFIX-ROK-PORADIE`, napr. `LT-2024-008` (laptop, rok 2024, ôsmy v poradí). Tlačí sa na QR kód a fyzický štítok.

---

## K

### Kategória

Hierarchická klasifikácia majetku — napr. _IT > Notebooky > Pracovné notebooky_. Kategórie určujú, kto môže schvaľovať zápožičky a aké špecifické polia má položka v `specs` (napr. RAM pre IT, veľkosť pre šport).

### Kondícia (Asset Condition)

Subjektívne hodnotenie fyzického stavu položky — `NEW`, `EXCELLENT`, `GOOD`, `FAIR`, `POOR`, `UNUSABLE`. Vyhodnocuje sa pri preberacích protokoloch.

---

## L

### Loan (zápožička)

**Aktívna** zápožička — položka už bola prevzatá a je u používateľa. Vznikne, keď je `LoanRequest` schválený a vykoná sa prevzatie.

### Loan Request (žiadosť o zápožičku)

Požiadavka na zápožičku **pred schválením a prevzatím**. Životný cyklus: `PENDING` → `APPROVED` → vznikne `Loan`.

### Lokalita (Location)

Fyzické miesto, kde sa majetok nachádza — sklad, kancelária, štadión. Môže byť hierarchická (sklad → regál → polica).

---

## P

### Protokol o odovzdaní / vrátení

PDF dokument s logom organizácie generovaný pri prevzatí alebo vrátení zápožičky. Obsahuje zoznam položiek, ich stav a digitálne podpisy oboch strán. **Právne relevantný** — nemení sa po podpise.

---

## Q

### QR kód

Naskenovateľný kód na fyzickom štítku každej položky. Po naskenovaní mobilom otvorí detail položky v aplikácii. Používa sa na rýchle prevzatie a vrátenie.

---

## R

### Rezervácia (`RESERVED`)

Stav položky, ktorá je „blokovaná" žiadosťou, ale ešte **nebola fyzicky odovzdaná**. Po prevzatí sa zmení na `BORROWED`. Pozor: nezamieňať so **zápožičkou**, tá už predpokladá fyzické odovzdanie.

---

## S

### Servis (`IN_SERVICE`)

Stav majetku, ktorý je na oprave alebo údržbe. Položka nie je dostupná na zápožičku, kým sa nevráti zo servisu.

### Soft delete

Pojem z databázového sveta. Keď „vymažeme" záznam (napr. používateľa), v skutočnosti ho **len označíme ako vymazaný** (`deletedAt` timestamp). Fyzicky zostáva v DB, aby audit log a história zápožičiek ostali konzistentné.

### SSO (Single Sign-On)

Spôsob prihlásenia, kde použijete **rovnaké meno a heslo ako pre Outlook, Teams a ostatné firemné aplikácie** (cez Microsoft Entra ID). Nemusíš si pamätať ďalšie heslo.

---

## T

### Team Manager

> ⚠️ **Táto rola už neexistuje.** Zrušená v [ADR-0024](../../decisions/0024-remove-team-manager-role.md)
> (migrácia `2026-05-31-remove-team-manager-role`). Zápožičku pre inú
> osobu dnes vie vytvoriť ktokoľvek s oprávnením na daný majetok — rieši
> to **žiadosť v mene inej osoby** ([ADR-0023](../../decisions/0023-loan-beneficiary-and-direct-loan.md)),
> nie samostatná rola. Heslo je tu len preto, že sa ten pojem ešte
> vyskytuje v starších zápisoch.

---

## U

### User (používateľ)

Osoba s prístupom do systému. Môže byť interná (`Entra ID` účet) alebo externá (`LOCAL` účet).

---

## Z

### Zápožička

Pozri [Loan](#l).

---

## Pre vývojárov

Technické definície entít sú v balíčku [`@inventario/shared-types`](../../../packages/shared-types/) — Zod schémy + TypeScript typy. Dátový model je dokumentovaný v [`docs/architecture/data-model.md`](../../architecture/data-model.md).

---

<sub>Posledná aktualizácia: 2025-01 · Niečo chýba? Pošli pull request.</sub>
