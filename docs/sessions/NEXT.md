# NEXT — aktuálny stav + ďalší krok

Posledná session: docs/sessions/2026-06-04-adr-0031.md (ADR-0031 E1-E8 kompletný)

## Aktuálny stav

Production LIVE. ADR-0031 Accepted + implementovaný (E1-E8):

- E1 shared-types: OrgOAuthCredentialsSchema + oauthCredentials na Organisation
- E2 oauth-crypto.ts (AES-256-GCM), OAUTH_SECRET_ENCRYPTION_KEY config
- E3 resolveProviderCredentials + per-request Arctic provider (koniec boot-time mapy)
- E4 orgSlug v OAuth state + AcceptInvitePage posiela org slug hint
- E5 PATCH microsoftOAuth API — šifrovanie pri zápise, read path strip (hasSecret)
- E6 admin UI Microsoft aplikácia v /settings/auth
- E7 testy (crypto, resolver, PATCH, read path, SFZ fallback)
- E8 docs (user-guide, ADR-0030 nadväznosť, ADR-0031 Accepted, TODO)

Ešte treba nastaviť vo Vercel pre inventario-api:

- OAUTH_SECRET_ENCRYPTION_KEY = openssl rand -hex 32 (nový, odlišný od MFA kľúča)
- MICROSOFT_CLIENT_ID + MICROSOFT_CLIENT_SECRET (platformová LTK app pre fallback)

## Ďalší krok

Fáza 0 SFZ pilot onboarding — ďalší krok:

1. Nastaviť OAUTH_SECRET_ENCRYPTION_KEY vo Vercel (inventario-api)
2. Nastaviť MICROSOFT_CLIENT_ID + SECRET (platformová app LTK Solutions v Azure)
3. Prihlásiť sa cez Microsoft na app.inventario.estate/login
4. V /settings/auth nastaviť SFZ vlastnú Microsoft app (keď bude pripravená)

## Na horizonte (v TODO.md)

- P1 tech-debt: memberships partial index (partialFilterExpression: { deletedAt: null })
- ADR-0029 K8 — replikácia shared-types do SFZ Asset-Management repa
- ADR-0028 B1-B10 — per-tenant branding implementácia
- ADR-0015 Slice #9 K1-K4 — cross-tenant memberships impl
- Forced MFA smoke-test s kolegom
- Pre-go-live blocky (legal review, Atlas allowlist, DR test, pentest)
- Apple Sign-In aktivácia (po Apple Developer approval)
