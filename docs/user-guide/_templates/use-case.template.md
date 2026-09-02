<!--
TEMPLATE: Use Case
===================
Use case je reálny scenár "od začiatku do konca". Pomáha čitateľovi
**pochopiť kontext** – ako sa veci dejú v praxi.

NIE JE: tutoriál (učenie), how-to (recept), reference (slovník).
JE: rozprávanie príbehu cez konkrétnu situáciu, ktorá sa reálne deje.

Premenné na vyplnenie sú v {{ dvojitých zložených zátvorkách }}.
-->

# {{ Názov scenára – napr. "Viacdňová akcia: vedúci tímu si berie kompletný set vybavenia" }}

> 🎬 **Scenár:** {{ Jedna-dve vety o situácii. }}
> 👥 **Zúčastnení:** {{ napr. "Vedúci akcie, správca skladu, IT správca" }}
> 📅 **Časový rámec:** {{ napr. "2 týždne pred výjazdom až 1 týždeň po návrate" }}

## Kontext

{{ Krátky úvod do situácie – kto, čo, prečo. 2-3 odseky.

Napríklad:
„Pätnásťčlenný tím vyráža na štvordňovú akciu mimo sídla. Vedúci Peter Novák
potrebuje pre celý tím zabezpečiť kompletné vybavenie – prezentačný stánok,
roll-upy, projektor, kamery, prenosné PC a komunikačné rádiové stanice."

Vysvetli aj prečo je tento scenár dôležitý / čo z neho vychádza za špecifiká.
Napr. „Tento scenár ukazuje hromadnú zápožičku rôznorodých kategórií majetku
naraz, čo je časté pri viacdňových akciách mimo sídla." }}

## Aktéri

- **{{ Aktér 1 – napr. Peter Novák, vedúci akcie }}** – {{ jeho úloha v scenári }}
- **{{ Aktér 2 – napr. Anna Horváthová, správca skladu }}** – {{ jej úloha }}
- **{{ Aktér 3 }}** – {{ ... }}

## Priebeh

### Týždeň pred akciou: {{ Fáza 1 – napr. "Plánovanie zápožičky" }}

{{ Rozprávanie – čo robí kto, krok za krokom. Možeš odkazovať na how-to návody.

Napríklad:
„Peter sa prihlási do systému a v sekcii **Tímové žiadosti** vytvorí novú
hromadnú žiadosť. Pridá k nej zoznam položiek, ktoré tím potrebuje:

- 1× prezentačný stánok
- 4× roll-up
- 1× kamera pre analytiku
- 3× prenosný počítač
- 5× rádiové stanice

Žiadosť pošle správkyni skladu Anne. Detaily o tom, ako sa vytvára hromadná
žiadosť, nájdeš v návode `[Hromadná zápožička pre tím](../how-to/hromadna-zapozicka.md)`." }}

> 📸 **TODO: insert screenshot** – {{ popis screenshotu, napr. "Formulár hromadnej žiadosti s vyplneným zoznamom položiek" }}

### {{ Fáza 2 – napr. "Schválenie a príprava skladu" }}

{{ Pokračovanie scenára... }}

### {{ Fáza 3 – napr. "Deň pred výjazdom: prevzatie" }}

{{ ... }}

### {{ Fáza 4 – napr. "Návrat: kontrola a evidencia" }}

{{ ... }}

## Čo systém pre tento scenár robí

- ✅ {{ Funkcionalita, ktorú systém využíva. Napr. "Hromadná žiadosť spája viaceré položky pod jednu schvaľovaciu transakciu" }}
- ✅ {{ ... }}
- ✅ {{ Napr. "Po prevzatí vygeneruje predvyplnený protokol o odovzdaní vo formáte PDF" }}
- ✅ {{ Napr. "Pri vrátení automaticky uzavrie zápožičku a aktualizuje stav položiek na 'Dostupné'" }}

## Čo sa stane, keď niečo zlyhá

### {{ Edge case 1 – napr. "Jedna položka sa stratí počas akcie" }}

{{ Ako sa to rieši v systéme. }}

### {{ Edge case 2 }}

{{ ... }}

## Z čoho tento scenár ťaží

{{ Krátky reflektívny odsek – aký nehmatateľný benefit má používateľ z toho,
že tento workflow je zdigitalizovaný. Napr. "Pred Asset Managementom sa
táto evidencia robila v Exceli a často zostávali nezrovnalosti – stratený
položka sa vyúčtovala až o pol roka neskôr. Teraz má Peter aj Anna prehľad
v reálnom čase a organizácia nestráca peniaze na nezvestnom majetku." }}

## Súvisiace návody a tutoriály

- {{ `[Hromadná zápožička pre tím](../how-to/hromadna-zapozicka.md)` }}
- {{ `[Onboarding pre vedúceho tímu](../getting-started/onboarding-veduci-timu.md)` }}

---

<sub>Posledná aktualizácia: {{ YYYY-MM-DD }} · Cieľová rola: {{ napr. vedúci akcie, správca skladu }}</sub>
