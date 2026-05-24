<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Ako používať passkey v Inventario

Passkey vám umožňuje prihlásiť sa rýchlo a bezpečne pomocou biometrie (Touch ID, Face ID) alebo PIN kódu — bez zadávania hesla.

---

## Čo je passkey?

Passkey je kryptografický kľúč uložený priamo vo vašom zariadení (MacBook, iPhone, Windows PC). Na prihlásenie sa overíte odtlačkom prsta alebo tvárou — rovnako ako pri odomykaní telefónu.

Passkey je **phishing-resistant** — ani keby ste omylom klikli na falošnú login stránku, váš passkey tam nefunguje.

---

## Pridanie passkey

1. Prihláste sa do Inventario (emailom alebo SSO).
2. Prejdite do **Nastavenia → Bezpečnosť**.
3. V sekcii **Passkey** kliknite **+ Pridať passkey**.
4. Váš prehliadač/OS zobrazí výzvu — potvrďte biometriou alebo PIN kódom.
5. Hotovo. Passkey je uložený a od teraz ho môžete použiť na prihlásenie.

> Ak máte iCloud Keychain alebo Google Password Manager, passkey sa automaticky synchronizuje na vaše ostatné zariadenia.

---

## Prihlásenie cez passkey

1. Otvorte prihlasovaciu stránku Inventario.
2. Kliknite **Prihlásiť sa cez passkey**.
3. Vyberte passkey zo zoznamu (alebo nechajte prehliadač navrhnúť autofill).
4. Potvrďte biometriou alebo PIN kódom.

Alternativne — ak váš prehliadač podporuje autofill passkeys, zobrazí sa návrh priamo pri kliknutí do poľa Email.

---

## Správa passkey-ov

V sekcii **Nastavenia → Bezpečnosť → Passkey** vidíte všetky vaše passkey-y s informáciami:

- Názov zariadenia (napr. "MacBook Air", "iPhone 15 Pro")
- Dátum pridania
- Posledné použitie
- Či je passkey synchronizovaný (☁️ Synced)

**Premenovanie:** Kliknite "Premenovať" vedľa passkey-u a zadajte nový názov.

**Odstránenie:** Kliknite ikonu koša. Ak odstránite posledný passkey, prihlasujete sa naďalej heslom alebo SSO.

---

## Passkey-y naprieč organizáciami

Váš passkey funguje vo **všetkých organizáciách** kde ste členom. Po prihlásení cez passkey sa automaticky otvorí vaša predvolená organizácia; medzi organizáciami prepínate cez tenant switcher v AppShell.

---

## Riešenie problémov

| Problém                                    | Riešenie                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| "Registrácia bola zrušená"                 | Kliknite znova na "+ Pridať passkey" a potvrďte biometriou.                                  |
| "Tento authenticator je už zaregistrovaný" | Passkey pre toto zariadenie už existuje. Skontrolujte zoznam passkey-ov.                     |
| Passkey sa nezobrazuje v autofill          | Prehliadač musí podporovať Conditional UI (Chrome ≥108, Safari ≥16, Edge ≥108).              |
| Stratené zariadenie                        | Prihláste sa heslom/SSO → Nastavenia → Bezpečnosť → odstráňte passkey strateného zariadenia. |
| Passkey nefunguje po zmene domény          | Passkey je viazaný na doménu `inventario.estate`. Kontaktujte správcu.                       |
