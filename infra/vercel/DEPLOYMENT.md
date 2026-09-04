<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Inventario — Vercel deployment guide

> **Cieľ:** Nasadiť marketingový web na `inventario.estate` cez Vercel.
> **Predpokladaná dĺžka:** ~25–30 minút (vrátane DNS propagácie)
> **Status:** Pripravený, čaká na execution

---

## 📋 Pred štartom — čo potrebuješ

- [x] Vercel account (zdarma stačí pre marketing site)
- [x] CLI alebo prístup k Vercel dashboard
- [x] Prístup k DNS panelu pre `sportup.sk` doménu
- [x] GitHub Desktop alebo git CLI (commitovať konfiguráciu)

---

## 🎯 Architektúra deploymentu

**Dva oddelené Vercel projekty** v rovnakom repe:

```
ltksolutions/inventario
│
├── apps/api/                       → vercel project: inventario-api
│                                     URL: api.inventario.estate (budúce)
│
└── docs/marketing-site/            → vercel project: inventario-marketing
                                      URL: inventario.estate
```

**Konfigurácia** pre marketing site je v `infra/vercel/marketing-site.vercel.json` (template), ktorý sa môže symlink-núť alebo skopírovať do `vercel.json` v root podľa zvolenej stratégie.

---

## 🚀 Postup A: Cez Vercel dashboard (najjednoduchšie)

### Krok 1: Vytvor nový Vercel projekt

1. Choď na https://vercel.com/new
2. **Import Git Repository** → vyber `ltksolutions/inventario`
3. **Configure Project**:
   - **Project Name**: `inventario-marketing`
   - **Framework Preset**: `Other` (žiadny framework)
   - **Root Directory**: `docs/marketing-site` ← DÔLEŽITÉ
   - **Build Command**: `(leave empty)` — žiadny build, len static files
   - **Output Directory**: `(leave empty alebo .)` — výstup je priamo v root direktóre
   - **Install Command**: `(leave empty)`
4. **Environment Variables**: žiadne netreba pre marketing site
5. Klik **Deploy**

### Krok 2: Skontroluj prvý deploy

1. Vercel pridelí preview URL (napr. `inventario-marketing-xyz.vercel.app`)
2. Otvor URL → mal by si vidieť homepage Inventario
3. Skontroluj:
   - Naviguj cez menu (Domov / Pre koho / Cenník / Technológia / O projekte)
   - Mobile menu (375 px viewport)
   - Favicon v tabe browseru

### Krok 3: Aplikuj clean URLs

Vercel `inventario-marketing-xyz.vercel.app/_home.html` zatiaľ funguje, ale chceme čisté URL bez `_` a `.html`.

V root repa skopíruj config:

```bash
cp infra/vercel/marketing-site.vercel.json docs/marketing-site/vercel.json
```

Commit + push → Vercel automaticky redeployne s novou konfiguráciou. URL bude:

- `/` → homepage
- `/use-cases` → pre koho
- `/pricing` → cenník
- `/technology` → technológia
- `/about` → o projekte

### ℹ️ Poznámka o `index.html` a `demo.html`

V `docs/marketing-site/` sú dva HTML súbory ktoré si zaslužujú vysvetlenie:

- **`index.html`** — minimálny HTML s `meta refresh` + JS redirect na `_home.html`.
  Slúži ako **fallback** pre prípad keď `vercel.json` rewrites nefungujú, alebo pre
  lokálne prezeranie (`open docs/marketing-site/index.html`). Má `noindex` robots tag
  aby ho search engine neindexovali.
- **`demo.html`** — viewport switcher + page selector preview wrapper.
  Dostupný na `inventario.sportup.sk/demo` po deploy.
  Pre interné prezentácie a viewport testing (375 / 768 / 1280 px).

**Production routing** (cez `vercel.json` rewrites):

| URL                            | Slúži                 |
| ------------------------------ | --------------------- |
| `inventario.estate/`           | `_home.html`          |
| `inventario.estate/use-cases`  | `_use-cases.html`     |
| `inventario.estate/pricing`    | `_pricing.html`       |
| `inventario.estate/technology` | `_technology.html`    |
| `inventario.estate/about`      | `_about.html`         |
| `inventario.estate/demo`       | `demo.html` (interný) |
| `inventario.estate/index.html` | 301 redirect na `/`   |
| `inventario.estate/_home.html` | 302 redirect na `/`   |

### Krok 4: Pridaj custom doménu

1. Vo Vercel dashboard → Project: `inventario-marketing` → Settings → Domains
2. Klik **Add** → zadaj `inventario.sportup.sk`
3. Vercel ti ukáže DNS záznam ktorý treba pridať:
   - **Type**: CNAME
   - **Name**: `inventario`
   - **Value**: `cname.vercel-dns.com`
4. **Skopíruj si tieto údaje** — použiješ ich v **C. DNS setup** nižšie

---

## 🛠️ Postup B: Cez Vercel CLI (pre power users)

### Krok 1: Inštalácia CLI

```bash
npm i -g vercel
vercel --version  # mal by byť 39+
```

### Krok 2: Login

```bash
vercel login
# Vyber preferred method (GitHub odporúčam)
```

### Krok 3: Setup projekt

```bash
cd /Users/janletko/GitHub/inventario

# Skopíruj vercel.json template
cp infra/vercel/marketing-site.vercel.json docs/marketing-site/vercel.json

# Linkni nový projekt
cd docs/marketing-site
vercel link

# Otázky:
# ? Set up "~/GitHub/inventario/docs/marketing-site"? Y
# ? Which scope? (vyber svoj team)
# ? Link to existing project? N
# ? What's your project's name? inventario-marketing
# ? In which directory is your code located? ./
```

### Krok 4: Deploy preview

```bash
vercel deploy
# Vercel deployne preview → dostane sa preview URL
```

### Krok 5: Deploy production

Po overení preview:

```bash
vercel deploy --prod
# Promote latest to production
```

### Krok 6: Pridaj doménu

```bash
vercel domains add inventario.estate inventario-marketing
# Alebo cez dashboard (Settings → Domains)
```

---

## ✅ Po-deploy checklist

Po prvom úspešnom deploy:

- [ ] Stránka loaduje na preview URL
- [ ] Všetkých 5 stránok funguje (Domov / Pre koho / Cenník / Technológia / O projekte)
- [ ] Mobile menu funguje na 375px
- [ ] Favicon je v browser tabe
- [ ] OG image preview funguje (otestuj cez https://www.opengraph.xyz/url/{preview-url})
- [ ] Console v DevTools nemá errors (`F12` → Console)
- [ ] Lighthouse score > 90 (Performance, Accessibility, Best Practices, SEO)
- [ ] HTTPS funguje automaticky (Vercel cez Let's Encrypt)

### Lighthouse audit

```bash
# CLI variant
npx lighthouse https://inventario-marketing-xyz.vercel.app \
  --output=html \
  --output-path=./lighthouse-report.html \
  --chrome-flags="--headless"
```

---

## 🐛 Troubleshooting

### "Page not found" pri navigácii

**Príčina**: Vercel default routing nepozná naše `_home.html` súbory.

**Riešenie**: Skontroluj že máš `vercel.json` v `docs/marketing-site/` s `rewrites` section.

### CSS / JS sa nenahráva

**Príčina**: Cesty v HTML sú relatívne (`assets/shared.css`), ale Vercel ich serv'uje z root.

**Riešenie**: Nemali by sme mať problém, lebo Vercel slúži z `outputDirectory: docs/marketing-site` ako root. Skontroluj DevTools Network tab pre 404-ky.

### "Mixed content" warning

**Príčina**: Externý resource cez HTTP (Google Fonts používa HTTPS, takže by nemal byť problém).

**Riešenie**: Skontroluj že všetky `<link>` a `<script>` URL používajú HTTPS.

### Vercel build zlyhal

**Príčina**: Vercel skúša build-nuť ako Next.js app (auto-detect).

**Riešenie**: Vo Settings → General → Framework Preset → nastav `Other` a Build Command nech zostane prázdny.

---

## 🔄 Continuous deployment

Po prvom setup-e Vercel automaticky deploy-uje pri každom push do `main` branchu:

- **Production deploy**: push do `main` → automatický production deploy
- **Preview deploy**: push do feature branch alebo PR → preview URL pre review

Vercel CLI commit info posiela do PR ako komentár (preview URL).

---

## 📊 Vercel free tier limits (sanity check)

Marketing site sa pohodlne zmestí do free tieru:

| Limit          | Free tier     | Naše požiadavky             |
| -------------- | ------------- | --------------------------- |
| Bandwidth      | 100 GB/mes    | <1 GB (statika)             |
| Build minutes  | 6 000/mes     | ~0 (žiadny build)           |
| Deployments    | unlimited     | ~30/mes (development)       |
| Custom domains | unlimited     | 1 (`inventario.sportup.sk`) |
| Edge requests  | 1 000 000/mes | ~10 000/mes (start)         |

**Záver**: Free tier vystačí pre prvý rok produkcie. Pri raste môžeme upgradenúť na Pro ($20/mes).

---

## 📚 Resources

- Vercel docs: https://vercel.com/docs
- vercel.json reference: https://vercel.com/docs/projects/project-configuration
- Custom domains: https://vercel.com/docs/projects/domains
- Headers config: https://vercel.com/docs/projects/project-configuration#headers
- Status page: https://www.vercel-status.com/

---

**Last updated:** 15. máj 2026
