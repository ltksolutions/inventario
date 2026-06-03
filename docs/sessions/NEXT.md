# NEXT — aktuálny stav + ďalší krok

Posledná session: `docs/sessions/2026-06-03-post-deploy-fixes.md` (rejoin invite fix)

## Aktuálny stav

Production LIVE ✅. Posledný hotfix: rejoin invite E11000 → 500 opravený.
Pozvánka pre jan.letko@icloud.com do LTK Solutions je stále PENDING (expiruje 10.6.)
— po deployi Vercel kliknúť na link v e-maili a prijať.

## Ďalší krok

Fáza 0 SFZ pilot onboarding — otestovať vlastnú registráciu pred pozvaním SFZ:

1. Kliknúť na link v e-maili a prijať pozvánku do LTK Solutions (verifikácia hotfixu)
2. Následne ADR-0022 K5–K8 alebo ADR-0029 K8 podľa priority

## Na horizonte (v TODO.md)

- **P1 tech-debt:** Unique index `memberships_userId_organisationId_unique` → pridať
  `partialFilterExpression: { deletedAt: null }` (migrácia + reindex na prod)
- ADR-0029 K8 — replikácia shared-types zmien do SFZ Asset-Management repa
- ADR-0028 B1–B10 — per-tenant branding implementácia
- ADR-0015 Slice #9 K1–K4 — cross-tenant memberships impl
- Forced MFA smoke-test s kolegom
- Pre-go-live blocky (legal review, Atlas allowlist, DR test, pentest)
