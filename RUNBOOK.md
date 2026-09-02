# RUNBOOK.md — deploy, rollback, incidenty

> Prevádzkové postupy pre produkciu Inventaria. Konvencie repa sú
> v [`CLAUDE.md`](CLAUDE.md), mapa kódu v
> [`ARCHITECTURE.md`](ARCHITECTURE.md).
>
> **Stav dokumentu**: prvá verzia 2026-09-01, zapísaná z toho, čo je
> naozaj v repe (`.github/workflows/`, `apps/*/vercel.json`,
> `infra/vercel/`). Miesta označené **TODO** ešte nie sú overené v praxi —
> neber ich ako hotový postup.

## 1. Prostredia a domény

| Doména                     | Vercel projekt  | Čo to je            |
| -------------------------- | --------------- | ------------------- |
| `inventario.estate`, `www` | marketing-site  | Marketing landing   |
| `app.inventario.estate`    | inventario-app  | Next.js frontend    |
| `api.inventario.estate`    | inventario-api  | Fastify REST API    |
| `docs.inventario.estate`   | inventario-docs | Nextra dokumentácia |

Zdroj: [`infra/vercel/DNS-SETUP.md`](infra/vercel/DNS-SETUP.md). Tenanti
môžu mať navyše vlastné domény (ADR-0035), overované v
`apps/web/src/middleware.ts`.

Prostredia: **Production** = `main`, **Preview** = každý PR. Preview má
vlastné env premenné a nesmie siahať na produkčné dáta.

## 2. Deploy

Deploy je **automatický pri pushi do `main`** — všetky štyri Vercel
projekty sú napojené na ten istý repo.

`ignoreCommand` v `apps/api/vercel.json` a `apps/web/vercel.json` build
preskočí, keď sa v commite zmenilo **len `docs/`**:

```
git diff --name-only ${VERCEL_GIT_PREVIOUS_SHA:-HEAD^} HEAD | grep -qvE '^docs/' && exit 1 || exit 0
```

Praktický dôsledok: commit čisto v dokumentácii nenasadí nič, a je to
zámer.

### Čo sa deje po úspešnom produkčnom deployi API

Vercel pošle `repository_dispatch` typu `vercel.deployment.success`.
Workflow [`migrate-on-deploy.yml`](.github/workflows/migrate-on-deploy.yml)
si vyfiltruje `inventario-api` + `production` a spustí dva kroky v tomto
poradí:

1. `POST https://api.inventario.estate/v1/system/migrations/run`
   — `Authorization: Bearer ${{ secrets.MIGRATIONS_SECRET }}`, timeout 60 s
2. `POST https://api.inventario.estate/v1/system/indexes/ensure`
   — ten istý secret, timeout 120 s

Poradie je zámerné: migrácia môže vytvoriť alebo prečistiť kolekciu, na
ktorej index stojí. Obidve operácie sú **idempotentné**, opakovaný beh je
bezpečný.

> `repository_dispatch` workflow sa spúšťa z verzie súboru na `main`. Ak
> prestane strieľať, skontroluj vo Vercel dashboarde
> Project Settings → Git, či má `inventario-api` zapnuté deployment
> notifications.

### Ručné spustenie migrácií a indexov

```bash
curl --fail -X POST https://api.inventario.estate/v1/system/migrations/run \
  -H "Authorization: Bearer $MIGRATIONS_SECRET"

curl --fail -X POST https://api.inventario.estate/v1/system/indexes/ensure \
  -H "Authorization: Bearer $MIGRATIONS_SECRET"
```

Odpovede: `200` s výsledkom, `401` pri zlom tokene, `503` keď
`MIGRATIONS_SECRET` nie je nastavený (endpoint je vtedy vypnutý),
`500` pri čiastočnom zlyhaní — telo obsahuje `failed[]` so zoznamom.

### Pred deployom (Definition of Done)

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check` a pri
zmene API aj `pnpm --filter @inventario/api openapi:sync` +
`npx @redocly/cli lint docs/api/openapi.yaml`. CI to overuje sama
(`ci.yml`: quality, test, openapi, reuse, commitlint; `docs.yml`: markdown

- openapi), ale rýchlejšie to zistíš lokálne.

## 3. Cron joby

| Endpoint                        | Rozvrh                                  | Secret        | Čo robí                                              |
| ------------------------------- | --------------------------------------- | ------------- | ---------------------------------------------------- |
| `POST /v1/system/retention/run` | `0 3 1 * *` (1. deň mesiaca, 03:00 UTC) | `CRON_SECRET` | GDPR retencia — pseudonymizuje expirované audit logy |

Definovaný v `apps/api/vercel.json` → `crons`. Vercel posiela
`Authorization: Bearer <CRON_SECRET>` sám. Bez nastaveného
`CRON_SECRET` endpoint vracia `503`.

Ručne:

```bash
curl --fail -X POST https://api.inventario.estate/v1/system/retention/run \
  -H "Authorization: Bearer $CRON_SECRET"
```

## 4. Limity funkcií

`apps/api/vercel.json`:

- **Fluid Compute** zapnuté (`"fluid": true`) — jedna inštancia obsluhuje
  viac requestov súčasne. Preto má `plugins/mongo.ts` `maxPoolSize: 10`;
  pool veľkosti 1 serializoval aj `Promise.all` v rámci jedného requestu.
- `api/index.ts`: `maxDuration` 30 s, `memory` 1024 MB
- Globálny rate limit 100 req/min/IP (`server.ts`), na verejných
  endpointoch nižší (30/min).

## 5. Rollback

**Aplikácia** — vo Vercel dashboarde daného projektu:
Deployments → vybrať posledný funkčný → _Promote to Production_
(_Instant Rollback_). Nepotrebuje build ani nový commit.

**Pozor na dve veci:**

1. **Migrácie sa nevracajú.** Runner nemá `down` krok. Ak deploy pustil
   migráciu, ktorá zmenila dáta, rollback appky ju **neodrobí** — starý
   kód sa spustí nad novou schémou. Pred migráciou, ktorá je
   nespätne kompatibilná, si vyžiadaj môj súhlas (pravidlo v `CLAUDE.md`)
   a napíš do session logu, ako by sa vracala.
2. **Indexy zostanú.** `ensureIndexes` je aditívne; rollback ich
   nezmaže. To je väčšinou v poriadku, ale unique index vytvorený novou
   verziou môže starému kódu zhodiť zápis.

**Databáza** — `inventario-prod` je na Atlas **Flex** tieri: 8 denných
snapshotov, bez vlastnej politiky, **bez on-demand snapshotov a bez
Point-in-Time restore**. Reálne RPO je až 24 hodín a je to vedome prijaté
riziko (M10 by stálo ~58 USD/mes.). Restore = Atlas → Backup → vybrať
snapshot → restore do nového clustera, potom prepnúť `MONGO_URI`.

Postup je vyskúšaný: **DR Test #1 (2026-05-23) prešiel** — snapshot
restore < 1 min, 53/53 smoke testov. Záznam v
[`docs/compliance/dr-test-log.md`](docs/compliance/dr-test-log.md), plán
v [`disaster-recovery-plan.md`](docs/compliance/disaster-recovery-plan.md)
(kadencia: pred go-live a potom štvrťročne).

> **TODO**: ďalší štvrťročný DR test je po termíne — od mája 2026 žiadny
> nový záznam. Otvorený bod v `docs/sessions/NEXT.md`. Flex tier navyše
> neumožňuje restore do nového clustera, takže test #1 išiel do dev
> clustera; ten je medzitým určený na zmazanie — pred ďalším testom
> vyriešiť, kam sa restore urobí.

## 6. Keď to spadne

### Kde sa pozrieť najprv

1. **Vercel dashboard** → projekt → Deployments (build zlyhal?) →
   Runtime Logs (bežiace requesty, chyby z error handlera).
2. **`GET https://api.inventario.estate/health`** — liveness.
   **`/health/ready`** — readiness vrátane Mongo (`200` ready /
   `503` not_ready s rozpadom `checks`).
3. **GitHub Actions** → `Run Migrations And Ensure Indexes After Deploy`
   — prebehli migrácie po poslednom deployi?
4. **MongoDB Atlas** → Metrics (spojenia, pomalé dotazy), Alerts.

Logy API sú štruktúrované (pino). 4xx sa logujú ako `warn`, 5xx ako
`error` s `err` a `path`; `reqId` spojí request s odpoveďou.

### Typické príznaky

| Príznak                                 | Kde hľadať                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Appka je prázdna, API vracia 401        | `inv_access` cookie, `JWT_PRIVATE_KEY`/`PUBLIC_KEY` vo Vercel env                                 |
| Všetko vracia 503 na `/v1/system/*`     | chýba `MIGRATIONS_SECRET` alebo `CRON_SECRET`                                                     |
| MFA / passkey endpointy vracajú 503     | chýba `MFA_SECRET_ENCRYPTION_KEY` / `WEBAUTHN_RP_ID`                                              |
| Pomalé prvé načítanie                   | cold start + Atlas latencia — kontext v `docs/sessions/2026-08-31-pomale-nacitanie-dashboardu.md` |
| Tenant doména hlási neznámu organizáciu | `login-context` endpoint a `apps/web/src/middleware.ts` (ADR-0035)                                |
| Nahrávanie príloh alebo loga zlyhá      | `BLOB_READ_WRITE_TOKEN` (Vercel Blob)                                                             |
| `Docs / Markdown` job je červený        | `markdown-link-check` — často cudzí odkaz vracajúci 503 z runnera, skús re-run                    |

### Deploy nič nenasadil

Skontroluj, či commit menil len `docs/` — `ignoreCommand` vtedy build
zámerne preskočí.

## 7. Secrets a env premenné

- **Zdroj pravdy o tom, čo API potrebuje**, je Zod schéma v
  `apps/api/src/plugins/config.ts`; `.env.example` je jej zrkadlo
  a hovorí, čo je povinné a čo bez čoho vracia endpoint 503.
- Produkčné hodnoty **len** vo Vercel dashboarde, nikdy v gite.
- GitHub Actions secrets: `MIGRATIONS_SECRET` (používa
  `migrate-on-deploy.yml`).
- `turbo.json` → `globalEnv` musí obsahovať každú premennú, ktorú build
  potrebuje (napr. `BLOB_READ_WRITE_TOKEN`,
  `BLOB_PRIVATE_READ_WRITE_TOKEN`, `PUBLIC_API_BASE_URL`), inak ju
  Turborepo do buildu nepustí.

> **TODO**: rotácia produkčného Mongo hesla a vyčistenie mŕtvych repo
> secrets (`MONGO_URI_TEST`, `ENTRA_API_CLIENT_ID_TEST`,
> `ENTRA_TENANT_ID_TEST`) — otvorené body v `docs/sessions/NEXT.md`.

## 8. Úložisko príloh a lôg

Projekt má **dva Vercel Blob story** a ich tokeny sa nesmú pomiešať:

| Store                          | Región | Premenná                        | Na čo                                                   |
| ------------------------------ | ------ | ------------------------------- | ------------------------------------------------------- |
| `inventario-api-blob` (public) | fra1   | `BLOB_READ_WRITE_TOKEN`         | len staré objekty spred migrácie a mazanie starého loga |
| `inventario-private` (private) | iad1   | `BLOB_PRIVATE_READ_WRITE_TOKEN` | originály príloh (ADR-0037)                             |

**Prefix nového storu musí zostať `BLOB_PRIVATE`.** Pri pripájaní storu
k projektu vo Verceli ponúka dialóg predvolený prefix `BLOB` — ten by
prepísal token starého storu. Horšie: `@vercel/blob` pri chýbajúcom
`token` siahne na `BLOB_READ_WRITE_TOKEN`, takže originály príloh by
potichu skončili vo verejnom store. Kód preto token predáva vždy
explicitne a bez neho odmietne štartovať Blob provider.

Funkcia beží v **IAD1**, nie vo Frankfurte — `x-vercel-id` na
`api.inventario.estate` je `fra1::iad1` (edge::funkcia). Preto je private
store v `iad1`.

### Keď upload prílohy zlyhá

1. **413 ešte pred našou hláškou** — súbor je nad 4,5 MB, strop Vercelu
   na telo requestu. Multipart cesta má vlastný limit 4 MB. Väčšie súbory
   patria na priamu cestu `POST /v1/assets/:id/attachments/upload-url`
   - `confirm` (25 MB), ktorá ide mimo funkcie.
2. **Prílohy sa nikam neukladajú, v logu `stub`** — chýba
   `BLOB_PRIVATE_READ_WRITE_TOKEN`. V produkcii to `lib/storage` loguje
   ako `error` pri štarte. Doplň premennú vo Vercel dashboarde
   (Storage → `inventario-private` → Connect Project, prefix
   `BLOB_PRIVATE`, s read-write tokenom) a redeployni.
3. **Upload prejde, ale obrázok sa vo výpise nezobrazí** — chýba náhľad.
   Náhľad sa robí len z PNG/JPEG/WEBP a jeho zlyhanie upload **nezhodí**
   (v logu je `warn`). Pri PDF je to správanie správne.
4. **Logo sa nezobrazí na prihlasovacej stránke** — skontroluj hlavičku
   `Cross-Origin-Resource-Policy` na
   `GET /v1/public/organisations/:slug/logo`. Musí byť `cross-origin`;
   helmet dáva globálne `same-origin` a `<img>` z inej domény by ju
   zablokoval.

### Staré objekty vo verejnom store

Migrácia `2026-09-02-attachments-to-private-blob` staré objekty **nemaže**
— sú to jediné kópie a migrácia sa nedá vrátiť. Zmazať sa dajú až po
overení novej cesty v prevádzke, a až potom sa dá odpojiť starý store.

## 9. Čo tento runbook zatiaľ nepokrýva

- **Bezpečnostný incident a únik dát** — postup je v
  [`docs/compliance/breach-notification-plan.md`](docs/compliance/breach-notification-plan.md),
  hrozby v [`threat-model.md`](docs/compliance/threat-model.md). Tento
  runbook rieši technickú prevádzku, nie oznamovacie povinnosti.
- **Plný DR scenár** — [`disaster-recovery-plan.md`](docs/compliance/disaster-recovery-plan.md)
  a [`dr-test-log.md`](docs/compliance/dr-test-log.md).
- **Retenčné lehoty** — [`data-retention-schedule.md`](docs/compliance/data-retention-schedule.md)
  (cron v sekcii 3 ich len vykonáva).
- **Monitoring a alerty** mimo Atlas Alerts a Vercel notifikácií — nie sú
  nastavené. Žiadny uptime monitor, žiadny error tracking (Sentry a spol.).
- **Vercel function región** — nie je pinnutý; pozorované `iad1`, `sfo1`,
  `fra1`, teda funkcia môže skončiť za oceánom od Atlasu vo Frankfurte.
  Otvorený bod v `docs/sessions/NEXT.md`.
