<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Inventario web app — Vercel deployment guide

> **Cieľ:** Nasadiť `apps/web/` (Next.js 15 + MSAL + design tokens) na `app.inventario.estate`
> **Predpokladaná dĺžka:** ~45 minút (vrátane Azure Portal + DNS propagácie)
> **Status:** ✅ **KOMPLET (2026-05-18 night)**. Všetky kroky 1-9 hotové, 10/10 smoke test PASS, ADMIN promote re-test OK.

---

## 📦 Pred-deploy status (2026-05-18 night) — VŠETKO HOTOVÉ ✅

✅ **Krok 1 KOMPLET**: `inventario-api` Vercel projekt LIVE

- Node 24 LTS runtime (Active LTS, supported do Apr 2028)
- `CORS_ORIGINS` env var: `https://app.inventario.estate,http://localhost:3001`
- Live URL: `https://api.inventario.estate`
- CORS verified live

✅ **Krok 2-4 KOMPLET**: `inventario-app` Vercel projekt vytvorený a deploynutý

- Root Directory: `apps/web`, všetky Override toggles OFF, Node.js auto-detect z `engines.node: "24.x"`
- 4 env vars seté (NEXT_PUBLIC_API_BASE_URL + 3× Entra IDs)
- First deploy SUCCESS (commit `e710abd`, 44s build)
- Bundle sizes: `/`=192kB, `/assets`=211kB, `/categories`=221kB, `/locations`=221kB, `/users`=213kB

✅ **Krok 5 KOMPLET**: Azure Portal frontend SPA redirect URI pridaný

- `https://app.inventario.estate` v Authentication → Redirect URIs
- `http://localhost:3001` zachovaný pre dev work

✅ **Krok 6 KOMPLET**: Vercel custom doména pridaná

- `app.inventario.estate` v `inventario-app` Settings → Domains

✅ **Krok 7 KOMPLET**: Websupport DNS CNAME pridaný

- `app` → `cname.vercel-dns.com.`

✅ **Krok 8 KOMPLET**: HTTPS live ~20:15 local time

- curl `-sI` returns HTTP/2 200, HSTS, Permissions-Policy, X-Frame-Options DENY, x-vercel-cache HIT

✅ **Krok 9 KOMPLET**: 10/10 smoke test PASS

- Všetky scenáre overené v incognito browseri (login, dashboard, /assets, /categories, /locations, /users, mobile drawer, logout)
- ADMIN promote re-test cez Mongo Atlas UI overený — ADMIN-only features unlocked (Pridať buttons, /users list)

**Úplne kompletná timeline + screenshots:** `docs/sessions/2026-05-18-day-summary.md` sekcie 7-8

---

## 📋 Pred štartom

- [x] Slice #4 frontend = 5/6 P0 stránok hotových (login, dashboard, assets list+detail, categories, locations, users)
- [x] CI green na `main` (327/327 backend testov, lint, typecheck, build)
- [x] Vercel account s `ltksolutions-projects` team-om (3 projekty už bežia)
- [x] Prístup k Websupport DNS panelu pre `sportup.sk`
- [x] Prístup k Azure Portal (Entra ID tenant kde sú frontend + backend app registrations)
- [x] Lokálne `pnpm --filter @inventario/web build` funguje

---

## 🚀 Postup

### Krok 1: Backend API CORS allowlist update ⚠️ NAJPRV

**Pred tým než spustíš Vercel projekt** musíš pridať frontend production URL do backend CORS allowlistu, inak prvý smoke test login flow zhasne s "CORS blocked" errorom.

✅ **Dobrá správa**: `apps/api` už má runtime-dynamic CORS cez `CORS_ORIGINS` env var (comma-separated list). Žiadne code zmeny nepotrebné.

```typescript
// apps/api/src/plugins/config.ts už existuje:
CORS_ORIGINS: z.string().default('http://localhost:3001').transform((val) => {
  if (val === '*') return '*' as const;
  return val.split(',').map((s) => s.trim()).filter(Boolean);
}),
```

**Akcia**: V Vercel dashboard → projekt **`inventario-api`** → **Settings** → **Environment Variables**:

Update (alebo pridať ak neexistuje) `CORS_ORIGINS` pre **Production** environment:

```
CORS_ORIGINS=https://app.inventario.estate,http://localhost:3001
```

Po Save → Vercel `inventario-api` redeployne automaticky (~2 min).

> ⚠️ **Otestuj backend pred ďalšími krokmi.**
>
> ```bash
> curl -I -H "Origin: https://app.inventario.sportup.sk" https://<api-url>/v1/me
> ```
>
> Musí vrátiť `Access-Control-Allow-Origin: https://app.inventario.sportup.sk` header. Ak nevráti, env var sa nepropagol — znovu skontroluj Vercel project Settings.

---

### Krok 2: Vytvor nový Vercel projekt

1. Choď na https://vercel.com/new
2. **Import Git Repository** → vyber `ltksolutions/inventario`
3. **Configure Project**:
   - **Project Name**: `inventario-app`
   - **Framework Preset**: `Next.js` (auto-detect)
   - **Root Directory**: `apps/web` ← KLIKNI **Edit** a nastav
   - **Build Command**: nechaj prázdne (Vercel použije `next build` z package.json, ale prebuild hook automaticky regeneruje api-types.ts)
   - **Output Directory**: nechaj prázdne (Vercel auto-detect `.next`)
   - **Install Command**: nechaj prázdne (Vercel detekuje pnpm cez `pnpm-workspace.yaml` a spustí `pnpm install` z root-u)
   - **Node.js Version**: `22.x` (default je 22, ale skontroluj)

> 💡 **Prečo Vercel pochopí monorepo?** Rovnako ako pri `inventario-docs`: `pnpm-workspace.yaml` v root-e + `Root Directory: apps/web` v Vercel UI. Vercel spustí `pnpm install` z root-u, potom `pnpm --filter @inventario/web build` (cez framework preset).

### Krok 3: Environment Variables (PRED prvým deploy)

Pred kliknutím **Deploy** vyplň environment variables. Tieto sa **embed-ujú do client bundle** (`NEXT_PUBLIC_*` prefix), takže každý kto si stiahne `.js` ich uvidí — to je **OK pre Entra public client IDs** (sú navrhnuté pre verejnú expozíciu), ale **žiadne secrets sem nikdy**.

| Variable                          | Value                                                                                 | Pôvod                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL`        | `https://<inventario-api>.vercel.app` alebo cez `api.inventario.estate` keď bude live | Vercel deployment URL existing `inventario-api` projektu       |
| `NEXT_PUBLIC_ENTRA_CLIENT_ID`     | `<frontend SPA client ID>`                                                            | Azure Portal → Entra ID → App registrations → frontend SPA app |
| `NEXT_PUBLIC_ENTRA_TENANT_ID`     | `<tenant UUID>` alebo `organizations`                                                 | Azure Portal → Entra ID → Overview → Tenant ID                 |
| `NEXT_PUBLIC_ENTRA_API_CLIENT_ID` | `<backend API client ID>`                                                             | Azure Portal → Entra ID → App registrations → backend API app  |

> ⚠️ **Najčastejšia chyba:** zmiešať frontend SPA client ID s backend API client ID. Sú to **dve rôzne app registrations**.
>
> - **Frontend SPA** (Platform: SPA, redirect URIs s URL) → `NEXT_PUBLIC_ENTRA_CLIENT_ID`
> - **Backend API** (Platform: API, exposes `access_as_user` scope) → `NEXT_PUBLIC_ENTRA_API_CLIENT_ID`

**Nastav pre všetky 3 environments** (Production, Preview, Development) — Vercel ich default-uje na ten istý value, ale daj pozor pri Preview deploys aby tam neboli production credentials.

### Krok 4: Klik Deploy + sleduj prvý build

Build by mal trvať **~2-3 minúty**:

```
[00:00] Cloning repo
[00:15] Detecting pnpm workspace
[00:20] Running pnpm install (~30-60s, cache hit po prvom)
[00:80] Running prebuild: pnpm generate:api-types (regen api-types.ts z openapi.json)
[01:00] Running next build
[02:30] Uploading to CDN
[02:45] Ready
```

Vercel pridelí preview URL (napr. `inventario-app-abc123.vercel.app`). **Otestuj základné stránky** (zatiaľ bez login):

```bash
curl -sI https://<preview-url>/
curl -sI https://<preview-url>/login
```

Mali by vrátiť **HTTP/2 200**.

> ⚠️ Login flow ešte nebude fungovať lebo Azure Portal nemá zaregistrovaný preview URL ako redirect URI. To opravíme v kroku 5.

### Krok 5: Azure Portal — frontend SPA app registration

1. Choď do Azure Portal → Entra ID → App registrations → **frontend SPA app**
2. **Authentication** → **Redirect URIs** → klikni **Add URI**:
   - Pridaj: `https://app.inventario.estate`
   - Necháj zachovaný: `http://localhost:3001` (pre dev work)
3. (Volitelné) **Front-channel logout URL** → `https://app.inventario.estate` (pre clean logout)
4. **Save**

> 💡 **Prečo nepridávame preview URL ako redirect?** Preview URLs sú dynamické (`inventario-app-abc123.vercel.app` sa mení per-commit). Pridaj iba production canonical URL. Pre testing preview deploys treba buď: (a) pridať wildcard redirect URI ak Azure podporuje (zvyčajne nepodporuje pre SPA), alebo (b) testovať login flow až po DNS bind-e.

### Krok 6: Pridaj custom doménu vo Vercel

1. Vercel dashboard → projekt `inventario-app` → **Settings** → **Domains**
2. Klik **Add** → zadaj: `app.inventario.sportup.sk`
3. Vercel ukáže DNS údaje: CNAME `app` → `cname.vercel-dns.com`

### Krok 7: DNS na Websupport

1. Login do https://admin.websupport.sk
2. Domény → `sportup.sk` → DNS záznamy
3. Klik **Pridať záznam**:
   - **Typ**: `CNAME`
   - **Názov / Host**: `app`
   - **Hodnota**: `cname.vercel-dns.com.` (s bodkou na konci)
   - **TTL**: `300` alebo Default
4. Ulož

### Krok 8: Počkaj na DNS + SSL

```bash
# Kontroluj DNS propagáciu
dig app.inventario.estate CNAME +short
# Očakávaný výsledok: cname.vercel-dns.com.

# Po DNS propagácii → SSL Let's Encrypt sa vystaví automaticky (cca 5 min)
curl -sI https://app.inventario.estate
# HTTP/2 200 ✓
```

DNS propagácia trvá obvykle **5-30 min** pre Websupport.

### Krok 9: Smoke test — full E2E flow

Otvor `https://app.inventario.estate` v browseri (incognito mode pre čistý MSAL state) a postupne klikni cez:

```
1. https://app.inventario.estate
   → vidí Login screen ("Prihlásiť sa cez Microsoft")

2. Klik "Prihlásiť sa cez Microsoft"
   → redirect na login.microsoftonline.com
   → consent dialóg (prvý raz) → Accept
   → redirect späť na app.inventario.estate

3. /dashboard
   → vidí "Vitajte, [Meno]" + role badge "Administrátor"
   → 4 stats cards (Majetok / Kategórie / Lokality / Výpožičky)
   → quick navigation grid

4. /assets
   → list načítaný (~50 items per page)
   → paginácia funguje (klik next/prev)
   → filter funguje (klik status dropdown)
   → search funguje (typuj "ball" → debounced filter)

5. /assets/[id]
   → klik na inventory number v tabuľke
   → detail loaded so všetkými fieldmi
   → klik "Upraviť" → edit form
   → zmen name → Save
   → späť v read view s aktualizovaným menom

6. /categories
   → list načítaný
   → klik "+ Pridať" → modal otvorí
   → vyplň name + type → Create
   → nová kategória v tabuľke

7. /locations
   → rovnaký flow ako /categories

8. /users
   → ak si ADMIN: vidí list users
   → ak nie si ADMIN: vidí AccessDenied

9. Mobile (Chrome DevTools narrow 375px):
   → hamburger menu sa zobrazí
   → klik → drawer otvorí s navigation
   → klik link → drawer zatvorí + navigácia funguje

10. Logout → klik "Odhlásiť sa"
    → redirect na /login
    → /dashboard direct visit → redirect na /login (AuthGate funguje)
```

Každý úspešný krok = ✅ commit pre `docs/sessions/2026-05-19-deploy-day-summary.md`.

---

## 🐛 Troubleshooting

### Problem: "AADSTS50011: Reply URL does not match"

**Príčina**: Azure Portal frontend SPA app registration nemá zaregistrovaný `https://app.inventario.sportup.sk` ako redirect URI.

**Riešenie**: Krok 5 — pridaj redirect URI v Azure Portal.

### Problem: "CORS blocked: Origin not allowed"

**Príčina**: Backend `apps/api` CORS allowlist neobsahuje frontend production URL.

**Riešenie**: Krok 1 — update CORS allowlist v `apps/api/src/plugins/cors.ts` alebo cez `ALLOWED_ORIGINS` env var.

### Problem: "Cannot read property 'GET' of undefined" v dashboard

**Príčina**: `NEXT_PUBLIC_API_BASE_URL` je zlé alebo prázdne, openapi-fetch client nefunguje.

**Riešenie**: Vercel project Settings → Environment Variables → over že `NEXT_PUBLIC_API_BASE_URL` ukazuje na live backend URL (nie localhost).

### Problem: "404 Not Found" na `/dashboard` po login

**Príčina**: Next.js App Router routing chyba alebo build artefakt sa nedeployol.

**Riešenie**: Vercel project → Deployments → najnovší → Build Logs → hľadaj `Generating static pages` riadky. Ak chýbajú stránky, skontroluj `apps/web/src/app/` štruktúru.

### Problem: Login redirect ide na localhost namiesto production URL

**Príčina**: MSAL config v `apps/web/src/lib/msal-config.ts` má hardcoded localhost redirect URI namiesto window.location.origin.

**Riešenie**: Pozri `msal-config.ts` — `redirectUri` by mal byť `window.location.origin` alebo z `NEXT_PUBLIC_*` env vars dynamicky.

### Problem: Atlas connection timeout v backend logs

**Príčina**: Atlas Network Access nepovoluje Vercel egress IPs.

**Riešenie**: MongoDB Atlas → Network Access → Add IP Access List Entry → `0.0.0.0/0` (Allow access from anywhere). Pre pilot je to akceptovateľné s strong auth. Production refactor na Atlas PrivateLink alebo Vercel Edge Config IP allowlist.

---

## 💡 Lessons learned z inventario-api deploy battle (2026-05-18)

3.5-hodinový debug session odhalil viacero Vercel-specific quirks. Aplikuj na `inventario-app` deploy session:

### 1. engines.node musí byť major-only syntax

- BAD: `">=24.15.0"` — Vercel to flag-ne ako conflict
- GOOD: `"24.x"` — major-only, Vercel happy

Z Vercel docs: "Only major versions can be specified. Please avoid greater than ranges."

### 2. Nehardco-duj runtime v vercel.json

- BAD: `"runtime": "@vercel/node@5.0.0"` v functions config (prepisuje engines.node)
- GOOD: vynechaj runtime field, nech Vercel auto-deteguje

### 3. NEPOUŽÍVAJ Vercel UI Project Settings overrides

Všetko cez vercel.json v repo. UI overrides sa stanú stale pri rename packages (zistili sme stale `@sfz/shared-types` aj po rename na `@inventario/shared-types`).

Pre inventario-app setup:

- DON'T set: Build/Install/Output/Development Command (Override toggles OFF)
- DO set: Root Directory `apps/web`
- DON'T set: Node.js Version (auto-deteguj z engines.node)

### 4. Vercel Production Override = read-only snapshot

Updatuje sa iba novým úspešným Production deploy. Nie cez UI dropdown (často disabled).

### 5. Build cache pri debug-u OFF

Pri debug-u vždy uncheck "Use existing Build Cache" v Redeploy dialógu.

### 6. Hobby tier limit 100 deploys/day

Debug session rýchlo vyčerpá. Pro tier ($20/month) je rozumné pre production launch.

---

## 📊 Architektúra deployu (full picture)

```
ltksolutions/inventario (repo)
├── apps/api/                  → Vercel: inventario-api
│                                URL: api.inventario.estate (Q3 2026)
├── apps/docs/                 → Vercel: inventario-docs
│                                URL: docs.inventario.estate (LIVE)
├── apps/web/                  → Vercel: inventario-app          ← NEW
│                                URL: app.inventario.estate
└── docs/marketing-site/       → Vercel: inventario-marketing
                                 URL: inventario.estate (LIVE)
```

4 Vercel projekty z jedného repa, každý na svojej subdoméne. Všetko cez Websupport DNS pre `sportup.sk`, jeden monorepo z ltksolutions/inventario.

---

## ✅ Sukcess kritériá

Deploy je **úspešný** keď:

- [ ] `https://app.inventario.estate` vráti HTTP/2 200 na všetky public routes (`/`, `/login`)
- [ ] Login flow end-to-end funguje (Microsoft consent → redirect späť → /dashboard)
- [ ] Všetkých 5 P0 stránok renderuje data z backendu (`/dashboard`, `/assets`, `/assets/[id]`, `/categories`, `/locations`, `/users`)
- [ ] Edit operations fungujú (asset PATCH, category create, location create, user update)
- [ ] Mobile responsive (hamburger, drawer, table overflow-x-auto)
- [ ] Logout → redirect na /login, AuthGate funguje
- [ ] SSL A alebo A+ na https://www.ssllabs.com/ssltest/
- [ ] Lighthouse score > 80 (Performance, Accessibility, SEO, Best Practices) — App má MSAL + dynamic data, takže nie 90+
- [ ] DevTools console clean (žiadne MSAL errors, CORS errors, missing assets)

Po splnení → pripraviť emailovú správu pre prvého pilot tenant (Mesto Pezinok? ŠK Inter? Stredná škola Kremnica?) s link-om na `app.inventario.sportup.sk` a stručným onboarding briefom.

🥂 Tretia fľaša Nichta Brut sektu na oslavu — **5/6 P0 hotových, app live**.

---

## 🔗 Po deploy — update tracking docs

- [x] `docs/sessions/2026-05-18-day-summary.md` — deploy story zaznamenaná (sekcie 7-8)
- [x] `docs/sessions/NEXT.md` — Production stav: `app.inventario.estate` ⏳ → ✅ LIVE
- [x] `infra/vercel/README.md` — `inventario-app` table riadok → LIVE
- [ ] `docs/milestones/slice-4-frontend-web.md` — milestone doc (može ďakať do ďalšej session)

A potom voľný čas spať. Slice #5 (loans backend) alebo pilot tenant onboarding môže byť na ďalší týždeň.
