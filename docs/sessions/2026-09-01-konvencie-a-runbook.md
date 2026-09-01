<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-09-01 (2) — konvencie repa, runbook a audit dokumentácie

## Kontext

Janika chcel do repa `CLAUDE.md` a dal na to svoj štandardizovaný template.
Template ale predpokladá iný projekt (Next.js aj pre API, `lib/db/client.ts`,
`devlog/`, i18n SK/CS/EN), takže väčšina sekcií sa musela prepísať proti
realite. Pri tom porovnávaní vypadol audit, ktorý našiel štyri rozpory
medzi dokumentáciou a kódom.

## Čo vzniklo

| Súbor             | Čo obsahuje                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`       | Konvencie repa — stack, kánon súborov, git flow, REUSE, konvencie Fastify / Mongo / Next / Vercel / Vitest, DoD |
| `ARCHITECTURE.md` | Mapa kódu — hranice balíkov, vrstvy API, tok requestu, multi-tenancy, čo tu ešte nie je                         |
| `RUNBOOK.md`      | Deploy, post-deploy migrácie a indexy, cron, limity funkcií, rollback, incidenty, secrets                       |

`docs/architecture/README.md` už high-level obrázok má, takže root
`ARCHITECTURE.md` je zámerne **mapa kódu**, nie druhý prehľad — inak by to
bola duplikácia, ktorá sa rozíde.

### Rozdiely template → realita

| Template predpokladá                 | Realita                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------- |
| Next.js App Router aj pre API        | Fastify (`apps/api`), Next.js len web                                     |
| `lib/db/client.ts` singleton         | `plugins/mongo.ts` (Fastify plugin)                                       |
| `lib/db/types.ts`                    | `packages/shared-types`                                                   |
| testy vedľa zdroja                   | `apps/api/tests/{unit,integration}`, `apps/web/tests/unit`                |
| `devlog/YYYY-MM-DD.md`               | `docs/sessions/YYYY-MM-DD-<topic>.md`                                     |
| `NEXT.md`, `ARCHITECTURE.md` v roote | `docs/sessions/NEXT.md`, `docs/architecture/`                             |
| vlastná ADR kostra                   | `docs/decisions/template.md`                                              |
| `npm run test`                       | `pnpm test` (turbo)                                                       |
| i18n SK/CS/EN povinné                | žiadne i18n neexistuje                                                    |
| —                                    | navyše REUSE 3.3, DCO signoff, generované `openapi.json` a `api-types.ts` |

Git flow zapísaný podľa rozhodnutia: maintainer commituje priamo do `main`,
externí prispievatelia cez vetvu a PR podľa `CONTRIBUTING.md`. Do `CLAUDE.md`
šli aj dve pasce z prvej dnešnej session — že `response` schéma je zároveň
runtime serializér, a commitlint `footer-leading-blank`.

## Audit — štyri nálezy, dva opravené hneď

### 1. `.env.example` sa rozišiel s `config.ts` — **opravené**

Zdroj pravdy je Zod schéma v `apps/api/src/plugins/config.ts`. Starý
`.env.example` mal kľúče, ktoré schéma nepozná (`API_PORT`, `JWT_SECRET`,
`STORAGE_*`, `MCP_*`, `OTEL_*`, `MAIL_SMTP_*`) a **nemal** kľúče, ktoré
vyžaduje: `PORT`, `MIGRATIONS_SECRET`, `CRON_SECRET`, `WEBAUTHN_*`,
`MFA_SECRET_ENCRYPTION_KEY`, `OAUTH_*`, `ENABLE_SWAGGER`,
`FRONTEND_BASE_URL`. Chýbal aj `BLOB_READ_WRITE_TOKEN` a všetky
`NEXT_PUBLIC_*`. Navyše mal porty naopak (web 3000, API 3001), zatiaľ čo
realita je API 3000 a web 3001.

Prepísaný proti schéme, každý kľúč má označené, či je povinný, alebo bez
čoho endpoint vracia 503. Overené skriptom, ktorý porovná množinu kľúčov
zo `config.ts` s množinou v `.env.example` — rozdiel sú už len tri
odvodené polia z `ResolvedConfig`, ktoré env premenné nie sú.

### 2. Prílohy nejdú do MinIO/S3, ale do Vercel Blob — **opravené v dokumentácii**

`STORAGE_PROVIDER=minio` v `.env.example` vyzeralo ako aktívna
konfigurácia. Realita: `modules/attachments/attachments.routes.ts`
používa `@vercel/blob` (`put`/`del`), token `BLOB_READ_WRITE_TOKEN`
(ADR-0028). `STORAGE_*` nečíta nikto. Premenné vypadli, Vercel Blob je
zdokumentovaný.

MinIO kontejner v `infra/docker-compose.yml` **zostal** — spúšťa sa, ale
appka ho nepoužíva. Nechať alebo vyhodiť je samostatné rozhodnutie,
otvorený bod v `NEXT.md`. `MINIO_ROOT_USER/PASSWORD` musia v `.env.example`
zostať, lebo ich vyžaduje samotný compose.

### 3. OpenAPI dokument mal staré domény — **opravené**

`plugins/swagger.ts` malo v `servers` `https://api.inventario.sportup.sk`
s popisom „Production (planned Q3 2026)", v `externalDocs`
`docs.inventario.sportup.sk` a v `contact` `inventario@sportup.sk`.
Produkcia beží na `*.inventario.estate` (`infra/vercel/DNS-SETUP.md`) a je
live, nie plánovaná na Q3.

Pri oprave vyšla najavo pasca: **poradie v `servers` nie je kozmetika** —
Swagger UI berie prvý server ako predvolený cieľ pre „Try it out". Keby
bola produkcia prvá vždy, pokusný request z lokálneho `/docs` by šiel na
produkčné API. Poradie je preto podmienené: lokálne prvý `localhost`,
v produkcii a pri exporte dokumentu (`EXPORT_ONLY=true`) prvá produkcia.

`apps/web/src/middleware.ts` drží `app.inventario.sportup.sk`
v `CANONICAL_HOSTS` **vedome** ako druhý kanonický host — to nie je
pozostatok a nemenilo sa.

### 4. Štvrťročný DR test je po termíne — **ops, neopravené kódom**

Posledný záznam v `docs/compliance/dr-test-log.md` je DR Test #1
z 2026-05-23 (PASS, restore < 1 min, 53/53 smoke testov). Kadencia podľa
`disaster-recovery-plan.md` je štvrťročná, čo znamená, že ďalší je po
termíne. Flex tier navyše neumožňuje restore do nového clustera, takže
test #1 išiel do dev clustera — ten je medzitým určený na zmazanie, takže
pred ďalším testom treba vyriešiť, kam sa restore urobí. Zapísané do
`NEXT.md`, sekcia ops.

## Nefungovalo / zamietnuté

- **Inline SPDX hlavička v `ARCHITECTURE.md`.** `reuse 6.2.0` ju neuznal,
  hoci bola bajt na bajt rovnaká ako v `CLAUDE.md` a `RUNBOOK.md`, ktoré
  prešli. Bisekcia po riadkoch: `head -39` prešlo, `head -40` už nie —
  príčinu som nenašiel. Riešenie je aj tak správnejšie: root dokumenty
  (`README`, `CHANGELOG`, `CONTRIBUTING`, …) majú licenčnú metadata
  v `REUSE.toml`, nie inline. Všetky tri nové súbory sú tam teraz tiež
  a `reuse lint` je zelený (708/708).
- **Root `ARCHITECTURE.md` ako druhý high-level prehľad** — zamietnuté,
  `docs/architecture/README.md` to už má. Duplikát by sa rozišiel.
- **Zavedenie i18n** — zamietnuté ako súčasť tejto session. Nie je to
  commit, je to ADR (viď nižšie).

## i18n — v pláne, nie v kóde

Dnes žiadne i18n nie je, texty sú v komponentoch natvrdo po slovensky.
Platforma je white-label a multi-tenant, takže prvý český alebo anglický
tenant to otvorí. Do `NEXT.md` šiel zoznam vecí, ktoré treba rozhodnúť
**pred** prvým riadkom kódu: knižnica a routing, odkiaľ sa berie locale,
fallback na slovenčinu (nikdy na kľúč), a — najmenej zrejmé — **čo s textami
z API**: chybové `message` z `error-handler.ts` a e-mailové šablóny sú tiež
používateľské texty. Ak sa majú prekladať na klientovi, `error` sa musí
stať enumom, čo je zmena kontraktu chybovej odpovede, ktorý sme zjednotili
dnes ráno.

Do `CLAUDE.md` šlo pravidlo, že sa i18n knižnica nezavádza a texty sa
nerozbíjajú do kľúčov, kým nevznikne ADR.

## Dva nálezy dorazené po schválení

### `NEXT_PUBLIC_*` chýbali v `turbo.json`

Neboli ani v `globalEnv`, ani v `tasks.build.env` (tam je len `NODE_ENV`).
Next.js ich zapeká do buildu, takže po zmene `NEXT_PUBLIC_API_BASE_URL`
mohlo Turborepo vrátiť cache hit so **starou** hodnotou — a nikto by si
nevšimol, prečo appka volá iné API. Doplnené do `globalEnv`:
`NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_CANONICAL_APP_URL`,
`NEXT_PUBLIC_APPLE_ENABLED` (43 premenných celkom).

### MinIO vyhodený z lokálnej infraštruktúry

`infra/docker-compose.yml` spúšťal `minio` + `minio-setup` (porty 9000
a 9001, volume `sfz-minio-data`) a `minio-setup` pri každom štarte
vytváral buckety `sfz-asset-attachments` a `sfz-asset-protocols` — ktoré
zostávali prázdne, lebo žiadny kód MinIO nepoužíva. Object storage ide
cez Vercel Blob (ADR-0028).

Von šli: obe služby, volume, `MINIO_ROOT_*` z `.env.example`, zmienky
v `README.md` a `infra/README.md`. Lokálne prostredie je o dva kontejnery
menšie. YAML overený `yaml.safe_load` — zostali `mongodb`,
`mongo-express`, `mailhog` a dva mongo volumes.

Pozostatok, ktorý som **nechal**: `Attachment.bucket` je stále enum
`'sfz-asset-attachments' | 'sfz-asset-protocols'` (hodnota sa zapisuje
natvrdo) a `storageKey` nesie celú URL, nie kľúč. Zjednotenie je zmena
schémy v `shared-types` plus migrácia existujúcich dokumentov — otvorený
bod v `NEXT.md`.
