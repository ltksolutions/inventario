<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# `product-screens/` — reálne screenshoty zo živej aplikácie

Tento priečinok obsahuje **6 reálnych screenshotov** z nasadenej aplikácie
Inventario (demo tenant **„ŠK Demo Inventário"**, `app.inventario.estate`).
Sú to zdrojové, plnorozlíšené PNG (retina, ~2778 px na šírku).

## Súbory

| Súbor                | Obrazovka            | Popis                                                       |
| -------------------- | -------------------- | ----------------------------------------------------------- |
| `real_dashboard.png` | Dashboard            | KPI karty + panel „Čaká na vás" so žiadosťami na schválenie |
| `real_assets.png`    | Majetok              | Filtrovateľný zoznam položiek so stavmi a kategóriami       |
| `real_stock.png`     | Sklad                | Hromadné (BULK) položky so skladovým zostatkom              |
| `real_loans.png`     | Žiadosti / Výpožičky | Schvaľovacia queue (schváliť / zamietnuť)                   |
| `real_my-loans.png`  | Moje výpožičky       | Osobný prehľad — aktívne, čakajúce, história                |
| `real_protocols.png` | Preberacie protokoly | Protokoly o odovzdaní a vrátení majetku                     |

## Kde sa používajú

- **`/screenshots`** ([`../screenshots.html`](../screenshots.html)) — verejná galéria
  všetkých 6 obrazoviek s lightboxom.
- **Homepage** ([`../index.html`](../index.html)) — hero pozadie (stmavený dashboard)
  a pás „Zo živej aplikácie".

Pre web sa nepoužívajú tieto PNG priamo — sú zdrojom pre **web-optimalizované JPG**
v [`../assets/screens/`](../assets/screens/) (šírka 1400 px) a hero podklad
[`../assets/hero-dashboard.jpg`](../assets/hero-dashboard.jpg). Po výmene
screenshotov pregeneruj JPG z týchto PNG.

## História

Pôvodne tu žilo **6 self-contained HTML mockupov** renderovaných v `<iframe>`
z `interactive-demo.html` (marketing wrapper s tenant + viewport switcherom).
Po nasadení reálnej aplikácie sme mockupy aj `interactive-demo.html` **odstránili**
a nahradili ich skutočnými zábermi.

> Pozn.: `docs/design/screens/_*.html` (originály mockupov) a
> `scripts/copy-product-screens.sh` (ich sync) sú tým pádom **legacy** a už sa
> v marketing site nepoužívajú.
