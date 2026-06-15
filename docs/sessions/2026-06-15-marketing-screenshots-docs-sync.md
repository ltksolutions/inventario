<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Marketing screenshoty + odstránenie dema + docs sync (2026-06-15)

> **Účel.** Dokončenie TODO #25 (reálne screenshoty namiesto mockupov) a následné
> zosúladenie celej „živej" dokumentácie s realitou + rebrand starého názvu produktu.
> Všetko commitnuté a pushnuté na `main` (Vercel auto-deploy).

## Čo sa spravilo

### 1. Tenant switcher — kontrast v tmavej hlavičke (`c120490`)

`AppShell.tsx` — pill prepínača organizácií mal na navy lište slabý text. Zvýraznený:
plná biela (`text-brand-primary-fg`), jemné pozadie `bg-white/15`, silnejší okraj,
`font-semibold`. eslint + tsc zelené.

### 2. Reálne screenshoty demo tenanta (`a0764e3`)

6 obrazoviek demo tenanta **„ŠK Demo Inventário"** (fiktívne dáta, žiadne PII)
odfotené cez Claude-in-Chrome + macOS `screencapture` (page-only, orezané o lištu
prehliadača aj Claude debug banner). Zdroj: `docs/marketing-site/product-screens/real_*.png`
(dashboard, assets, stock, loans, my-loans, protocols). Pozn.: Cowork `save_to_disk`
nefunguje — preto `screencapture` + crop cez PIL.

### 3. Nová stránka `/screenshots` + odstránené interaktívne demo (`18401e5`, `f3508ee`)

- Nová `screenshots.html` — galéria 6 obrazoviek + lightbox (klik = zväčšenie, Esc).
- Homepage: hero **pozadie = stmavený/rozmazaný dashboard** (`assets/hero-dashboard.jpg`,
  brightness 0.62 + blur, tmavý navy overlay → biely text čitateľný), pás
  „Zo živej aplikácie", CTA „Pozrieť screenshoty".
- Web-optimalizované JPG v `assets/screens/` (1400 px) — zdroj pre galériu aj homepage.
- Nav/pätička: „Demo" → „Screenshoty".
- **Odstránené:** `interactive-demo.html`, 6 HTML mockupov v `product-screens/`, celý
  legacy `docs/design/screens/` (13 súborov) + `scripts/copy-product-screens.sh`.
- Neskôr (`52f0677`) pás „Zo živej aplikácie" prerobený na 3 čisté „browser" karty
  (celý záber bez orezu, dot-lišta, popis) — pôvodný orezaný pruh vyzeral rozbito.

### 4. Zosúladenie TODO.md (`38c62c5`, `263b74b`)

Overené priamo v kóde + testoch + ADR, že tieto bloky sú **DONE** (TODO mal stale `[ ]`):

- **ADR-0028 per-tenant branding** (B1–B10) — `brandKit`, `BrandProvider`, `contrast.ts`, admin Branding.
- **ADR-0030 auth/identity** (D1–D7) — `entraTenantId`, `auto-join.ts`, admin `/settings/auth`, neutrálna registrácia. **Apple kód hotový** (`apple-auth.routes.ts`, 768 r.), beží len keď sú env premenné (inak 503).
- **ADR-0031 per-tenant Microsoft OAuth** (E1–E8) — `oauth-crypto.ts`, `oauth-provider-resolver.ts`, admin „Microsoft aplikácia".
- Member extras: per-email domain exception + email change verification = DONE; bulk CSV invite + per-tenant email provider = otvorené.

### 5. `role-opravnenia.md` + sync živých docs (`23bb589`)

- Nový `docs/user-guide/reference/role-opravnenia.md` — matica oprávnení per rola
  z reálnych `requireRole`/`requireMinRole` guardov; odstránený „TODO: vytvoriť" v `user-role.ts`.
- `docs/README.md` index prepísaný na skutočnú štruktúru.
- `architecture/README.md` + `data-model.md`: **NestJS → Fastify**, Next.js 14 → 15,
  status „v príprave" → Production LIVE, mŕtve odkazy (overview/security/deployment) preč.
- root `README.md` + `ROADMAP.md`: ADR 13× → 30+, demo/mockupy → `/screenshots`.

### 6. Rebrand „SFZ Asset Management" → „Inventario" (`eff1987`)

19 živých súborov: celá `docs/user-guide/`, `packages/shared-types` (banner + README),
`.github` šablóny, `infra`, `.env.example` (`NEXT_PUBLIC_APP_NAME`). Ponechané: ADR +
sessions (historické), `about.mdx` (opisuje samotný rebrand), `dist`/`.next` (artefakty).
Pre-commit hooky (prettier/eslint/typecheck cez turbo) zelené.

### 7. Regenerácia `docs/api/openapi.yaml` (`c420aca`)

Kanonický spec je `apps/api/openapi.json` (tracked, aktuálny: Inventario API, 61 pathov).
`docs/api/openapi.yaml` bol osamotený zastaraný duplikát (staré meno, 41 pathov) →
regenerovaný z JSON-u na 61 pathov + hlavička „generovaný súbor".

## Otvorené / follow-up

- **MCP server (Slice #10, K1–K23)** — jediná veľká nedokončená feature, plán Q1 2027.
- Drobnosti: bulk invite cez CSV, per-tenant email provider override, migrácia testov na
  `provisionUser()` (odstrániť `test-jwt-loader.ts`).
- **Ops (mimo kódu):** Apple Developer účet + `APPLE_*` env premenné (odomkne Apple Sign-In);
  rotácia prod Mongo hesla (objavilo sa v chate); voliteľné vyčistenie demo dát z prod
  (`seed:demo --confirm --reset`).
- `docs/compliance/wcag-2.1-aa-audit.md` ešte referuje odstránené `interactive-demo` —
  je to datovaný snapshot, ponechané ako historický záznam.

## Doplnené (popoludní)

### 8. Marketing nav — orezaný prepínač jazykov (`80cf7df`)

`shared.css`: `.lang-switch` má `overflow: hidden` a v tesnom desktop nave (7 odkazov +
brand + tlačidlo > 1180 px kontajner) ho flexbox stláčal → „EN" sa orezalo. Fix:
`flex-shrink: 0` na `.lang-switch` + `.nav-right`, `white-space: nowrap` na tlačidlá,
breakpoint hamburgeru `1100 → 1240 px`.

### 9. App — stránka Žiadosti: nadpis, žiadateľ, detail (`0f9fb8e`)

Tri nahlásené nedostatky na `/loans`:

- nadpis „Výpožičky" → **„Žiadosti"** (zhoda s menu) v `LoansContent.tsx`;
- nový stĺpec **„Žiadateľ"** — meno z `useMembers` (server vracia len ID), + beneficiár ak sa líši;
- **detail žiadosti** — nová stránka `/loans/request/[id]` + `LoanRequestDetailContent` +
  hook `useLoanRequest(id)` nad existujúcim `GET /v1/loan-requests/:id`; odkaz „Detail" v každom riadku.

Riešené FE-only (žiadny backend). tsc + eslint zelené, pre-commit hooky prešli.
Pozn.: detail je read-only — akcie ostávajú v zozname (možný budúci doplnok).

## Commity (2026-06-15)

`c120490` · `a0764e3` · `18401e5` · `f3508ee` · `38c62c5` · `263b74b` · `23bb589` ·
`eff1987` · `c420aca` · `52f0677` · `a0e535b` · `80cf7df` · `0f9fb8e` (+ tento „poupratuj" docs commit).
