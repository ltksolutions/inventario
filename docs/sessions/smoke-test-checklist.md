<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Production Smoke Test Checklist

**URL:** https://app.inventario.estate  
**Stav:** Kroky 1-3 OK (Ján, 2026-05-27) · Kroky 4-8 pending (s kolegom)

---

## ✅ Krok 1 — Registrácia nového tenanta

- [x] https://app.inventario.estate/register
- [x] Vyplniť: názov org, email, heslo
- [x] Kliknúť "Vytvoriť účet"
- [x] Prišiel verifikačný email (Ecomail)
- [x] Kliknúť na odkaz v emaili → presmeroval na login

## ✅ Krok 2 — Login

- [x] Prihlás sa emailom + heslom
- [x] Presmeruje na Dashboard (nie loop)
- [x] Vidíš menu: Majetok, Žiadosti, Kategórie, Lokality...

## ✅ Krok 3 — Základná konfigurácia

- [x] **Kategórie** → + Pridať → napr. "IT vybavenie"
- [x] **Lokality** → + Pridať → napr. "Kancelária Bratislava"

## ⏳ Krok 4 — Majetok

- [ ] **Majetok** → + Pridať majetok
- [ ] Vyplniť všetky povinné polia (názov, typ, kategória, lokalita)
- [ ] Uložiť → presmeruje na detail
- [ ] Vidíš hero sekciu (gradient + inventárne číslo) + QR kód + 5 tabov
- [ ] Tab "Detail" zobrazuje správne dáta
- [ ] Tab "Súvisiace" zobrazuje iné položky z tej istej kategórie
- [ ] Kliknúť "Upraviť" → zmeniť názov → Uložiť

## ⏳ Krok 5 — Výpožičky

- [ ] Na detaile majetku → tab "História pohybov" (zatiaľ prázdny)
- [ ] **Žiadosti** → Nová žiadosť → vybrať majetok, dátumy, dôvod
- [ ] Žiadosť je v stave "Čaká na schválenie"
- [ ] Schváliť žiadosť ako ADMIN
- [ ] Prišiel email žiadateľovi "Žiadosť schválená"
- [ ] Stav majetku sa zmenil na "Zapožičané"

## ⏳ Krok 6 — Členovia

- [ ] **Členovia** → vidíš seba ako Admin
- [ ] **Pozvánky** → pozvať kolegu (iný email)
- [ ] Prišiel pozývací email kolegovi
- [ ] Kolega prijal pozvánku → prihlásil sa
- [ ] Vidíš kolegu v zozname členov

## ⏳ Krok 7 — Bezpečnosť

- [ ] **Bezpečnosť** → Aktivovať MFA
- [ ] QR kód sa zobrazí → naskenovať v Google Authenticator
- [ ] Zadať kód → MFA aktivované (nie spinner)
- [ ] Sekcia Passkeys → + Pridať passkey → Touch ID/Face ID
- [ ] Prihlásiť sa cez passkey na novom tabe

## ⏳ Krok 8 — Odhlásenie + opätovné prihlásenie

- [ ] Odhlásiť sa → presmeruje na /login
- [ ] Prihlás sa znova → okamžite funguje (bez redirect loop)
- [ ] Prihlásenie cez passkey funguje
- [ ] Prihlásenie cez email + TOTP kód funguje

---

## Poznámky

- Ecomail: `noreply@inventario.estate` — verifikácia, reset hesla, notifikácie výpožičiek
- Passkeys: `inventario.estate` RP ID, `https://app.inventario.estate` expected origin
- MFA: TOTP + záložné kódy (8 kódov, jednorazové)
