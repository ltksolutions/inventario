# NEXT — aktuálny stav + ďalší krok

Posledná session: docs/sessions/2026-06-03-post-deploy-fixes.md
(ADR-0030 D1-D7 kompletný)

## Aktuálny stav

Production LIVE. ADR-0030 Accepted + implementovaný:

- D1 Apple Sign-In backend (stub routes, form_post callback, provisioning)
- D2 entraTenantId reštrikcia (tid z id_token, nie Graph /me)
- D3 admin UI Prihlasovanie a domény (PATCH /v1/organisations/current)
- D4 registračná obrazovka — 4 neutrálne možnosti (Google/Apple/Microsoft/E-mail)
- D5 SFZ migrácia — no-op (prod DB je už na správnom modeli)
- D6 testy (D2+D3 pokrytie)
- D7 docs (ADR-0004 superseded, ADR-0030 Accepted, session/NEXT/TODO)

## Ďalší krok

Fáza 0 SFZ pilot onboarding — teraz je čas otestovať vlastnú registráciu:

1. Otvoriť app.inventario.estate/register — overiť že 4 provider buttons sú viditeľné
2. Zaregistrovať testovací org cez e-mail alebo Google
3. Skontrolovať /settings/auth — nové UI Prihlasovanie a domény
4. Pozvať SFZ (keď bude organizačne pripravené)

Apple Sign-In bude plne funkčný po schválení Apple Developer enrollmentu
(LTK Solutions enrollment in progress). Vtedy doplniť env vars do Vercel.

## Na horizonte (v TODO.md)

- P1 tech-debt: memberships partial index (partialFilterExpression: { deletedAt: null })
- ADR-0029 K8 — replikácia shared-types do SFZ Asset-Management repa
- ADR-0028 B1–B10 — per-tenant branding implementácia
- ADR-0015 Slice #9 K1–K4 — cross-tenant memberships impl
- Forced MFA smoke-test s kolegom
- Pre-go-live blocky (legal review, Atlas allowlist, DR test, pentest)
