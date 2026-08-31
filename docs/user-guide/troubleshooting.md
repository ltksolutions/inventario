# Troubleshooting

Ak niečo nefunguje, najprv skontroluj túto stránku. Riešenia sú zoradené **od najčastejších**.

---

## Problémy s prihlásením

### „Prístup zamietnutý" pri prihlasovaní cez SFZ účet

Tvoj účet ešte pravdepodobne **nie je aktivovaný** v Asset Managemente. Riešenie:

1. Kontaktuj svojho **IT správcu** alebo HR
2. Over si, či si v Active Directory v správnej skupine (`SFZ Employees`)
3. Synchronizácia z Entra ID prebieha **každú hodinu** — počkaj a skús znova

### „Tvoj účet bol deaktivovaný"

Buď si:

- Odišiel zo SFZ a tvoj účet bol automaticky deaktivovaný
- Bol zamknutý kvôli bezpečnostnému incidentu (napr. opakované zlé prihlásenie)

Kontaktuj `support@futbalsfz.sk` _(TODO: overiť)_ alebo svojho manažéra.

### Stránka sa po prihlásení nenačíta

Vyskúšaj v tomto poradí:

1. **Tvrdé obnovenie** — `Ctrl + Shift + R` (Windows) / `Cmd + Shift + R` (Mac)
2. **Vymaž cookies a cache** pre `assets.futbalsfz.sk`
3. **Vyskúšaj iný prehliadač** — pre overenie, či je problém v lokálnych dátach
4. **Vyskúšaj inkognito** — vylúči problémy s rozšíreniami

Ak problém pretrváva, otvor konzolu (`F12` → `Console`) a urob screenshot chybového hlásenia.

---

## Problémy so žiadosťami

### Žiadosť sa nedá odoslať — „Konflikt s inou rezerváciou"

Iný používateľ si rezervoval rovnakú položku na prekrývajúce sa obdobie. Riešenia:

- **Vyber inú konkrétnu položku** — väčšinou je v sklade viac kusov
- **Uprav termín** tak, aby sa neprekrýval s inou rezerváciou
- **Kontaktuj druhého žiadateľa** (vidíš jeho meno) — možno vie ustúpiť

### Žiadosť ostáva v „Čaká na schválenie" dlhšie ako 24 hodín

1. Skontroluj, či **schvaľovateľ** je dostupný (môže byť na dovolenke)
2. Použi tlačidlo **Pripomenúť schvaľovateľovi** v detaile žiadosti
3. Pre **urgentné prípady** kontaktuj zástupcu schvaľovateľa alebo administrátora

### „Nemáš oprávnenie na túto kategóriu"

Tvoja rola neumožňuje požičiavanie tejto kategórie. Riešenia:

- **Štandardné položky** (kancelárske vybavenie, IT) — kontaktuj svojho manažéra
- **Špecializované** (kamery, drahá technika) — pravdepodobne treba špeciálne schválenie
- Vidíš to **dočasne** — ak ti niekto dočasne udelil prístup, môže expirovať

---

## Problémy s prevzatím / vrátením

### QR kód sa nedá naskenovať

- **Kód je poškodený** — kontaktuj správcu, vytlačí nový
- **Mobil nemá fokus** — chyť ho do správnej vzdialenosti (15–20 cm)
- **Slabé osvetlenie** — zapni baterku v telefóne

> 💡 **Alternatíva:** V mobilnej aplikácii môžeš **inventárne číslo zadať ručne**.

### Pri vrátení mi systém ukáže „Položka nie je v zápožičke"

Buď:

- **Skenuješ inú položku** ako máš v zápožičke (typicky podobný kus zo skladu)
- **Zápožička je už uzavretá** — niekto ju vrátil pred tebou

Skontroluj v **Moje zápožičky → Aktívne**, čo presne máš v evidencii.

### Nemôžem podpísať preberací protokol

- **Skontroluj, či si prihlásený** — relácia sa mohla skončiť
- **Skontroluj internet** — podpis vyžaduje aktívne pripojenie
- Skús **prehliadač Chrome alebo Edge** — niektoré staršie prehliadače majú s digitálnym podpisom problémy

---

## Problémy s notifikáciami

### Nedostávam e-mailové notifikácie

1. **Skontroluj nastavenia** — `Profil → Preferencie → E-mail notifikácie` musí byť `ON`
2. **Pozri si spam** — Outlook často filtruje automatické e-maily
3. **Pridaj `noreply@futbalsfz.sk` _(TODO: overiť)_** do dôveryhodných odosielateľov
4. Skontroluj, či **tvoj e-mail v profile** je správny

### Notifikácie chodia príliš často

V `Profil → Preferencie` môžeš:

- **Vypnúť e-mail** pre nedôležité typy
- **Nechať len in-app** notifikácie pre denné veci
- **Nechať e-mail** len pre kritické (Po termíne, Schválenia)

---

## Pomalá aplikácia

### Načítanie trvá dlho

1. **Tvrdé obnovenie** — `Ctrl + Shift + R` / `Cmd + Shift + R`
2. **Skontroluj internet** — `speedtest.net` (potrebuješ aspoň 5 Mbps)
3. **Skús v inom čase** — počas inventúrnych operácií (koncom mesiaca) môže byť backend zaťažený
4. **Skontroluj rozšírenia prehliadača** — niektoré (uBlock, Privacy Badger) môžu blokovať API volania

### Zoznam majetku má veľa položiek a je pomalý

Použi **filtre** — kategória, lokalita, stav. Nevyhľadávaj v 5000 položkách naraz.

---

## Ostatné

### Niečo iné nefunguje — kde nahlásiť?

1. **Skús to znova** o pár minút (môže to byť dočasná chyba)
2. **Skontroluj status stránku** _(TODO: zaviesť — doména zatiaľ nebeží)_
3. **Otvor [GitHub Issue](https://github.com/ltksolutions/inventario/issues)** s popisom problému
4. **Napíš na `support@futbalsfz.sk`** _(TODO: overiť)_ — pripoj screenshot

> 💡 **Dôležité pri hlásení:** Pripoj **dátum/čas**, **akcia, ktorú si robil**, **chybové hlásenie** a najlepšie aj **screenshot**.

---

<sub>Posledná aktualizácia: 2025-01</sub>
