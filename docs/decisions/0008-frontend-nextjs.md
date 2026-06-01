<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0008. Next.js 15 + shadcn/ui ako frontend stack

|                   |                                                                                                                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | ✅ Accepted                                                                                                                                                                                                 |
| **Dátum**         | 2026-05-17 (Slice #4 — Frontend bootstrap)                                                                                                                                                                  |
| **Autori**        | Ján Letko, Claude Sonnet 4.6 (LTK Solutions)                                                                                                                                                                |
| **Súvisiace ADR** | [0001 Monorepo](0001-monorepo-pnpm-turbo.md), [0006 OpenAPI kontrakt](0006-openapi-contract.md), [0010 Multi-tenant](0010-multi-tenant-white-label.md), [0013 Auth](0013-multi-provider-auth-self-serve.md) |

## Kontext

Projekt potrebuje frontend aplikáciu (`apps/web`) ktorá:

- Konzumuje REST API backendu (Fastify, ADR-0009) s plnou typovou bezpečnosťou.
- Podporuje multi-tenant white-label model (ADR-0010) — každý tenant na vlastnej subdoméne,
  branding z tenant konfigurácie.
- Funguje s Entra ID SSO + email auth + passkeys (ADR-0013/0016) — auth flow cez cookies
  (nie client-side token store).
- Je deployovateľná na Vercel bez konfiguračnej záťaže (monorepo workspace, ADR-0001).
- Spĺňa WCAG 2.1 AA pre cieľový segment (verejný sektor, EÚ smernica 2016/2102).

## Rozhodnutie

**Next.js 15** (App Router) + **Tailwind CSS 4** + **shadcn/ui** + **TanStack Query v5**.

### Prečo Next.js 15 (App Router)

- **Vercel-native** — nulová konfigurácia pre deployment; Edge Runtime pre middleware
  (tenant routing podľa subdomény).
- **App Router** (nie Pages) — Server Components pre prvé načítanie bez klient-side
  waterfalls; Route Handlers ako BFF proxy ak treba.
- **TypeScript first** — `strict` tsconfig, `exactOptionalPropertyTypes: true` (konzistentné
  s backendom).
- Alternatívy (Remix, SvelteKit, Nuxt) boli zvážené — Next.js má najširšiu kompatibilitu
  s shadcn/ui ekosystémom a najjednoduchší Vercel deployment.

### Prečo shadcn/ui

- **Nie knižnica, ale kópiované komponenty** — `npx shadcn@latest add button` skopíruje
  komponent do `src/components/ui/`; plná kontrola nad kódom, žiadna verzia-lock.
- Tailwind-natívne — komponenty sú Tailwind triedy, nie CSS moduly; konzistentné s
  design tokens systémom projektu.
- Accessibility first — každý komponent je postavený na Radix UI primitívach
  (ARIA, keyboard navigation, focus management).

### Prečo TanStack Query

- Server-state management pre API volania — caching, background refetch, optimistic updates.
- Separácia server-state (TanStack Query) od client-state (React state / Zustand ak treba).
- `useIsFetching()` pre `RouteProgressBar` (globálny loading indikátor).

### HTTP klient

`openapi-fetch` + `openapi-typescript` generovaný z `apps/api/openapi.json` (ADR-0006).
Typovaný klient bez manuálnej duplikácie — ak backend zmení schema, frontend dostane
TypeScript chybu pri type-checku.

### Auth model

Auth funguje cez `httpOnly` cookies nastavené backendom — frontend **nikdy nevidí**
JWT ani refresh token v JavaScript kontexte. `/api/me` alebo `GET /v1/auth/me` overí
session; expired cookie → redirect na `/login`. Cookie domain je `*.inventario.estate`
(cross-subdomain) pre multi-tenant SaaS, konfigurovaný cez `COOKIE_DOMAIN` env.

### Čo nie je v rozsahu

- **SSR pre tenant data** — väčšina stránok je autentifikovaná, teda CSR (Client Components)
  s TanStack Query. Server Components sa používajú len pre statický shell (layout, nav).
- **i18n** — slovenčina je jediný jazyk v MVP; Next.js i18n routing je pripravený ale
  nevyužitý.

## Dôsledky

- `apps/web` je Next.js 15 App Router aplikácia v pnpm workspace; Turborepo pipeline
  zahŕňa `build`, `typecheck`, `lint`.
- Vercel detekuje Next.js automaticky z `apps/web/` cez monorepo root detection.
- `apps/web/src/lib/api-types.ts` a `api-client.ts` sú generované/config súbory —
  nie upravovať ručne.
- Všetky UI komponenty v `src/components/ui/` sú shadcn/ui kópie — upgrady cez
  `npx shadcn@latest add --overwrite <component>`, nie cez npm.

## Referencie

- [Slice #4 milestone](../milestones/slice-4-frontend-web.md)
- [ADR-0006 OpenAPI kontrakt](0006-openapi-contract.md) — zdroj typov pre frontend klient
- [ADR-0013 Multi-provider auth](0013-multi-provider-auth-self-serve.md) — auth flow ktorý frontend implementuje
- [apps/web/src/](../../apps/web/src/) — implementácia
