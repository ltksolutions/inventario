# NEXT — aktuálny stav + ďalší krok

Posledná session: docs/sessions/2026-06-04-microsoft-oauth-golive.md (MS OAuth go-live + User.Read fix)

## Aktuálny stav

Production LIVE. ADR-0031 implementovaný (E1–E8) aj **nasadzovaný do reálu** — prebieha
živé testovanie Microsoft prihlásenia pre SFZ pilot.

Hotové dnes:

- Nová Azure App Registration (platformová, multitenant) — staré dev appky (API + CLI) na zmazanie
- `User.Read` scope doplnený do Microsoft OAuth (fix 403 z Graph /me) — commitnuté
- `openapi.json` regen (stale po ADR-0031 E7 PATCH microsoftOAuth) — commit `8c5ada8`
- SFZ org v `/settings/auth`: `@futbalsfz.sk` auto-join doména + `entraTenantId` bcd6945a-… nastavené

Konfigurácia SFZ (vrstvy sú nezávislé — viď session doc):

- `autoJoinDomains` = join policy (bez pozvánky)
- `entraTenantId` = security guard na `tid` claim (uzamknutie na SFZ adresár)
- vlastná Microsoft app = prázdna → platformová app (env fallback) drží pilot

## Ďalší krok

Microsoft login **funguje** ✅ — SFZ pilot má funkčné prihlásenie cez Microsoft.

Ostatok cleanup:

- Zmazať obe staré Azure app registrácie (API `7927aaa3-…` + CLI `40b94818-…`)
- V Atlas upratať `authProviders[0].providerId` na user dokumente (už opravené manuálne — `0c437485-acfb-485b-a713-213897049c2f`)
- `.env.local` mŕtve premenné `ENTRA_CLI_CLIENT_ID` + `ENTRA_API_CLIENT_ID` — neškodné, upratať pri príležitosti

## Na horizonte (v TODO.md)

- P1 tech-debt: memberships partial index (partialFilterExpression: { deletedAt: null })
- ADR-0029 K8 — replikácia shared-types do SFZ Asset-Management repa
- ADR-0028 B1-B10 — per-tenant branding implementácia
- ADR-0015 Slice #9 K1-K4 — cross-tenant memberships impl
- Forced MFA smoke-test s kolegom
- Pre-go-live blocky (legal review, Atlas allowlist, DR test, pentest)
- Apple Sign-In aktivácia (po Apple Developer approval)
