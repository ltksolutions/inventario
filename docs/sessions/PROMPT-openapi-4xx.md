<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Prompt pre novú session — chybové odpovede v OpenAPI

> Skopíruj celý blok nižšie ako prvú správu novej session.

---

## Zadanie

V repozitári `inventario` (vetva `main`, lokálne cez git MCP) dorieš
posledné dva otvorené body OpenAPI lintu. Redocly je aktuálne **bez
chýb**, ale hlási **103 warningov**:

- `operation-4xx-response` (95) — schémy popisujú len 2xx odpovede
- `no-ambiguous-paths` (4) — `/v1/assets/tags/*` vs `/v1/assets/{id}/*`

Cieľ: dokumentácia API má popisovať aj chybové odpovede, aby sa integrátor
z nej dozvedel, čo dostane pri 400/401/403/404. Job `openapi` v
`.github/workflows/docs.yml` už **nemá** `continue-on-error` — stráži naostro.

## Stav, z ktorého vychádzaš (zmerané 2026-09-01, netreba znovu objavovať)

- **100 operácií**, z toho **97 nemá žiadnu 4xx/5xx odpoveď** v schéme.
  Rozloženie kódov dnes: 200 (78), 201 (11), 204 (11), 404 (2), 400 (1),
  503 (1).
- Chybové odpovede rieši centrálne `apps/api/src/plugins/error-handler.ts`.
  Tvar tela je jednotný:

  ```jsonc
  { "statusCode": 404, "error": "NotFound", "message": "Asset not found: 6a…" }
  // voliteľne "details": {...}
  // pri Zod validácii navyše "issues": [{ path, message, code }]
  ```

  `error` vzniká ako `error.name.replace(/Error$/, '')` — teda
  `NotFound`, `BadRequest`, `Unauthorized`, `Forbidden`.

- Chybové triedy a početnosť použitia v kóde:
  `BadRequestError` 166×, `NotFoundError` 93×, `UnauthorizedError` 57×,
  `ForbiddenError` 17×, `HttpError` (priamo) 6×. `ConflictError`
  neexistuje.

## ⚠️ Pasca, na ktorú si dávaj pozor

`server.ts` registruje `serializerCompiler` z `fastify-type-provider-zod`.
To znamená, že **response schéma nie je len dokumentácia — Fastify podľa
nej odpoveď serializuje** a `z.object()` bez `.passthrough()` neznáme
kľúče **zahodí**.

Dôsledok: naivné dopísanie `response: { 404: NieČoSchema }` **zmení
runtime správanie API**, nielen dokumentáciu.

Existujúci dôkaz, že to už raz nastalo — over ho ako prvý krok:
`src/modules/organisations/public-login-context.routes.ts` a
`src/modules/assets/public-assets.routes.ts` majú lokálne
`const NotFoundSchema = z.object({ message: z.string() })`. Ak tá schéma
platí, tie dva endpointy dnes pri 404 vracajú iba `{ message }` namiesto
`{ statusCode, error, message }` — teda **nekonzistentne so zvyškom API**.
Over to integračným testom (skutočný request → skutočná odpoveď), nie
čítaním kódu.

## Postup, ktorý dáva zmysel

1. **Najprv over pascu.** Napíš integračný test, ktorý zavolá endpoint s
   existujúcou 404 schémou a porovná telo s tým, čo vracia endpoint bez
   nej. Podľa výsledku sa rozhodne, či ide o opravu chyby alebo len o
   doplnenie dokumentácie.
2. **Jedna zdieľaná schéma chybovej odpovede**, ktorá presne zodpovedá
   `error-handler.ts` (vrátane voliteľných `details` a `issues`). Umiestni
   ju tam, kde ju uvidia všetky moduly (napr. `src/lib/`), a nahraď ňou
   obe lokálne `NotFoundSchema`.
3. **Doplň chybové odpovede podľa toho, čo route naozaj vyhadzuje** — nie
   plošne všetkým rovnaké. Vodidlo: `requireAuth` → 401,
   `requireRole`/`requireMinRole` → 403, `params`/`body` validácia → 400,
   `NotFoundError` v handleri → 404. Nevymýšľaj kódy, ktoré endpoint
   nevracia; radšej si ich over v kóde handlera.
4. **Zváž, či to nejde bez zásahu do 97 rout.** `@fastify/swagger` má
   `transform` aj `transformObject` (obidva sa v `plugins/swagger.ts` už
   používajú — `operationId` a prevod na 3.1). Doplniť spoločné chybové
   odpovede do dokumentu v `transformObject` znamená **nulový vplyv na
   runtime serializáciu**, lebo to nie je Fastify response schéma. To je
   pravdepodobne správna cesta pre 401/403, ktoré sú dôsledkom
   `preHandler`, nie tela routy. Rozhodni sa a odôvodni.
5. **`no-ambiguous-paths`** — `/v1/assets/tags`, `/v1/assets/tags/delete`,
   `/v1/assets/tags/rename`, `/v1/assets/tags/summary` kolidujú tvarom
   s `/v1/assets/{id}/…`. V praxi ku kolízii nedochádza (druhé segmenty
   sa nezhodujú), ale Redocly to hlási. Oprava = premenovať endpointy =
   **breaking change API**, dotkne sa aj `apps/web`. Predlož to ako
   samostatné rozhodnutie s odhadom dopadu; **nerob to bez súhlasu**.

## Ako overuješ

```bash
# regenerácia dokumentu (openapi.json + docs/api/openapi.yaml naraz)
pnpm --filter @inventario/api openapi:sync

# lint tým istým nástrojom ako CI
npx @redocly/cli@latest lint docs/api/openapi.yaml

# testy
pnpm --filter @inventario/api test
```

Pozor: `openapi:sync` používa `EXPORT_ONLY=true` s in-memory MongoDB,
takže nepotrebuje prístup k Atlasu.

## Definition of Done

- `redocly lint` končí bez chýb **a bez warningov** `operation-4xx-response`
- runtime tvar chybových odpovedí je overený testom, nie odhadnutý —
  a je konzistentný naprieč API
- testy prechádzajú (aktuálne 1052), lint, prettier a typecheck čisté
- `NEXT.md`, `CHANGELOG.md` a session log aktualizované
- commity podľa konvencie; push až po dohode

## Kontext k prečítaniu

- `docs/sessions/2026-08-31-pomale-nacitanie-dashboardu.md` — session, po
  ktorej toto zostalo
- `apps/api/src/plugins/swagger.ts` — `operationId`, prevod na 3.1
- `apps/api/src/lib/openapi-3-1.ts` — prevod 3.0/draft-4 tvarov
- `apps/api/src/plugins/error-handler.ts` — zdroj pravdy o chybovom tvare
