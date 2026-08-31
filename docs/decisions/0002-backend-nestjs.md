# 0002. NestJS ako backend framework

|                   |                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| **Status**        | 🚫 Superseded by [ADR-0009](0009-backend-fastify.md) (máj 2026)                                          |
| **Dátum**         | máj 2026                                                                                                 |
| **Autori**        | tím SFZ Asset Management                                                                                 |
| **Súvisiace ADR** | [0001-monorepo-pnpm-turbo](0001-monorepo-pnpm-turbo.md), [0009-backend-fastify](0009-backend-fastify.md) |

> **⚠️ Toto rozhodnutie bolo zmenené.** Pôvodne sme zvolili NestJS, ale ešte pred začiatkom implementácie sme rozhodnutie revidovali v prospech Fastify. Dôvody sú popísané v [ADR-0009](0009-backend-fastify.md). Tento dokument zachovávame pre historickú kontinuitu a transparentnosť rozhodovacieho procesu.

## Kontext

Potrebujeme zvoliť backend framework pre `apps/api`. Požiadavky:

- TypeScript (zdieľanie typov s frontendom).
- OpenAPI 3.1 generovaná zo zdrojového kódu (single source of truth).
- Dobrý ekosystém pre RBAC, validáciu, integráciu s MongoDB.
- Štandardná štruktúra projektu – aby noví vývojári vedeli rýchlo naskočiť.
- Podpora pre integráciu s Microsoft Entra ID (OIDC).
- Strednodobá udržateľnosť (3–5 rokov).
- Schopnosť rásť spolu s projektom (DI, modularita).

## Možnosti

### Možnosť A: NestJS (zvolené)

Modulárny TypeScript framework inšpirovaný Angularom (decorators, DI). Built-in podpora pre OpenAPI, validáciu, guards, interceptors.

- **Plus:** "Batteries included" – validácia (class-validator), OpenAPI generátor (`@nestjs/swagger`), guards pre auth, interceptors pre logging, modulárna architektúra.
- **Plus:** TypeScript-first, výborná IDE podpora.
- **Plus:** Veľká komunita, dobre udržiavaný (Trilon), Angular-style architektúra je dobre známa.
- **Plus:** Oficiálne moduly pre MongoDB (Mongoose), JWT, Passport (OIDC), Bull (queue).
- **Plus:** Štandardná štruktúra `module → controller → service → repository` – noví vývojári hneď vedia, kde čo hľadať.
- **Mínus:** Vyššia úvodná réžia (boilerplate decorators).
- **Mínus:** Hlavičkový framework – musíme akceptovať jeho konvencie.

### Možnosť B: Fastify + manuálna štruktúra

Rýchly minimalistický HTTP framework, k tomu manuálne vyberieme knižnice pre validáciu, auth, atď.

- **Plus:** Najvyšší performance (~50k req/s vs ~25k pre NestJS).
- **Plus:** Plná kontrola, žiadne nútené konvencie.
- **Mínus:** Veľa rozhodnutí na nás (auth, OpenAPI gen, štruktúra) – každý projekt iný.
- **Mínus:** Manuálne zladenie validačnej knižnice + OpenAPI gen + DI kontajneru je práca, ktorú NestJS dá zadarmo.
- **Mínus:** Onboarding nových ľudí je dlhší – nemajú „intuitívnu" navigáciu.

### Možnosť C: Express + manuálna štruktúra

Klasika, ale zastarané.

- **Plus:** Najznámejší framework.
- **Mínus:** Nie je TypeScript-first, performance horší, ekosystém starnúce.
- **Mínus:** Rovnaké mínusy ako Fastify (manuálna integrácia), bez výhody rýchlosti.

### Možnosť D: Next.js full-stack (API routes)

Backend ako súčasť `apps/web`.

- **Plus:** Jeden codebase pre FE + BE, jeden deploy.
- **Plus:** Skvelé DX pre prototypovanie.
- **Mínus:** Nie je vhodný pre dlhodobý komplexný backend – chýba modulárna architektúra, queue management, pokročilejšie patterns.
- **Mínus:** Backend by sa zviazal s frontend release cyklom.
- **Mínus:** Ťažšie deployovať backend nezávisle (škálovanie, security boundaries).

### Možnosť E: Encore / tRPC / Hono

Moderné alternatívy. Pre náš case:

- **tRPC:** výborné pre TS-only stack, ale chýba podpora pre Flutter klienta (Dart nevie tRPC) – diskvalifikované.
- **Hono:** veľmi rýchly, ale mladý a chudobný ekosystém.
- **Encore:** vendor-lock, neopen platform – diskvalifikované.

## Rozhodnutie

Zvolili sme **NestJS (Možnosť A)**.

Hlavné dôvody:

1. **OpenAPI 3.1 generovanie** zo zdrojového kódu funguje out-of-the-box (`@nestjs/swagger`) – kritické pre nás, lebo z OpenAPI generujeme TS klienta aj budúceho Flutter klienta.
2. **Štandardná štruktúra** – noví prispievatelia open-source projektu vedia hneď, kde čo hľadať.
3. **Modulárna architektúra** s DI – ľahšie testovanie, refactoring, jasné rozhraní medzi modulmi (Asset, Loan, User, Auth, ...).
4. **Built-in guards** pre RBAC + Entra ID integrácia cez `@nestjs/passport` + `passport-azure-ad` (alebo modernejšie `@azure/msal-node`).
5. **Performance** – pre náš odhadovaný load (100-500 paralelných používateľov) je NestJS výrazne dostatočný; nepotrebujeme extrémny throughput Fastify.

## Dôsledky

### Pozitívne

- Rýchlejší onboarding nových vývojárov (NestJS dokumentácia + štandardné patterns).
- OpenAPI sa generuje automaticky – nikdy out-of-sync.
- Konzistentná štruktúra naprieč modulmi.
- Bohatý ekosystém oficiálnych modulov (`@nestjs/mongoose`, `@nestjs/bull`, `@nestjs/throttler`, `@nestjs/cache-manager`).

### Negatívne / kompromisy

- Mierne vyšší boilerplate ako Fastify alebo plain Express.
- Performance ceiling ~25-30k req/s. Pre náš scale je toto irrelevant, ale zaznamenávame.
- Decorators + reflection – v zriedkavých prípadoch ťažšie pre static analysis.

### Riziká, ktoré treba sledovať

- Major version bumpy NestJS (z v10 na v11, ...) – treba ich prečítať pred upgrade a otestovať. NestJS má slušnú backward compat, ale občas sú breaking changes v guard/decorator API.

## Implementačné poznámky

- **Validácia:** Zod cez `nestjs-zod` (jednotná validácia request/response, zdieľaná so schémami v `packages/shared-types/`).
- **MongoDB:** natívny `mongodb` driver + vlastný Repository pattern, **bez Mongoose** – viď [ADR-0005](0005-mongo-native-driver.md).
- **OpenAPI:** `@nestjs/swagger` + `nestjs-zod`. Spec sa vygeneruje do `docs/api/openapi.yaml` cez CLI skript pri builde.
- **Auth:** `@nestjs/passport` + `passport-azure-ad` pre Entra ID OIDC. JWT refresh tokeny vlastné cez `@nestjs/jwt`.
- **Konfigurácia:** `@nestjs/config` so Zod validáciou env premenných.
- **Logy:** `nestjs-pino` (Pino je rýchlejší a štruktúrovanejší než Winston).
- **Queue (notifikácie):** `@nestjs/bullmq` + Redis.

## Referencie

- [NestJS dokumentácia](https://docs.nestjs.com/)
- [nestjs-zod](https://www.npmjs.com/package/nestjs-zod)
- [NestJS performance comparison](https://github.com/fastify/benchmarks)
