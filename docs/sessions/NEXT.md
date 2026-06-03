# NEXT — aktuálny stav + ďalší krok

Posledná session: `docs/sessions/2026-06-03-adr-0029-single-role.md`

## Aktuálny stav

**ADR-0029 (single hierarchical role) — K1–K7 DONE, čaká na Janíku:**

Všetky kódové zmeny zapísané na disk. Janika musí spustiť:

```bash
pnpm --filter @inventario/shared-types build
pnpm --filter @inventario/api openapi:export:offline
# regen apps/web/api-types.ts z nového OpenAPI
pnpm typecheck
pnpm test
```

Ak niečo padne → pošlite výstup, opravím.

## Ďalší krok (po zelených testoch)

1. **Commit + push** (GitHub Desktop): `feat: single hierarchical role per membership (ADR-0029)`
2. **K8** — replikácia do SFZ Asset-Management repa (shared-types zmeny)
3. **Tech-debt (TODO P2)**: `users.service.ts` — PATCH /v1/users/:id je zastaraný
   (správa rolí = PATCH /v1/memberships/:id); premigrovat alebo odstraniť pred GA

## Na horizonte (v TODO.md)

- ADR-0022 K5–K8 (loan protocol PDF gen) — ďalší blok
- ADR-0027 (QR label printing — Avery PDF + ZPL)
- ADR-0015 Slice #9 K1–K4 (cross-tenant memberships impl)
- SFZ pilot onboarding (self-serve registration test)
- Forced MFA smoke-test s kolegom
- Pre-go-live blocky (legal review, Atlas allowlist, DR test, pentest)
