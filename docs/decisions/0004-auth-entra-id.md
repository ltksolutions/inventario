# 0004. Microsoft Entra ID ako identity provider

|                   |                                                                     |
| ----------------- | ------------------------------------------------------------------- |
| **Status**        | 🚫 Superseded by [ADR-0013](0013-multi-provider-auth-self-serve.md) |
| **Dátum**         | máj 2026                                                            |
| **Autori**        | tím SFZ Asset Management                                            |
| **Súvisiace ADR** | [0002-nestjs](0002-backend-nestjs.md)                               |

## Kontext

Systém potrebuje autentifikáciu a autorizáciu pre:

- **Interných používateľov** – ~100-500 zamestnancov SFZ, ktorí už majú firemné účty v Microsoft 365.
- **Externých používateľov** – tréneri klubov, partneri (cca 50-100), ktorí firemné účty SFZ nemajú.
- **MCP server** – AI asistenti pristupujúci v mene používateľa.

Požiadavky:

- SSO pre internch (žiadne dodatočné heslo).
- MFA pre admin akcie (vyžaduje SFZ).
- Sync používateľov a organizačnej štruktúry (oddelenie, manažér).
- Auditovateľnosť prihlásení.
- Práca s rôznymi klientmi: web, mobil (Flutter), MCP.

## Možnosti

### Možnosť A: Microsoft Entra ID (zvolené)

SFZ má Microsoft 365 → má Entra ID tenant.

- **Plus:** SFZ tenant **už existuje** – zamestnanci sa autentifikujú svojimi existujúcimi účtami, bez nového hesla.
- **Plus:** Vstavané MFA, Conditional Access, audit logs.
- **Plus:** Microsoft Graph API pre sync používateľov (meno, oddelenie, manažér, foto).
- **Plus:** Štandardné OIDC + OAuth 2.0 / 2.1 protokoly – funguje s ľubovoľným klientom.
- **Plus:** Bezplatné v rámci existujúcich M365 licencií SFZ.
- **Plus:** Group-based RBAC – mapujeme Entra ID skupiny na systémové roly.
- **Mínus:** Vendor lock-in voči Microsoftu.
- **Mínus:** Externí používatelia (mimo SFZ tenantu) potrebujú samostatné riešenie – buď Entra External ID (B2B/B2C), alebo natívny PAT/magic link systém.

### Možnosť B: Keycloak (self-hosted)

Open-source identity provider, plne kontrolovateľný.

- **Plus:** Plná kontrola, open-source, federácia s rôznymi IdP vrátane Entra ID.
- **Plus:** Vlastné UX pre login.
- **Plus:** Jednotný IdP pre interných aj externých (federácia interných cez Entra ID, externí lokálne).
- **Mínus:** Self-hosted = ďalšia infraštruktúra na údržbu, monitoring, upgrade.
- **Mínus:** Pre internch by tak či tak federovalo do Entra ID – pridáva komplexitu pre malú výhodu.
- **Mínus:** SFZ tím nemá kapacitu na prevádzku ďalšieho kritického komponentu.

### Možnosť C: Auth0 / Okta (managed third-party)

Komerčné identity providery.

- **Plus:** Managed, dobré UX, federácia.
- **Mínus:** Cena (Auth0 free tier končí pri 25k MAU – my máme do 500 MAU, ale pricing s pridanými features rastie).
- **Mínus:** Ďalší vendor.
- **Mínus:** Žiadna výhoda nad Entra ID pre náš case (lebo SFZ má M365).

### Možnosť D: Vlastná JWT auth + neskôr SSO

Začať jednoducho s e-mail/heslo, pridať Entra ID neskôr.

- **Plus:** Najjednoduchší štart.
- **Mínus:** Heslá pre internch sú anti-pattern (majú M365 účet).
- **Mínus:** Refactor neskôr je drahší ako urobiť to hneď správne.
- **Diskvalifikované** – SFZ explicitne chce SSO od začiatku.

## Rozhodnutie

Zvolili sme **Microsoft Entra ID (Možnosť A)** ako primárny IdP pre interných používateľov SFZ.

Pre **externých používateľov** zvolíme **hybridný prístup**:

- Externý účet v našej `users` kolekcii (lokálne hashované heslo cez Argon2 ALEBO magic link prihlasovanie).
- Žiadna Entra External ID v prvej fáze (zníži komplexitu) – vyhodnotíme neskôr ak narastie počet externých.

## Dôsledky

### Pozitívne

- Zero-friction prihlasovanie pre zamestnancov SFZ.
- MFA a Conditional Access nastavujú SFZ Entra admini – bez práce na strane aplikácie.
- Audit prihlásení v Entra ID logoch.
- Automatický sync zmien (zamestnanec odíde → účet deaktivovaný cez SCIM/cron).

### Negatívne / kompromisy

- Vendor lock-in voči Microsoftu (mitigácia: štandardné OIDC, dá sa migrovať).
- Pre externých potrebujeme paralelný systém (lokálne účty s heslom alebo magic link).
- Lokálny dev vyžaduje buď test tenant Entra ID alebo mock OIDC provider (napr. `oidc-provider` lokálne).

### Riziká, ktoré treba sledovať

- Zmena Entra ID licenčného modelu Microsoftu.
- Sync používateľov s Microsoft Graph – treba reflektovať deaktivácie účtov (cron job, max delay 1 deň).
- Race condition pri prvom prihlásení: vytvorenie lokálneho `User` recordu z Entra claims.

## Implementačné poznámky

### Tech

- **Knižnica:** `@azure/msal-node` (oficiálna, novšia) ALEBO `passport-azure-ad` (cez `@nestjs/passport`).
- **Flow:** Authorization Code with PKCE (pre web + mobile + MCP).
- **Token validácia:** v každom requeste – verify signature cez Microsoft JWKs (`https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys`).
- **Refresh tokeny:** ukladané server-side v `refresh_tokens` collection s rotáciou.

### Mapovanie Entra ID skupín → systémové roly

V `system_config` definujeme mapping:

```json
{
  "key": "entra_group_role_mapping",
  "value": {
    "00000000-0000-0000-0000-000000000001": "admin",
    "00000000-0000-0000-0000-000000000002": "asset_manager",
    "00000000-0000-0000-0000-000000000003": "team_manager"
  }
}
```

Default rola pre prihlásených bez mapovanej skupiny: `employee`.

### Externí používatelia

- Vytvorení cez `POST /users` s `type: external`.
- Prvotné nastavenie hesla cez **magic link** poslaný e-mailom (token platný 24h).
- Login: `POST /auth/external/login` s e-mail + heslom.
- Heslá: Argon2id, min. 12 znakov.
- MFA: voliteľné, cez TOTP (pridáme vo fáze 2).

### Lokálny dev

- Dev mode: mock OIDC provider (`oidc-provider` npm) v `docker-compose.yml`.
- Predvolení dev používatelia v seedoch s rôznymi rolami.

## Migračná stratégia (ak by sa neskôr menilo)

Ak by sme niekedy chceli migrovať na iný IdP (Keycloak, vlastné):

1. Pridáme nový IdP ako alternatívnu možnosť (parallel auth).
2. Migrujeme externých používateľov (lokálne hashy zostanú alebo sa vyžiadne reset).
3. Interní cez federáciu zostávajú na Entra ID alebo prejdú na nový IdP.
4. Pôvodný IdP deaktivujeme po prechodnom období.

Štandardné OIDC nám túto migráciu uľahčuje – aplikačná vrstva nie je viazaná na špecifický IdP.

## Referencie

- [Microsoft Entra ID developer documentation](https://learn.microsoft.com/en-us/entra/identity-platform/)
- [MSAL Node](https://github.com/AzureAD/microsoft-authentication-library-for-js/tree/dev/lib/msal-node)
- [OIDC spec](https://openid.net/specs/openid-connect-core-1_0.html)
- [Argon2 password hashing](https://github.com/ranisalt/node-argon2)
