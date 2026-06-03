# NEXT — aktuálny stav + ďalší krok

Posledná session: docs/sessions/2026-06-03-post-deploy-fixes.md
(ADR-0030 D1-D7 kompletný + CI fixes)

## Aktuálny stav

Production LIVE. ADR-0030 Accepted + implementovaný (D1-D7).
Vercel build zelený (commit 1ab4477).

Registračná stránka:

- 4 provider buttons (Google / Apple / Microsoft / E-mail), grid 2x2
- Label zmenený: Kontaktný e-mail → Fakturačný e-mail organizácie

Admin UI /settings/auth:

- allowedAuthProviders, memberJoinPolicy, autoJoinDomains, entraTenantId

Apple Sign-In: stub routes (503). Aktivuje sa po Apple Developer enrollment LTK Solutions.

## Ďalší krok

Fáza 0 SFZ pilot onboarding:

1. Otvoriť app.inventario.estate/register — otestovať registráciu vlastného org
2. Skontrolovať /settings/auth — nové UI Prihlasovanie a domény
3. Pozvať SFZ keď bude organizačne pripravené

## Na horizonte (v TODO.md)

- P1 tech-debt: memberships partial index (partialFilterExpression: { deletedAt: null })
- ADR-0029 K8 — replikácia shared-types do SFZ Asset-Management repa
- ADR-0028 B1-B10 — per-tenant branding implementácia
- ADR-0015 Slice #9 K1-K4 — cross-tenant memberships impl
- Forced MFA smoke-test s kolegom
- Pre-go-live blocky (legal review, Atlas allowlist, DR test, pentest)
- Apple Sign-In aktivácia (po Apple Developer approval)
