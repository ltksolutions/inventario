# Ako pridať budúceho zamestnanca ešte pred jeho nástupom

> 🎯 **Cieľ:** Vopred zaevidovať budúceho zamestnanca so známou firemnou e-mailovou adresou, aby ste mu mohli schváliť a pripraviť majetok (notebook, telefón, výstroj...) ešte pred jeho prvým dňom.
> 👤 **Pre koho:** Administrátor alebo Správca majetku
> ⏱️ **Trvanie:** menej ako minúta

## Predpoklady

- Vaša organizácia má v **Nastavenia organizácie → Prihlasovanie a domény** zvolenú politiku **„Firemná doména (auto-join)"** (`DOMAIN_RESTRICTED`)
- V zozname povolených domén je pridaná firemná doména budúceho zamestnanca (napr. `firma.sk`)
- Poznáte budúcu firemnú e-mailovú adresu zamestnanca (aspoň jej tvar `meno.priezvisko@doména`)

> ⚠️ **Bez týchto dvoch podmienok táto funkcia nie je dostupná.** Ak vaša organizácia používa len pozvánky e-mailom (`INVITE_ONLY`), sekcia na stránke Pozvánky zobrazí len vysvetlenie a odkaz do Nastavení — pridajte tam doménu, alebo použite bežnú pozvánku (pozri [Súvisiace návody](#súvisiace-návody) nižšie).

## Postup

### 1. Over/nastav doménové prihlasovanie

Ak si nie ste istí, či je funkcia u vás zapnutá:

1. V ľavom menu klikni na **Nastavenia** → **Prihlasovanie a domény**
2. V sekcii politiky prihlasovania vyber **„Firemná doména (auto-join)"**
3. Pridaj firemnú doménu (napr. `firma.sk`) do zoznamu povolených domén a ulož

> 📸 **TODO: insert screenshot** — Nastavenia organizácie, záložka Prihlasovanie a domény, s vybranou politikou „Firemná doména (auto-join)" a zoznamom povolených domén

### 2. Otvor stránku Pozvánky

V ľavom menu klikni na **Pozvánky**. Pod bežným formulárom „Odoslať pozvánku" nájdeš sekciu **„Pridať budúceho používateľa"**.

> 📸 **TODO: insert screenshot** — Stránka Pozvánky so sekciou „Pridať budúceho používateľa" pod formulárom na odoslanie pozvánky

### 3. Vyplň meno a firemný e-mail

1. Vyplň **Meno** a **Priezvisko** budúceho zamestnanca
2. Do poľa pred `@` napíš lokálnu časť e-mailu (napr. `jan.novak`)
3. Vyber **doménu** z rozbaľovacieho zoznamu (obsahuje len domény povolené vo Nastaveniach)
4. Skontroluj náhľad výslednej adresy pod poľom — musí presne sedieť s reálnou budúcou firemnou adresou

> ⚠️ **Preklep sa nedá opraviť neskôr.** Ak sa lokálna časť alebo doména nezhodujú presne s adresou, ktorú zamestnanec použije pri prvom prihlásení, systém ho nenapojí na tento záznam a vytvorí sa mu nový, samostatný účet. Skontroluj adresu pred odoslaním.

### 4. Klikni na „Pripraviť používateľa"

Po odoslaní sa zobrazí potvrdenie s výslednou adresou. Budúci zamestnanec je od tejto chvíle **okamžite k dispozícii** ako príjemca (beneficiary) v žiadostiach o výpožičku — môžete mu vopred podať a schváliť žiadosť o výbavu presne tak, ako pri bežnom členovi.

## Po dokončení

- V zozname **Používatelia** uvidíš nový záznam s odznakom **„Očakáva nástup"** v stĺpci posledného prihlásenia — namiesto dátumu, kým sa ešte neprihlásil
- Môžete mu podať žiadosť o výpožičku (pole **Príjemca**) a nechať ju vopred schváliť
- Keď sa zamestnanec v deň nástupu **prvýkrát prihlási firemnou e-mailovou adresou** (SSO), systém tento predpripravený záznam automaticky rozpozná a aktivuje — odznak „Očakáva nástup" zmizne a nahradí ho dátum prihlásenia. Nevzniká žiadny duplicitný účet.

## Možné problémy

### Sekcia „Pridať budúceho používateľa" zobrazuje len vysvetlenie, nie formulár

Vaša organizácia nemá zapnutú politiku **„Firemná doména (auto-join)"**, alebo nemá pridanú žiadnu povolenú doménu. Prejdi do **Nastavenia organizácie → Prihlasovanie a domény** a doplň to (krok 1 vyššie).

### „Predpríprava budúceho používateľa je dostupná len pre organizácie s doménovým auto-joinom"

Rovnaký dôvod ako vyššie — chyba sa zobrazí aj priamo vo formulári, ak sa politika medzičasom zmenila.

### „Zvolená doména nie je v zozname povolených domén tejto organizácie"

Doména, ktorú vidíte v rozbaľovacom zozname, sa medzičasom odstránila z Nastavení. Obnovte stránku alebo doménu znovu pridajte v **Nastavenia → Prihlasovanie a domény**.

### „Táto e-mailová adresa už v systéme existuje"

Táto adresa už patrí existujúcemu používateľovi (v tejto alebo inej organizácii). Skontrolujte preklep, alebo ak ide skutočne o rovnakú osobu, kontaktujte administrátora — pridanie duplicitného záznamu pre existujúci e-mail nie je možné.

### Zamestnanec sa prihlásil, ale vidím dva záznamy s podobným e-mailom

Pravdepodobne bol pri predpríprave preklep v e-maile (napr. `jan.novak` vs. `jano.novak`). Predpripravený záznam ostáva „osirelý" (nikdy sa neprihlási) a vznikne nový, samostatný účet s reálnou adresou. Riešenie: deaktivujte osirelý záznam (pozastavenie členstva) a prípadné žiadosti/schválenia preneste na nový, reálny účet.

### Nábor napokon nevyšiel — chcem záznam zrušiť

Predpripravený záznam sa **nemaže**. V zozname **Používatelia** otvorte daný záznam a pozastavte jeho členstvo (rovnaký postup ako pri deaktivácii ktoréhokoľvek iného člena). Historické žiadosti a audit log ostávajú zachované.

## Súvisiace návody

- 📖 [Reálny scenár: Nový zamestnanec dostáva vybavenie](../use-cases/novy-zamestnanec.md)
- 🛠️ [Ako si požičať majetok](./poziciat-majetok.md)

---

<sub>Posledná aktualizácia: 2026-07-14 · Cieľová rola: administrátor, správca majetku</sub>
