<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 2026-07-06 — Cold-start perf (migrácie mimo request path), bad auth diagnostika, zjednotenie preloaderov

## Kontext

Appka sa dlho načítavala (~20-30s, "Načítavam Inventario..."). Diagnostika cez
Vercel MCP (deploymenty, runtime logy/chyby) + `inventario-prod` MongoDB MCP
(read-only).

## 1. Root cause pomalého štartu — migrácie na každom cold starte

`runPendingMigrations()` bežala pri **každom** serverless cold starte
`inventario-api` — 14+ migrácií, každá samostatný `findOne` proti kolekcii
`migrations`, plus nové Mongo pripojenie. Pri viacerých súbežných page-load
requestoch (každý môže trafiť iný studený lambda kontajner) sa toto násobilo.

**Fix (commit `00a2515`):**

- `runner.ts`: nová `checkPendingMigrations()` — **1** dotaz (nie N), len
  varovanie do logu ak niečo čaká, nič nespúšťa.
- `server.ts`: cold start volá `checkPendingMigrations()` namiesto
  `runPendingMigrations()`.
- Nový `POST /v1/system/migrations/run` (`migrations.routes.ts`), chránený
  `MIGRATIONS_SECRET` (Bearer token, rovnaký vzor ako `CRON_SECRET`
  retention endpoint) — migrácie teraz bežia na požiadanie, pri deployi.
- `.github/workflows/migrate-on-deploy.yml` — nový GitHub Actions workflow,
  reaguje na Vercelov `repository_dispatch` event `vercel.deployment.success`
  (filtrovaný na `project.name == 'inventario-api'` a
  `environment == 'production'`), zavolá endpoint cez curl s
  `MIGRATIONS_SECRET`.
- `openapi.json` doplnený o nový path.

**Rozhodnutia (Janika, 2026-07-06):** GitHub Actions na `repository_dispatch`
(nie manuálny trigger, nie samostatný Vercel webhook); vlastný
`MIGRATIONS_SECRET` (nie zdieľaný s `CRON_SECRET`); cold-start check
ponechaný ako pasívna poistka (nie úplne odstránený).

## 2. Incident — produkcia dole po nasadení (MIGRATIONS_SECRET)

Po nastavení `MIGRATIONS_SECRET` vo Vercel a redeployi hádzala **celá**
produkčná API 500 (`FUNCTION_INVOCATION_FAILED`) na všetkých routoch —
Zod env validácia (`MIGRATIONS_SECRET: z.string().min(32).optional()`)
zlyhala a pád validácie zhodí celý Fastify boot.

- Prvé podozrenie (príliš krátka hodnota) vyvrátené — Janikina hodnota mala
  64 znakov, v poriadku.
- **Skutočná príčina:** Vercel aplikuje zmeny env premenných **len na nový
  deployment** — bežiace funkcie mali zapečenú staršiu (nevalidnú) hodnotu
  z predchádzajúceho redeploy-u, ktorý predbehol uloženie správnej hodnoty.
  Rovnaký vzorec ako predchádzajúci `EMAIL_PROVIDER` incident (viď
  `docs/sessions/2026-06-10-*`).
- Fix: ešte jeden Redeploy **po** uložení správnej hodnoty. Overené:
  `POST /v1/system/migrations/run` bez auth → `401` (nie `500`/`503`),
  `/v1/auth/me` a `/v1/system/retention/run` → normálne `401`.
  `get_runtime_errors` na najnovšom deploymente (`dpl_DQQkBuqvxKFRHTGY16HpSjSzQnuu`)
  bez chýb — staré chybové skupiny majú `lastDeployment` na predošlom
  (chybnom) deployi.

**Poučenie (opakované):** zmena env premennej vo Vercel vyžaduje VŽDY nový
deployment, inak bežia staré funkcie so starou hodnotou.

## 3. Bad auth (Mongo) — diagnostika, čaká na potvrdenie

`MongoServerError: bad auth` traced na Preview deploymenty (dependabot PR
branche) — nesprávny/starý `MONGO_URI`. Janika nastavila: Production →
`appName=inventario-prod` connection string, Preview →
`appName=inventario-dev`. **Zatiaľ nepotvrdené** na živom novom Preview
deploymente (čaká sa na ďalší dependabot PR alebo push mimo main).

## 4. Zjednotenie preloaderov

Feedback: pruh pod hlavičkou (`RouteProgressBar`) si ľudia nevšímali.

**Rozhodnutie (Janika):** úplne zrušiť pruh, zjednotiť VŠETKY loading stavy
do jedného centrálneho, jasne identifikovateľného typu — spinner + logo
Inventario, v strede obrazovky.

**Implementácia (commit `e98c2373`):**

- Nová `LoadingOverlay.tsx` — fixný, vystredený overlay (Inventario
  wordmark + `Loader2` spinner + text), priesvitné rozmazané pozadie,
  `z-[100]`, nezávislý od scrollu.
- `AuthGate.tsx` — používa `LoadingOverlay` namiesto vlastného
  text-only bloku.
- `RouteProgressBar.tsx` → premenované na `GlobalFetchOverlay.tsx`
  (git rename, 56% similarity) — rovnaká anti-flicker logika (120ms
  delay / min. 240ms viditeľnosť), teraz vykresľuje `LoadingOverlay`
  namiesto tenkého pruhu.
- `AppShell.tsx` — `GlobalFetchOverlay` presunutý z hlavičky na root
  shellu (predtým `absolute` v headeri, teraz `fixed` overlay).
- `globals.css` — odstránené nepoužité `.route-progress-bar` štýly +
  keyframes.

**Vedomý trade-off:** overlay teraz prekrýva aj background refetch na
stránke, kde už sú dáta (napr. prepnutie tabu) — predtým `RouteProgressBar`
toto zámerne nerobil (aby neprekrýval existujúci obsah). Janika zvolila
jednotnosť/viditeľnosť nad "never interrupt the view".

Overené: `tsc --noEmit`, `eslint`, `prettier --check` — všetko zelené.
Nasadené na `inventario-app` production.

## Ostatné

- Testovací súbor `.claude-fs-probe.tmp` (z predošlej session, overoval
  zdieľanie sandboxového bash mountu s git MCP) — Janika dala povolenie
  zmazať, ale sandbox `rm`/`mv`/`os.remove` zlyhávajú s "Operation not
  permitted" (blokované na úrovni mountu, nie oprávnení súboru — uid/gid aj
  0600 permissions sú v poriadku). **Janika musí zmazať sama lokálne:**
  `rm .claude-fs-probe.tmp` v koreni repa.
- `MIGRATIONS_SECRET` ako GitHub Actions repo secret — Janika potvrdila
  pridané ("ano").

## Otvorené

- Potvrdiť bad auth fix na ďalšom Preview deploymente.
- Overiť, že `migrate-on-deploy.yml` sa reálne spustí pri najbližšom
  produkčnom deployi `inventario-api` (repository_dispatch filter).
- `.claude-fs-probe.tmp` — čaká na manuálne zmazanie Janikom.
- Región Vercel funkcií vs. MongoDB Atlas región (pozorované cold starty
  z `iad1`/`sfo1`/`fra1`) — spomenuté ako možné ďalšie zlepšenie, zatiaľ
  neriešené.
