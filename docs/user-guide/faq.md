# FAQ — Často kladené otázky

Najčastejšie otázky, ktoré sme dostali počas pilotnej fázy.

> 💡 Tvoja otázka tu nie je? Pozri [Troubleshooting](./troubleshooting.md) alebo napíš na [Support](./support.md).

---

## Prihlásenie a účet

### Ako sa prihlásim?

Ako interný zamestnanec použiješ tlačidlo **Prihlásiť cez firemný účet** (Microsoft Entra ID — rovnaké heslo ako Outlook). Ako externý používateľ použiješ **Prihlásiť pomocou e-mailu** s údajmi, ktoré ti poslal správca. Detaily v [Tvoje prvé prihlásenie](./getting-started/prve-prihlasenie.md).

### Zabudol som heslo

**Interný zamestnanec** — použi rovnaký proces obnovy hesla ako pri Outlooku (kontaktuj IT helpdesk).

**Externý používateľ** — na prihlasovacej stránke klikni na **Zabudli ste heslo?** a postupuj podľa inštrukcií.

### Môžem si zmeniť e-mail?

E-mail je primárnym identifikátorom účtu, preto ho **nemôžeš meniť priamo**. Ak je tvoj e-mail nesprávny, klikni v profile na **Nahlásiť opravu** a správca to vybaví.

### Ako sa odhlásim?

Vpravo hore klikni na svoje **iniciály → Odhlásiť**. Ak používaš zdieľaný počítač, vždy sa odhlás po práci.

---

## Zápožičky

### Ako dlho trvá schválenie?

Záleží od:

- **Kategórie majetku** — niektoré (napr. štandardné IT) majú self-service, schválenie do hodiny
- **Doby žiadosti** — žiadosti odoslané ráno sa zvyčajne vybavia v ten istý deň
- **Dovolenky správcov** — v zriedkavých prípadoch môže trvať aj 2–3 dni

Ak žiadosť čaká **viac ako 24 hodín**, použi tlačidlo **Pripomenúť schvaľovateľovi**.

### Môžem si požičať niekoľko vecí naraz?

Áno. V katalógu si môžeš dať do **„košíka"** viacero položiek a podať jednu **hromadnú žiadosť**. Vhodné najmä pre tímové výjazdy. Pozri Hromadná zápožička pre tím _(TODO)_.

### Môžem si predĺžiť zápožičku?

Áno, ak je predĺženie pre danú kategóriu povolené a celkový čas neprekročí maximálny limit. V detaile aktívnej zápožičky klikni **Predĺžiť**.

> ⚠️ **Pozor:** Predĺženie musí byť **schválené správcom**. Nepredpokladaj automatický súhlas.

### Čo ak vec po termíne nevrátim?

Status sa zmení na **🔴 Po termíne**. Dostaneš pripomienky, po 48 hodinách aj tvoj manažér. Pri opakovanom omeškaní môžu byť dôsledky podľa interných pravidiel tvojej organizácie — Inventario ich nevymáha, len eviduje.

### Vec sa rozbila počas zápožičky — čo robiť?

Postupuj normálne — pri vrátení označ položku ako **„Vyžaduje servis"** a popíš poškodenie. Ak je vec **kompletne zničená alebo stratená**, použi **„Nahlásiť stratu"**. Riešenie potom prebieha podľa interného procesu (reklamácia/vyúčtovanie).

---

## Technické otázky

### Funguje to na mobile?

Áno. Aplikácia je responsive, plne funkčná na mobile aj tablete. Pre časté používanie odporúčame nainštalovať ako PWA (v Safari/Chrome **Pridať na plochu**).

### Funguje to offline?

Čiastočne — vieš si prezerať aktívne zápožičky a detaily. **Vrátenie a nové žiadosti vyžadujú internet** (synchronizácia s databázou).

### Aký prehliadač mám použiť?

Akýkoľvek moderný — Chrome, Edge, Firefox, Safari. Najlepšiu skúsenosť máš v **aktuálnej verzii Chrome alebo Edge**.

### Mám problém — kde nahlásiť?

Pre **akúkoľvek chybu, ťažkosť alebo nejasnosť** napíš na `support@inventario.estate` alebo otvor [GitHub Issue](https://github.com/ltksolutions/inventario/issues).

---

## GDPR a osobné údaje

### Aké údaje o mne systém uchováva?

Meno, priezvisko, e-mail, telefón, útvar/tím, história zápožičiek a logy prihlásení. Detaily v [SECURITY.md](../../SECURITY.md) a v sekcii **Môj profil → Ochrana osobných údajov**.

### Ako požiadam o výpis svojich údajov?

V profile klikni **Stiahnuť moje údaje** — dostaneš JSON export všetkých svojich záznamov. Toto je tvoje právo podľa GDPR čl. 15.

### Ako požiadam o vymazanie účtu?

Ak nie si v aktívnom pracovnom pomere a nemáš aktívne zápožičky, v profile klikni **Požiadať o vymazanie**. Účet sa pseudonymizuje (osobné údaje sa nahradia placeholderom, ale audit log zostane pre právne účely podľa zákona).

---

<sub>Posledná aktualizácia: 2025-01</sub>
