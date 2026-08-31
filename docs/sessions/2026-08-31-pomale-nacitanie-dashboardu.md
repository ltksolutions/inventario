<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-08-31 — pomalé prvé načítanie dashboardu

## Kontext

Janika nahlásil: dashboard sa vykreslí rýchlo, ale dáta v ňom nie sú a
používateľ nemá spätnú väzbu, že sa niečo deje. Prvé načítanie dát trvá
okolo 10 sekúnd.

Kontext z predošlých session:

- `1c239e0` (17. 7.) odstránil `GlobalFetchOverlay` z GET requestov. Bola
  to správna oprava, ale odvtedy nie je čakanie ničím zakryté — 10 sekúnd
  vidno ako prázdny dashboard.
- `NEXT.md` mal tento scenár vedený ako otvorený bod („ak by sa vrátil
  pomalý preloader") s dvomi navrhovanými opatreniami.
- Janikina vstupná hypotéza: za pomalý štart môže Atlas **Flex** tier.

## Diagnostika

### Krok 1 — Atlas Flex sa pri nečinnosti nepauzuje

Overené: auto-pause pri nečinnosti má **M0**, nie Flex. „Spiaci cluster"
teda príčinou nie je. Flex ale zostáva zdieľaný tier a cenu prvého
spojenia (TLS handshake + SCRAM auth) platí naplno.

### Krok 2 — inštrumentácia boot fáz (commit `fe28df7`)

Pridaný `lib/boot-timing.ts` + marky v `server.ts`, rozpad connect/ping v
`plugins/mongo.ts`, celkový cold start v `api/index.ts`.

Lokálne meranie (in-memory Mongo, teda **nulová** sieťová latencia):

| fáza            |    ms |
| --------------- | ----: |
| foundation      |     4 |
| security        |    12 |
| mongo           |    13 |
| migrationsCheck |     0 |
| authPlugins     |   441 |
| swagger         |    45 |
| domainRoutes    | 1 387 |

`domainRoutes` = registrácia modulov, ktorej dominuje **18 sériových
`ensureIndexes()` volaní**. Lokálne stoja 1,4 s pri nulovej latencii; na
Atlase sa každé z nich platí sieťovým round-tripom.

### Krok 3 — meranie na produkcii (Resource Timing v prehliadači)

Kľúčové zistenie. Dve po sebe idúce načítania `app.inventario.estate` na
**teplej** inštancii:

```
načítanie #1:  /v1/auth/me            263 ms
               /v1/auth/refresh     1 241 ms   (sériovo za me)
               /v1/auth/me            568 ms   (druhé volanie po refreshi)
               /v1/dashboard/summary 2 429 ms  (štartuje až v 2 927 ms)
               → dáta na obrazovke po 5 356 ms

načítanie #2:  /v1/auth/me          1 024 ms
               /v1/dashboard/summary 2 872 ms
               → dáta na obrazovke po 4 023 ms
```

**Cold start nie je hlavná príčina.** Aj úplne teplá inštancia potrebuje
4–5,4 s. Cold start (boot ~1,8 s pri nulovej latencii, na Atlase viac) k
tomu len pripočíta — a vyjde nahlásených ~10 s.

### Krok 4 — prečo je `/v1/dashboard/summary` pomalý aj na teplo

`dashboard.routes.ts` spúšťa 9 operácií cez `Promise.all`. Lenže
`plugins/mongo.ts` mal **`maxPoolSize: 1`**, takže cez jediné spojenie
išli **sériovo** — každá s `readConcern: majority` na Flex replica sete.

Pôvodné odôvodnenie v komentári („serverless má 1 invoke = 1 request, pool
netreba") prestalo platiť zapnutím **Fluid Compute** (`b07cabc`): Fluid
posiela na jednu inštanciu viac súbežných requestov, takže pool veľkosti 1
je bottleneck aj medzi používateľmi navzájom.

K tomu `maxIdleTimeMS: 10_000` — spojenie sa zavrelo po 10 s nečinnosti,
takže aj na teplej inštancii sa TLS + SCRAM handshake platil prakticky pri
každom kliku používateľa.

## Zmeny (táto session)

### Fáza 0 — meranie (`fe28df7`)

- `apps/api/src/lib/boot-timing.ts` (nový), marky v `server.ts`,
  connect/ping rozpad v `plugins/mongo.ts`, cold start v `api/index.ts`.
- Súhrnný riadok „Boot timing" ide do logu vždy; podrobné per-fázové
  riadky len pri `BOOT_TIMING=1`.

### Fáza 1 — UX počas načítavania

- `components/PendingActionsPanel.tsx` — skeleton už nie je prázdny sivý
  obdĺžnik, ale drží skutočnú štruktúru panelu (nadpis „Čaká na vás",
  „Načítavam…", riadkové skeletony).
- `lib/useSlowLoadingHint.ts` (nový) — po 3 s načítavania sa pod panelom
  objaví veta „Prvé načítanie po dlhšej prestávke môže trvať niekoľko
  sekúnd." Pri rýchlom načítaní sa nezobrazí vôbec.
- `components/StatCard.tsx` — skeleton prefarbený zo `surface-subtle`
  (paper-50, na `surface-card` prakticky neviditeľný) na `border-subtle`.

### Fáza 2a — Mongo pool

- `plugins/mongo.ts` — `maxPoolSize` 1 → **10**, `maxIdleTimeMS` 10 s →
  **60 s**. `Promise.all` v dashboarde sa tým reálne zparalelizuje.

### Fáza 2c — cold start

- `lib/ensure-indexes.ts` (nový) — register indexov. Moduly volajú
  `ensureIndexesOnBoot(fastify, 'nazov', repo)` namiesto priameho
  `repo.ensureIndexes()`. V produkcii sa pri boote **nevytvárajú**; mimo
  produkcie (dev, testy, `EXPORT_ONLY`) sa správajú ako doteraz.
- `modules/system/indexes.routes.ts` (nový) — `POST /v1/system/indexes/ensure`,
  chránený `MIGRATIONS_SECRET`, rovnaký vzor ako migrácie (`00a2515`).
- `.github/workflows/migrate-on-deploy.yml` — nový krok volá tento
  endpoint po migráciách.
- `plugins/config.ts` — `ENABLE_SWAGGER` default je odvodený od
  `NODE_ENV`: v produkcii vypnuté. Verejné `/docs` na produkčnom API
  prestane existovať (Janika potvrdil); dokumentácia beží na
  `inventario-docs`. `ENABLE_SWAGGER=true` to vie kedykoľvek vrátiť.

## Overenie po deployi (31. 8., produkcia)

Rovnaké meranie, rovnaký prehliadač, teplá inštancia:

| request                 | pred         | po                 |
| ----------------------- | ------------ | ------------------ |
| `/v1/auth/me`           | 1 024 ms     | 528–532 ms         |
| `/v1/dashboard/summary` | 2 872 ms     | 1 122–1 136 ms     |
| **celkom k dátam**      | **4 023 ms** | **1 840–1 885 ms** |

`/v1/dashboard/summary` je **o 60 % rýchlejší**, celková cesta k dátam
**o 54 %**. Potvrdzuje to diagnózu: `Promise.all` sa zparalelizoval.

Vidno to aj na iných stránkach — `/assets` vypaľuje tri GETy
(`assets`, `categories`, `locations`) a všetky tri majú v Resource Timing
**rovnaký `startTime`** a dobiehajú v 1,18–1,35 s, teda naozaj bežia
súbežne, nie za sebou.

`/v1/auth/me` sa skrátil na polovicu bez toho, aby sme sa ho dotkli —
potvrdzuje domnienku, že bola tiež brzdená poolom veľkosti 1.

## Otvorené

1. ~~Overiť efekt na produkcii po deployi.~~ **Hotové, viď vyššie.**
2. **Fáza 2b — sériová auth reťaz.** Stále platí, ale je to už menší
   zisk: `/v1/auth/me` (0,53 s) blokuje štart dashboard query. Ak by sa
   dali spustiť súbežne, cesta k dátam by klesla z ~1,85 s na ~1,2 s.
   Otázka je, či to stojí za komplikáciu s obnovou vypršaného tokenu.

3. ~~`ENABLE_SWAGGER` vo Verceli.~~ **Uzavreté — Swagger v produkcii
   ostáva.** Projekt má premennú nastavenú explicitne (Production +
   Preview, 111 dní), takže prebíja nový default podľa `NODE_ENV` a
   `/docs` funguje ďalej. Ponechané vedome: pôvodný dôvod na vypnutie
   (~45 ms z cold startu) je po zrýchlení summary o 1,75 s zanedbateľný
   a Swagger nič neodhaľuje — repo je verejné aj s OpenAPI schémou.
   Nový default v `config.ts` ostáva ako poistka, keby premennú niekto
   odstránil.

## Dodatok — argon2 0.45.1 (31. 8.)

Dependabot PR #24 padal na typecheku kvôli `argon2` 0.45.1. Nie je to
falošný poplach, ale skutočná breaking change v typoch:

|             | 0.44             | 0.45                 |
| ----------- | ---------------- | -------------------- |
| typ options | `argon2.Options` | `argon2.HashOptions` |

`email-auth.routes.ts` mal `const ARGON2_OPTIONS: argon2.Options & { raw?: false }`.
V 0.45 sa `Options` nerozlíši, typ sa rozpadne a TypeScript potom vyberie
prvý overload `hash()` (ten s `raw: true`), ktorý vracia `Buffer` — odtiaľ
druhá chyba, `Buffer` do `passwordHash: string`.

Opravené bumpom na `^0.45.1` a zmenou typu na `argon2.HashOptions`;
`& { raw?: false }` netreba, bez `raw` sa trafí overload vracajúci
`string`. Ostatných šesť miest s argon2 (`registration.routes.ts`,
`invitations.routes.ts`, `mfa-crypto.ts`) používa inline objekt bez
explicitného typu a funguje v oboch verziách.

Bump musel ísť spolu s opravou — `HashOptions` v 0.44 neexistuje, takže
samotná oprava by rozbila build na aktuálnej verzii. Overené celou sadou:
1036 testov, vrátane auth, registrácie, pozvánok a MFA. 4. **Prvý deploy po tejto zmene** musí prebehnúť tak, aby workflow
`indexes/ensure` naozaj zbehol — v produkcii sa indexy pri boote už
nevytvárajú. Ak by workflow zlyhal, indexy ostanú v stave pred
deployom (existujúce sa nikam nestratia, len nové by nevznikli).
