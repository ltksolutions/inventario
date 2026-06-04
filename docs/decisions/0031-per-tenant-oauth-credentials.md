<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0031. Per-tenant OAuth credentials (Microsoft / Google) s šifrovaním at-rest

|                   |                                                                                                                                                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | Proposed                                                                                                                                                                                                                                                                     |
| **Dátum**         | 2026-06-04                                                                                                                                                                                                                                                                   |
| **Autori**        | Ján Letko, Claude Opus 4.8 (LTK Solutions)                                                                                                                                                                                                                                   |
| **Súvisiace ADR** | [0030 Registračné identity + Entra doména](0030-registration-providers-and-entra-domain.md), [0013 Multi-provider auth](0013-multi-provider-auth-self-serve.md), [0010 Multi-tenant](0010-multi-tenant-white-label.md), [0029 Single role](0029-single-hierarchical-role.md) |

## Kontext

ADR-0030 zaviedol per-tenant doménovú reštrikciu cez `entraTenantId`: organizácia
môže obmedziť, **z ktorého** Microsoft adresára smú jej členovia prihlasovať. Pri
nasadení do produkcie sa však ukázal hlbší architektonický problém, ktorý ADR-0030
nepokryl.

### Problém: OAuth credentials sú dnes globálne pre celú platformu

Backend stavia OAuth provider inštancie **raz pri boote**, z jediného páru env
premenných:

```ts
// oauth.routes.ts — buildProviders() pri štarte pluginu
const providers = buildProviders({
  google: GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET ? { ... } : null,
  microsoft: MICROSOFT_CLIENT_ID && MICROSOFT_CLIENT_SECRET ? { ... } : null,
  redirectBase: OAUTH_REDIRECT_BASE_URL,
});
```

To znamená: **jedna Microsoft (Entra) app registrácia pre všetkých tenantov**.
Vlastníkom tejto app je prevádzkovateľ platformy (LTK Solutions). Pre SFZ pilot to
síce stačí (LTK zaregistruje multi-tenant Entra app, SFZ si nastaví len
`entraTenantId`), ale model má tri zásadné chyby pri škálovaní na ďalšie tenanty:

1. **Consent a dôvera.** Pri prvom firemnom Microsoft logine zobrazí Entra súhlas
   pre aplikáciu **LTK Solutions**, nie pre danú organizáciu. IT oddelenie tenanta
   (napr. mesto, väčší zväz) typicky vyžaduje admin consent pre svoj vlastný App
   Registration vo svojom Entra adresári — nie pre cudziu platformovú app. Pri
   citlivejších tenantoch je „prihlasujete sa cez app tretej strany" blokujúci
   faktor.

2. **Blast radius secretu.** Jeden `MICROSOFT_CLIENT_SECRET` pre všetkých = jeho
   únik kompromituje OAuth pre **všetky** tenanty naraz. Rotácia secretu znamená
   výpadok pre všetkých súčasne. To je v rozpore s tenant izoláciou, ktorá je
   inak jadro platformy (ADR-0010).

3. **Redirect URI a branding.** Všetky tenanty zdieľajú jeden redirect URI a jednu
   identitu app v Entre. Tenant si nemôže prispôsobiť OAuth consent (názov,
   logo, publisher) ani oddeliť audit/telemetriu loginov vo svojom Azure.

### Čo chceme dosiahnuť

- **Per-tenant Microsoft OAuth**: každá organizácia môže zadať **vlastné**
  `clientId` + `clientSecret` (z vlastného App Registration vo svojom Entra
  adresári). Login členov tenanta ide cez **jeho** app — consent, audit aj
  blast-radius sú v rukách tenanta.

- **Šifrovanie secretu at-rest**: `clientSecret` sa nikdy neukladá v plaintexte.
  Rovnaký model ako MFA TOTP secret (Slice #7): AES-256-GCM, kľúč len v env.

- **Bezšvový fallback**: tenanty bez vlastnej app (väčšina malých — kluby, školy)
  použijú **platformovú** Microsoft app z env premenných (dnešné správanie). Zmena
  nesmie rozbiť SFZ pilot ani vyžadovať, aby si malý tenant zakladal Azure app.

### Obmedzenia

- **EUPL-1.2 / no vendor lock-in** — žiadny platený secret manager ako tvrdá
  závislosť; KMS smie byť **voliteľný** upgrade, nie podmienka behu (ADR-0013).
- **Tenant izolácia (ADR-0010)** — secret jedného tenanta nesmie byť čitateľný
  v kontexte iného; OAuth provider inštancia sa musí budovať per-request, nie raz
  pri boote.
- **Bezšvová migrácia** — existujúce env-var credentials musia ďalej fungovať ako
  fallback; SFZ login sa nesmie rozbiť.
- **Stateless serverless (Vercel)** — backend beží ako serverless funkcia, žiadny
  warm in-memory provider cache nie je spoľahlivý; provider sa musí dať postaviť
  z DB + env v rámci requestu lacno.
- **Pilot časový tlak** — SFZ pilot beží; krátkodobo musí fungovať platformová app
  cez env (fallback), per-tenant je opt-in vrstva navrch.

## Možnosti

### A) Status quo — jedna platformová app pre všetkých (env-only)

- Plus: nulová práca, funguje pre pilot.
- Mínus: nerieši consent/dôveru, blast-radius, ani tenant izoláciu secretu.
  Pri treťom-štvrtom tenante s vlastným IT to bude blokujúce. Odkladá problém.

### B) Per-tenant credentials v DB, secret šifrovaný at-rest (AES-256-GCM), env fallback

- Plus: tenant si môže priniesť vlastnú app; secret šifrovaný rovnakým overeným
  vzorom ako MFA; malé tenanty bez konfigurácie fungujú cez platformovú app;
  čisto aditívne k schéme. OAuth provider sa stavia per-request z resolved
  credentials (tenant DB → fallback env).
- Mínus: provider sa už nedá postaviť raz pri boote — treba per-request resolúciu
  tenanta a stavbu Arctic inštancie; viac vetiev v login/callback; šifrovací kľúč
  navyše (`OAUTH_SECRET_ENCRYPTION_KEY`).

### C) Plný externý secret manager (Vault / AWS KMS / GCP KMS) pre per-tenant secrety

- Plus: secrety nikdy nie sú ani šifrované v našej DB; rotácia a audit out-of-the-box.
- Mínus: tvrdá závislosť na cloud KMS = vendor lock-in (proti ADR-0013), prevádzková
  réžia, $$$. Pre súčasnú škálu (jednotky–desiatky tenantov) výrazne predčasné.
  KMS necháme ako **voliteľný** budúci backend kľúča, nie ako podmienku.

## Rozhodnutie

### Možnosť B — per-tenant OAuth credentials v DB so šifrovaným secretom + env fallback

#### 1. Dátový model — nový embedded objekt na `Organisation`

Nové **nullable** pole `oauthCredentials` (čisto aditívne). Drží per-provider
credentials. `clientSecret` je uložený **už zašifrovaný** (formát `iv:tag:ciphertext`,
rovnako ako MFA secret). Plaintext secret sa do DB nikdy nedostane.

```ts
// shared-types: organisation.ts
export const OrgOAuthProviderCredentialsSchema = z
  .object({
    /** App (client) ID z tenantovho App Registration. Nie je tajné. */
    clientId: z.string().min(1).max(200),
    /**
     * Client secret zašifrovaný AES-256-GCM (formát iv:tag:ciphertext).
     * NIKDY plaintext. Pri čítaní cez API sa NEVRACIA (write-only z pohľadu klienta).
     */
    clientSecretEncrypted: z.string().min(1),
    /**
     * Voliteľné: obmedzenie Entra audience pre TENTO provider.
     * 'organizations' (default) | 'common' | konkrétny tenant GUID.
     * Pre Microsoft; pre Google ignorované.
     */
    tenantMode: z.string().max(64).nullable().default(null),
    /** Kedy boli credentials naposledy nastavené (audit). */
    configuredAt: z.string().datetime(),
    /** UserId admina, ktorý ich nastavil (audit). */
    configuredBy: ObjectIdSchema.nullable().default(null),
  })
  .strict();

export const OrgOAuthCredentialsSchema = z
  .object({
    microsoft: OrgOAuthProviderCredentialsSchema.nullable().default(null),
    google: OrgOAuthProviderCredentialsSchema.nullable().default(null),
    // apple zámerne nie — Apple používa team/key/p8 model, mimo rozsahu tohto ADR
  })
  .strict();

// na OrganisationSchema:
oauthCredentials: OrgOAuthCredentialsSchema.nullable().default(null),
```

Pozn.: `clientId` **nie je** tajný (je viditeľný v každom auth redirect URL), preto
sa ukladá plaintext a smie sa vracať cez API. Tajný je len `clientSecret`.

#### 2. Šifrovanie — nový `oauth-crypto.ts`, vzor zhodný s `mfa-crypto.ts`

AES-256-GCM, formát `iv:tag:ciphertext`. Nový env kľúč:

```
OAUTH_SECRET_ENCRYPTION_KEY  # 64 hex znakov (32 bajtov), openssl rand -hex 32
```

Samostatný kľúč od `MFA_SECRET_ENCRYPTION_KEY` (princíp najmenšieho rozsahu — únik
jedného kľúča neohrozí druhú doménu). `oauth-crypto.ts` exportuje
`encryptClientSecret(plaintext, keyHex)` a `decryptClientSecret(stored, keyHex)` —
tenké wrappery nad rovnakým GCM kódom (zvážiť refactor spoločného `aes-gcm.ts`
helpera, aby sa logika neduplikovala — viď Dôsledky).

#### 3. Credential resolúcia — per-request, tenant → fallback env

Nová funkcia `resolveProviderCredentials(org, provider, config, keyHex)`:

1. Ak `org.oauthCredentials?.[provider]` existuje → dešifruj secret, vráť
   `{ clientId, clientSecret, source: 'tenant' }`.
2. Inak ak sú nastavené platformové env (`MICROSOFT_CLIENT_ID` atď.) → vráť
   `{ clientId, clientSecret, source: 'platform' }`.
3. Inak → `null` (provider nedostupný → 503 s jasnou hláškou).

OAuth login/callback prestane brať provider z boot-time `providers` mapy a postaví
Arctic inštanciu **per-request** z resolved credentials. Pre `login/:provider`
sa tenant rozlíši z kontextu (viď bod 4); pre `callback/:provider` z `statePayload`
(do state sa pridá `orgId`/`source`, aby callback vedel postaviť identickú inštanciu).

#### 4. Ako sa pri logine zistí tenant (a teda ktoré credentials)

Toto je jadro implementačnej rozvahy — pri **logine** ešte nevieme, kto sa hlási:

- **Self-serve registrácia novej org**: tenant ešte neexistuje → **vždy platformová
  app** (env fallback). Per-tenant app dáva zmysel až keď org existuje a admin si ju
  nastaví. Žiadna zmena oproti dnešku.
- **Login existujúceho člena cez per-tenant app**: tenant treba identifikovať
  **pred** OAuth redirectom. Dve cesty (rozhodne sa v E-blokoch, nie tu):
  - (a) **Tenant hint v URL/subdoméne** — napr. `/login?org=sfz` alebo budúca
    tenant subdoména (`sfz.inventario.estate`). Frontend pridá hint, backend podľa
    `slug` načíta org a jej credentials.
  - (b) **Email-first krok** — používateľ najprv zadá e-mail, backend podľa domény
    namapuje tenant(y) a ponúkne správny provider. Komplexnejšie pri viac-tenant
    e-mailoch (ADR-0015 cross-tenant).
  - **Default pre tento ADR**: cesta (a) — tenant hint cez `?org=<slug>` query param
    na `/login` a `login/:provider`. Bez hintu → platformová app (dnešné správanie).
    Email-first (b) je zaznamenané ako budúce vylepšenie.
- **Accept-invite cez OAuth**: pozvánka **už nesie `organisationId`** → credentials
  sa resolvnú z org pozvánky. Najčistejšia cesta, žiadny hint netreba.

#### 5. Admin UI — sekcia „Microsoft aplikácia" v `/settings/auth`

Pod existujúcim ADR-0030 panelom „Prihlasovanie a domény" pribudne sekcia:

- `clientId` (text, plaintext, predvyplnené ak nastavené),
- `clientSecret` (password input, **write-only** — API ho nikdy nevracia; prázdne
  pole = „nemeniť", vyplnené = „prepíš"),
- `tenantMode` (organizations / common / konkrétny GUID),
- stav: „Používa sa vlastná Microsoft aplikácia" vs „Používa sa platformová
  aplikácia Inventario (predvolené)",
- tlačidlo „Odstrániť vlastnú aplikáciu" (→ späť na platformový fallback).

Setup návod (kde v Azure vziať clientId/secret, aký redirect URI nastaviť:
`https://api.inventario.estate/v1/auth/callback/microsoft`) — link na user-guide.

#### 6. API — rozšírenie `PATCH /v1/organisations/current`

Pridať `oauthCredentials` do self-service patchu (ADR-0030 zaviedol
`OrganisationSelfServicePatch`). Vstup z UI je **plaintext** `clientSecret`; service
ho zašifruje cez `oauth-crypto` pred zápisom a uloží do `clientSecretEncrypted`.
**Read path** (`GET /current`, OpenAPI response) `clientSecretEncrypted` **vždy
odstráni** — klient dostane len `clientId`, `tenantMode`, `configuredAt`, a boolean
`hasSecret`. Secret je teda write-only cez API.

#### Mimo rozsahu (zaznamenané, nerobíme teraz)

- **Google per-tenant credentials** — schéma ráta s `google` slotom, ale UI a flow
  v tomto ADR riešime len pre **Microsoft** (reálna potreba SFZ/enterprise). Google
  ostáva na platformovej app; slot je pripravený na neskôr.
- **Apple per-tenant** — Apple používa team/key/p8 model, iný tvar; mimo rozsahu.
- **Externý KMS** (Vault/AWS/GCP) ako backend šifrovacieho kľúča — voliteľný budúci
  upgrade, dnes len env kľúč.
- **Domain ownership verification (DNS TXT)** pred zapnutím per-tenant app —
  zvážiť, ak to začne reálne používať viac tenantov.
- **Email-first login routing** (cesta 4b) — budúce UX vylepšenie.

## Implementačný plán (návrh K-blokov)

> Model: Sonnet pre väčšinu (crypto wrapper, CRUD, flow, UI, testy); Opus len ak by
> sa otvorila čisto návrhová otázka (napr. tenant routing pri logine).

| Blok   | Popis                                                                                                                                                          | Model  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **E1** | shared-types: `OrgOAuthProviderCredentialsSchema` + `OrgOAuthCredentialsSchema`, pridať `oauthCredentials` na `OrganisationSchema`. OpenAPI regen.             | Sonnet |
| **E2** | `oauth-crypto.ts` (AES-256-GCM, vzor `mfa-crypto`), nový env `OAUTH_SECRET_ENCRYPTION_KEY` do config schémy + `.env.example` + `turbo.json globalEnv`.         | Sonnet |
| **E3** | `resolveProviderCredentials(org, provider, config, key)` + per-request stavba Arctic inštancie; refactor `oauth.routes.ts` z boot-time mapy na per-request.    | Sonnet |
| **E4** | Tenant routing pri logine: `?org=<slug>` hint na `/login` + `login/:provider`; do OAuth state pridať `orgId`+`source`, callback stavia identickú inštanciu.    | Sonnet |
| **E5** | API: `oauthCredentials` do `OrganisationSelfServicePatch` + service šifrovanie pri zápise; read path strip secretu (`hasSecret` boolean namiesto ciphertextu). | Sonnet |
| **E6** | Admin UI sekcia „Microsoft aplikácia" v `/settings/auth` (clientId, write-only secret, tenantMode, stav, odstránenie → fallback).                              | Sonnet |
| **E7** | Testy: encrypt/decrypt round-trip, resolúcia tenant→fallback, login cez per-tenant app, callback identita, read path nikdy nevracia secret, SFZ fallback.      | Sonnet |
| **E8** | Docs: user-guide „Vlastná Microsoft aplikácia" (Azure setup, redirect URI), milestone + session, superseded/nadväznosť note do ADR-0030.                       | Haiku  |

## Dôsledky

### Pozitívne

- **Tenant izolácia OAuth** — únik/rotácia secretu jedného tenanta neovplyvní
  ostatných; consent ide cez tenantovu vlastnú app.
- **Bezšvový fallback** — malé tenanty bez Azure app fungujú ďalej cez platformovú
  app; SFZ pilot sa nerozbije (env credentials ostávajú ako fallback).
- **Secret nikdy plaintext** — at-rest šifrovanie rovnakým overeným vzorom ako MFA;
  write-only cez API (read path strip).
- **Aditívna zmena schémy** — `oauthCredentials` je nullable, default null; nič
  existujúce sa nemení.
- **Pripravené na Google** — slot existuje, len UI/flow sa doplní neskôr.

### Negatívne / kompromisy

- **Provider sa stavia per-request** — koniec boot-time `providers` mapy; mierne
  vyššia réžia na login (načítanie org + dešifrovanie). Pri serverless je to však
  prirodzené (žiadny spoľahlivý warm cache aj tak nemáme).
- **Tenant routing pri logine** — `?org=<slug>` hint je najjednoduchšia cesta, ale
  vyžaduje, aby člen prišiel cez správny link (alebo budúcu subdoménu). Bez hintu
  spadne na platformovú app — čo pri tenante s `entraTenantId` reštrikciou môže
  viesť k mätúcemu „nesprávny adresár", nie k jeho vlastnej app. Treba jasné UX.
- **Ďalší šifrovací kľúč** — `OAUTH_SECRET_ENCRYPTION_KEY` do správy tajomstiev
  (Vercel env, rotácia, DR). Strata kľúča = nečitateľné per-tenant secrety (tenant
  ich musí zadať znova; nie je to data-loss používateľských dát).

### Riziká, ktoré treba sledovať

- **Strata/rotácia `OAUTH_SECRET_ENCRYPTION_KEY`** — pri rotácii treba re-encrypt
  všetkých uložených secretov (migračný skript), inak sa per-tenant login rozbije.
  Dovtedy fallback na platformovú app drží login nažive len pre tenantov bez
  vlastnej app.
- **Redirect URI mismatch** — tenant musí v svojom Azure App Registration nastaviť
  presne `https://api.inventario.estate/v1/auth/callback/microsoft`; nesúlad = MS
  odmietne login. Patrí do setup návodu + ideálne validácia/diagnostika v UI.
- **Callback identita** — callback MUSÍ postaviť Arctic inštanciu z **rovnakých**
  credentials ako login redirect (inak token exchange zlyhá). Preto `orgId`+`source`
  do podpísaného OAuth state, nie spoliehať sa na re-resolúciu.
- **`tid` reštrikcia (ADR-0030) vs per-tenant app** — ak má tenant aj vlastnú app
  aj `entraTenantId`, app už typicky pustí len svoj adresár; `tid` check sa stáva
  redundantný, ale necháme ho ako defense-in-depth (žiadny konflikt).

## Referencie

- [ADR-0030 Registračné identity + Entra doménová reštrikcia](0030-registration-providers-and-entra-domain.md) — predchodca, zaviedol `entraTenantId` reštrikciu
- [ADR-0013 Multi-provider auth + self-serve](0013-multi-provider-auth-self-serve.md) — OAuth základ, no-vendor-lock-in princíp
- [ADR-0010 Multi-tenant white-label](0010-multi-tenant-white-label.md) — tenant izolácia
- [Slice #7 MFA crypto](../../apps/api/src/lib/mfa-crypto.ts) — referenčný AES-256-GCM vzor pre secret at-rest
- [Microsoft identity platform — app registration & redirect URIs](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
- [Arctic — OAuth 2.0 client library](https://arcticjs.dev/)
