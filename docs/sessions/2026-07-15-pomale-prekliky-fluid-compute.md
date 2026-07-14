<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-07-15 — pomalé prekliky Používatelia → detail → majetok

## Kontext

Janika nahlásila hneď po nasadení detail+editácie používateľa (viď
`docs/sessions/2026-07-14-detail-editacia-pouzivatela.md`): klikanie
Používatelia → detail používateľa → detail majetku je pri každom prekliku
pomalé (2s+), tretí klik (na majetok) trval vyše 10 sekúnd.

## Diagnostika

Vercel runtime logy (`get_runtime_logs`) pre presné ID, na ktoré klikala,
ukázali, že backend samotný nie je pomalý — spracovanie requestu vnútri
Fastify trvalo 280–970 ms:

- `GET /v1/users/:id` — 375 ms
- `GET /v1/loans?borrowerId=...` — 966–969 ms
- `GET /v1/assets/:id` — 282 ms
- `GET /v1/assets/:id/attachments` — 377 ms
- `GET /v1/assets/:id/qr` — 585 ms

Žiadne z toho nevysvetľuje 2–10 sekúnd. Príčina je v **počte súbežných
volaní na stránku**:

- Detail používateľa → 2 súbežné volania (`/v1/users/:id` + `/v1/loans`)
- Detail majetku → 3 súbežné volania (`/v1/assets/:id` + `/attachments` + `/qr`)

Vercel serverless funkcia (bez Fluid Compute) obslúži na jednej teplej
inštancii len jeden request naraz. Náš predošlý fix (Cron ping na
`/health/ready` každé 4 min, z 2026-07-14) drží teplú len ~1 inštanciu —
pri 2–3 súbežných požiadavkách sa časť z nich presmeruje na studený štart
(Node boot + Mongo TLS handshake + plugin chain), čo sa vôbec neukáže vo
Fastify `responseTime` (ten beží až po naštartovaní funkcie). Presne preto
to naberá na intenzite s každým ďalším preklikom — viac súbežných volaní =
vyššia šanca na studený štart niektorého z nich.

**MongoDB indexy — overené, NIE sú dnes príčinou:** `explain()` na
`GET /v1/loans?borrowerId=...&sort=createdAt desc` v produkcii ukázal
`COLLSCAN` (nie index seek) — existujúci index
`organisationId_status_borrowerId_dueAt` má `status` pred `borrowerId`,
takže borrower-only dopyt (bez `status`) ho nevie použiť ako seek, a triedi
podľa `dueAt`, nie `createdAt`. Pri dnešnom objeme dát (~6 záznamov výpožičiek
v produkcii) je to neškodné (`executionTimeMillis: 1`), ale je to reálna
medzera, ktorá by sa s rastúcim objemom prejavila. Opravené (viď nižšie),
keďže presne tento query pattern zaviedla nová stránka `/users/[id]`.

## Riešenie (podľa Janikinho výberu: Fluid Compute + optimalizácia indexov)

### 1. Vercel Fluid Compute

`apps/api/vercel.json`: pridané `"fluid": true` na top-level. Toto je
per-deployment nastavenie (Vercel changelog, 2026-10-02) — nevyžaduje zásah
v dashboarde, stačí commit + deploy. Fluid Compute umožňuje jednej inštancii
obslúžiť viacero súbežných requestov naraz (namiesto jedného na inštanciu),
čím sa súbežné volania na jednu stránku (2–3 pri detaile používateľa/majetku)
prestanú navzájom posielať na studené štarty.

Poznámka: `functions."api/index.ts".memory` v `vercel.json` ostáva
nastavené na `1024` — pri zapnutom Fluid Compute sa `memory` podľa
dokumentácie nastavuje cez dashboard (Project → Settings → Functions),
`vercel.json` hodnota môže byť ignorovaná. Ak by bolo treba memory doladiť,
je to teraz krok v dashboarde, nie v kóde.

### 2. Nový MongoDB index

`apps/api/src/modules/loans/loans.repository.ts`, `ensureIndexes()`:
nový index `organisationId_borrowerId_createdAt`
(`{ organisationId: 1, borrowerId: 1, createdAt: -1 }`) — presne pokrýva
query pattern novej stránky (`borrowerId` filter + `createdAt desc` sort)
priamym index seekom bez in-memory sortu. Vytvorí sa automaticky pri
najbližšom nábehu API (idempotentné `ensureIndexes()` beží pri každom
štarte, rovnaký vzor ako existujúce indexy).

`tsc --noEmit`, `eslint`, `prettier --check` čisté v sandboxe.

## Čo zostáva

Subjektívne overiť o pár dní, či sa prekliky Používatelia → detail →
majetok citeľne zrýchlili. Ak nie, ďalší krok (zámerne odložený, viď
`docs/sessions/2026-07-14-pomaly-preloader-po-necinnosti.md`): obmedziť
`GlobalFetchOverlay` len na kritické requesty namiesto blokovania celej
obrazovky pri každom paralelnom volaní.
