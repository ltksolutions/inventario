# NEXT — aktuálny stav + ďalší krok

Posledná session: `docs/sessions/2026-06-03-post-deploy-fixes.md`
(users-list cross-tenant fix + ADR-0030)

## Aktuálny stav

Production LIVE ✅. Dnešné fixy nasadené a overené:

- rejoin invite E11000 → 500 opravený (reactivate membership)
- GET /v1/users cross-tenant fix — členovia sa rezolvujú cez memberships collection
  (jan.letko@icloud.com sa teraz správne zobrazuje v Používateľoch LTK)

**ADR-0030 schválený** (Proposed → ideme implementovať). Registrácia = e-mail +
Google + Apple + Microsoft; Entra ako per-tenant doménová reštrikcia; SFZ dátová
migrácia bez odhlásenia členov.

## Ďalší krok

**ADR-0030 D1 — Backend Apple Sign-In** (Sonnet):
dokončiť `apple` provider cez Arctic (`form_post` callback), odstrániť 503
z registrácie aj loginu. Apple Developer účet potrebný (sandbox testovanie).

Poradie ďalších blokov: D2 (entraTenantId reštrikcia + autoJoinDomains do flow) →
D3 (admin UI „Prihlasovanie a domény") → D4 (frontend registrácia) → D5 (SFZ
migrácia) → D6 (testy) → D7 (docs). Viď ADR-0030.

⚠️ **Pred D2/D5:** `tid` čítať z id_token claimu, NIE z Graph `/me`. SFZ login
regresiu overiť pred deployom.

## Na horizonte (v TODO.md)

- **ADR-0030 D1–D7** — registračné identity + Entra doména (práve začíname)
- **P1 tech-debt:** Unique index `memberships_userId_organisationId_unique` → pridať
  `partialFilterExpression: { deletedAt: null }` (migrácia + reindex na prod)
- ADR-0029 K8 — replikácia shared-types zmien do SFZ Asset-Management repa
- ADR-0028 B1–B10 — per-tenant branding implementácia
- ADR-0015 Slice #9 K1–K4 — cross-tenant memberships impl
- Forced MFA smoke-test s kolegom
- Pre-go-live blocky (legal review, Atlas allowlist, DR test, pentest)
