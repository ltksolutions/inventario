<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Inventario docs site — Vercel deployment guide

> **Cieľ:** Nasadiť `apps/docs/` (Nextra v4.6.0 + Next.js 15.5) na `docs.inventario.estate`
> **Predpokladaná dĺžka:** ~15 minút (vrátane DNS propagácie)
> **Status:** Pripravené na execution

---

## 📋 Pred štartom

- [x] Vercel account (`asset-management-api` a `inventario-marketing` už existujú v `ltksolutions-projects` team-e)
- [x] Prístup k Websupport DNS panelu pre `sportup.sk`
- [x] `apps/docs/` committed na main branch (vrátane vercel.json, package.json, content/)
- [x] Lokálne `pnpm build` v `apps/docs/` funguje

---

## 🚀 Postup

### Krok 1: Vytvor nový Vercel projekt

1. Choď na https://vercel.com/new
2. **Import Git Repository** → vyber `Slovensky-futbalovy-zvaz/Asset-Management`
3. **Configure Project**:
   - **Project Name**: `inventario-docs`
   - **Framework Preset**: `Next.js` (auto-detect)
   - **Root Directory**: `apps/docs` ← KLIKNI **Edit** a nastav
   - **Build Command**: nechaj prázdne (Vercel použije `next build` z `package.json`)
   - **Output Directory**: nechaj prázdne (Vercel auto-detect `.next`)
   - **Install Command**: nechaj prázdne (Vercel detekuje pnpm cez `pnpm-workspace.yaml` a spustí `pnpm install` z root-u)
4. **Environment Variables**: žiadne netreba pre static docs
5. Klik **Deploy**

> 💡 **Prečo Vercel pochopí monorepo?** Lebo má `pnpm-workspace.yaml` v root-e + `Root Directory: apps/docs` v Vercel UI. Vercel automaticky spustí `pnpm install` z root-u (build sa zvyšok mountuje), potom `next build` z `apps/docs/`. **Postbuild script** (`pagefind ...`) ide automaticky po `next build` ako súčasť npm lifecycle.

### Krok 2: Sleduj prvý deploy

Build by mal trvať **~2 minúty**:

```
[00:00] Cloning repo
[00:15] Detecting pnpm workspace
[00:20] Running pnpm install (~30s, lockfile cache hit po prvom)
[00:50] Running next build
[01:30] Running postbuild: pagefind --site .next/server/app
[01:50] Uploading to CDN
[02:00] Ready
```

Vercel pridelí preview URL (napr. `inventario-docs-abc123.vercel.app`). Otestuj:

- `/` → Welcome page s "Vitajte v Inventariu"
- `/getting-started` → Quick start guide
- `/architecture` → Multi-tenant architektúra
- `/api` → REST API dokumentácia
- `/product-ui-tour` → Product UI tour (6 obrazoviek)
- `/deployment` → Tento dokument
- `/about` → História a tím

### Krok 3: Skontroluj Pagefind search

Po deploy klikni do search bar-u (Cmd+K) a vyhľadaj napr. **"multi-tenant"** alebo **"EUPL"**. Mali by sa zobraziť relevantné výsledky.

> ⚠️ Ak search **nefunguje** (žiadne výsledky), znamená to že `postbuild` script (Pagefind) nezbehol. Pozri do Vercel build log-ov, hľadaj riadok `Running postbuild`.

### Krok 4: Pridaj custom doménu

1. Vercel dashboard → projekt `inventario-docs` → **Settings** → **Domains**
2. Klik **Add** → zadaj: `docs.inventario.estate`
3. Vercel ukáže DNS údaje: CNAME `docs` → `cname.vercel-dns.com`

### Krok 5: DNS na Websupport

1. Login do https://admin.websupport.sk
2. Domény → `sportup.sk` → DNS záznamy
3. Klik **Pridať záznam**:
   - **Typ**: `CNAME`
   - **Názov / Host**: `docs`
   - **Hodnota**: `cname.vercel-dns.com.` (s bodkou na konci)
   - **TTL**: `300` alebo Default
4. Ulož

### Krok 6: Počkaj na propagáciu

```bash
# Kontroluj DNS propagáciu
dig docs.inventario.estate CNAME +short
# Očakávaný výsledok: cname.vercel-dns.com.

# Po DNS propagácii → SSL Let's Encrypt sa vystaví automaticky (cca 5 min)
curl -sI https://docs.inventario.estate
# HTTP/2 200 ✓
```

DNS propagácia trvá obvykle **5-30 min** pre Websupport.

### Krok 7: Final verification

```bash
# Homepage
curl -sI https://docs.inventario.estate

# Hlavné stránky
curl -sI https://docs.inventario.estate/getting-started
curl -sI https://docs.inventario.estate/architecture
curl -sI https://docs.inventario.estate/api
curl -sI https://docs.inventario.estate/product-ui-tour
curl -sI https://docs.inventario.estate/deployment
curl -sI https://docs.inventario.estate/about

# Search index dostupný
curl -sI https://docs.inventario.estate/_pagefind/pagefind.js
```

Všetko by malo vrátiť **HTTP/2 200**.

---

## 🔧 Po deploy — revertni "Čoskoro" badge v marketing site

Marketing site má momentálne `<span class="nav-link-disabled">Dokumentácia <span class="nav-soon-badge">Čoskoro</span></span>` namiesto live linkov. Po úspešnom deploy treba premeniť na aktívny anchor.

Najjednoduchšie: `git revert` commit ktorý pridal "Čoskoro" badge:

```bash
cd /Users/janletko/Documents/GitHub/Asset-Management

# Nájdi commit hash
git log --oneline --grep="defer docs.inventario"

# Skopíruj hash (napr. abc1234) a revertni
git revert <hash>

# Push
git push origin main
```

Vercel `inventario-marketing` automaticky redeployne s aktívnymi linkmi na `docs.inventario.estate`.

---

## 🐛 Troubleshooting

### Problem: "next: command not found"

**Príčina**: pnpm install nezbehol pre `apps/docs/`.

**Riešenie**: V Vercel project Settings → General → skontroluj že **Root Directory** je nastavené na `apps/docs`. Vercel detekuje pnpm-workspace.yaml v root-e a inštaluje deps cross-package.

### Problem: Pagefind search nezobrazuje výsledky

**Príčina**: `postbuild` script nezbehol alebo index sa negeneroval správne.

**Riešenie**:

```bash
cd apps/docs
pnpm build
ls -la public/_pagefind/  # mal by obsahovať pagefind.js + JSON indexy
```

Ak je `public/_pagefind/` prázdny, skontroluj `pagefind --site .next/server/app` command v package.json scripts.

### Problem: Custom doména "Invalid Configuration" vo Vercel

**Príčina**: DNS sa ešte len propaguje, alebo CNAME má chybu.

**Riešenie**:

```bash
# Skontroluj DNS
dig docs.inventario.estate CNAME +short

# Ak je prázdne → DNS ešte nepropagoval, počkaj
# Ak je niečo iné než cname.vercel-dns.com → oprav CNAME na Websupporte
```

### Problem: "Cannot find module 'react'" v build log

**Príčina**: Vercel nedetekuje pnpm workspace.

**Riešenie**:

1. Skontroluj že `pnpm-workspace.yaml` je v root repa (nie v `apps/`)
2. V Vercel Project Settings → General → **Install Command** override na: `pnpm install --frozen-lockfile`
3. Redeploy

---

## 📊 Architektúra deployu (full picture)

```
Asset-Management repo
├── apps/api/                  → Vercel: asset-management-api
│                                URL: api.inventario.estate (Q3)
├── apps/docs/                 → Vercel: inventario-docs
│                                URL: docs.inventario.estate ← NEW
└── docs/marketing-site/       → Vercel: inventario-marketing
                                 URL: inventario.estate (LIVE)
```

3 Vercel projekty z jedného repa, každý na svojej subdoméne. Všetko cez Websupport DNS pre `sportup.sk`.

---

## ✅ Sukcess kritéria

Deploy je **úspešný** keď:

- [ ] `https://docs.inventario.estate` vráti HTTP/2 200
- [ ] Všetkých 7 stránok funguje (homepage, getting-started, architecture, api, product-ui-tour, deployment, about)
- [ ] Sidebar nav funguje (kliknutia medzi stránkami)
- [ ] Search funguje (Cmd+K → vyhľadaj "multi-tenant")
- [ ] Dark/light theme toggle funguje (svetlý/tmavý prepínač v nav)
- [ ] Mobile responsive (375px viewport, hamburger menu)
- [ ] SSL A alebo A+ na https://www.ssllabs.com/ssltest/
- [ ] Lighthouse score > 90 (Performance, Accessibility, SEO, Best Practices)
- [ ] OG preview funguje na https://www.opengraph.xyz/

Po splnení → revertnúť "Čoskoro" badge v marketing site (viď vyššie).

🥂 Druhá fľaša Nichta Brut sektu odporúčaná na oslavu!
