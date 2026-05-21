<!--
SPDX-FileCopyrightText: 2026 LTK Solutions, s.r.o.
SPDX-License-Identifier: CC-BY-4.0
-->

# GDPR Article 30 — Záznamy o spracovateľských činnostiach (Inventario platforma)

> **LTK Solutions ako sprostredkovateľ pre tenant-ov platformy Inventario.** Tento dokument eviduje spracovateľské činnosti v zmysle **GDPR čl. 30 ods. 2** — záznamy vedené sprostredkovateľom o spracúvaní vykonávanom v mene prevádzkovateľa (tenant-a). Pre záznamy LTK Solutions ako prevádzkovateľa vlastných business operations viď [gdpr-article-30-controller.md](./gdpr-article-30-controller.md).

| Pole                      | Hodnota                                                                                                                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Verzia**                | 2.0                                                                                                                                                                                                                                                                        |
| **Posledná aktualizácia** | _\[doplniť pri publikácii\]_                                                                                                                                                                                                                                               |
| **Sprostredkovateľ**      | **LTK Solutions, s.r.o.**, Banícka 1894/17, 968 01 Nová Baňa, IČO 45 949 310, IČ DPH SK2023148017, OR OS Banská Bystrica, odd. Sro, vl. č. 19280/S, konateľ Ing. Ján Letko                                                                                                 |
| **Prevádzkovateľ**        | Každý tenant platformy Inventario (organizácia ktorá má aktívne predplatné — športové federácie, mestá, kluby, školy, neziskové organizácie atď.). Záznam je vedený sumárne pre všetkých tenant-ov; špecifiká per-tenant sa riešia v DPA podpísanej s konkrétnym tenant-om |
| **DPO**                   | Nepovinný (čl. 37 GDPR — žiadne large-scale special category data); kontakt: privacy@inventario.estate                                                                                                                                                                     |
| **Doména**                | https://inventario.estate                                                                                                                                                                                                                                                  |
| **Verzia DPA šablóny**    | [DPA Template v1.0](./legal/dpa-template.md)                                                                                                                                                                                                                               |
| **Sub-processors**        | [Verejný zoznam](./legal/sub-processors.md) / publikovaný na https://inventario.estate/sub-processors                                                                                                                                                                      |
| **Záznam vedenie**        | Tento dokument + audit log (Mongo `audit_logs`) + Git history (audit trail tohto súboru)                                                                                                                                                                                   |

---

## TL;DR

Inventario je multi-tenant SaaS platforma pre evidenciu a vypožičiavanie majetku. Spracúva osobné údaje v štyroch hlavných oblastiach (autentifikácia, evidencia majetku, vypožičky, audit log). **Žiadne special category data** v zmysle čl. 9 GDPR. Hosting v EÚ (Vercel cdg1/fra1 + MongoDB Atlas eu-central-1). Email delivery cez Ecomail.cz (EÚ). OAuth identity providers: Microsoft Entra ID, Google, Apple (planned) — všetky v EÚ entitách s SCCs.

TOTP MFA je dostupné pre každého používateľa, aktivácia na úrovni tenant policy (DISABLED / OPTIONAL / REQUIRED) — viď [milestone slice #7](../milestones/slice-7-totp-mfa.md).

Audit log zachytáva každú operáciu meniacu osobné údaje (čl. 5 ods. 2 — accountability). Retention 24 mesiacov pre štandardné záznamy, 60 mesiacov pre security a access-control udalosti.

---

## 1. Spracovateľské operácie (Article 30 inventory)

Každá operácia zachytená v tabuľke nižšie predstavuje samostatný "record of processing activity" v zmysle čl. 30 ods. 2 GDPR vedený LTK Solutions ako sprostredkovateľom.

### 1.1. Autentifikácia a správa používateľov

| Pole                           | Hodnota                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Účel spracovania**           | Overenie totožnosti používateľa pri prihlásení; JIT-provisioning nového účtu v rámci tenant-a (pri OAuth); manuálna registrácia s e-mailom a heslom; vedenie základných údajov (rola, organizačná jednotka, preferencie)                                                                                                                     |
| **Právny základ** (čl. 6 GDPR) | Plnenie zmluvy s tenantom (písm. b); pre verejný sektor aj písm. e — verejný záujem. Sprostredkovateľ spracúva na základe DPA, neurčuje právny základ.                                                                                                                                                                                       |
| **Kategórie osobných údajov**  | Identifikačné: meno, priezvisko, displayName, OAuth provider ID (Entra OID, Google sub, Apple sub), organisationId. Kontaktné: e-mailová adresa, voliteľne telefón. Účtové: roly, isActive, lastLoginAt, accountType, preferences, organizačná jednotka, tímy                                                                                |
| **Autentifikačné údaje**       | Hash hesla (argon2id) pre LOCAL účty; AES-256-GCM šifrovaný TOTP secret + argon2id-hashované recovery kódy pri aktivovanom MFA. **Nikdy nie sú prístupné API response-om** — repository projekcia ich filtruje.                                                                                                                              |
| **Kategórie subjektov údajov** | Zamestnanci tenant-ov (federácie, mestá, kluby, školy); externí spolupracovníci s prístupom k tenant účtu; rodičia ako proxy pre maloletých (ak Prevádzkovateľ poskytuje Službu pre takúto cieľovú skupinu)                                                                                                                                  |
| **Príjemcovia**                | Tenant administrátor (read prístup k vlastným používateľom); LTK Solutions (technický prevádzkovateľ pre hosted variant); OAuth providers (Microsoft, Google, Apple) v rozsahu OAuth scope                                                                                                                                                   |
| **Cezhraničné prenosy**        | Žiadne pre primárne uloženie. OAuth flow prenos obmedzený na e-mail + identifikátor používateľa — pokryté DPA/SCCs jednotlivých OAuth providerov                                                                                                                                                                                             |
| **Retention**                  | Aktívne účty: počas trvania zmluvy. Deaktivované: 24 mesiacov od `deletedAt`, potom pseudonymizácia. Audit záznamy o prihlasovaní: 60 mesiacov                                                                                                                                                                                               |
| **Technické opatrenia**        | TLS 1.3 in transit; encryption at rest (Atlas default AES-256); argon2id pre heslá (memoryCost 65536, timeCost 3, parallelism 4); AES-256-GCM pre TOTP secrets; Inventario JWT (RS256, keypair rotácia); silent token refresh; HttpOnly + Secure cookies                                                                                     |
| **Organizačné opatrenia**      | RBAC s 5 rolami; principle of least privilege; audit log každej zmeny role + isActive; tenant-level MFA policy (DISABLED/OPTIONAL/REQUIRED); rate limiting na login endpointoch (10 attempts / 15 min / IP)                                                                                                                                  |
| **Mongo collection**           | `users`                                                                                                                                                                                                                                                                                                                                      |
| **Schema**                     | `packages/shared-types/src/schemas/user.ts`                                                                                                                                                                                                                                                                                                  |
| **Audit log actions**          | `USER_LOGIN`, `USER_LOGIN_FAILED`, `USER_LOGOUT`, `USER_CREATED`, `USER_UPDATED`, `USER_DEACTIVATED`, `USER_REACTIVATED`, `USER_ROLE_GRANTED`, `USER_ROLE_REVOKED`, `USER_PASSWORD_CHANGED`, `USER_PASSWORD_RESET_REQUESTED`, `USER_MFA_ENABLED`, `USER_MFA_DISABLED`, `USER_INVITED`, `USER_INVITATION_REVOKED`, `USER_INVITATION_ACCEPTED` |

### 1.2. Evidencia a správa majetku

| Pole                           | Hodnota                                                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Účel spracovania**           | Vedenie inventáru fyzických aktív organizácie tenant-a; sledovanie ich umiestnenia, stavu a histórie. Osobné údaje sa vyskytujú nepriamo cez `createdBy`/`updatedBy`/`deletedBy` polia |
| **Právny základ**              | Plnenie zmluvy s tenantom (písm. b); oprávnený záujem (písm. f) — vedenie majetkovej evidencie, prevencia strát                                                                        |
| **Kategórie osobných údajov**  | Identifikátor zamestnanca, ktorý záznam vytvoril/upravil/zmazal (`userId`); displayName-snapshot v audit logu                                                                          |
| **Kategórie subjektov údajov** | Zamestnanci tenant-a s rolou ASSET_MANAGER alebo ADMIN, ktorí spravujú inventár                                                                                                        |
| **Príjemcovia**                | Tenant administrátor, asset manager, employee (read-only); LTK Solutions (technický prevádzkovateľ)                                                                                    |
| **Cezhraničné prenosy**        | Žiadne                                                                                                                                                                                 |
| **Retention**                  | Aktívne assety: počas životnosti majetku. Soft-deleted: 60 mesiacov (potreba pre účtovné a daňové audity dlhšia než štandardný GDPR cyklus)                                            |
| **Technické opatrenia**        | Tenant-scoped queries (organisationId filter); soft delete s `deletedAt`/`deletedBy`; transactional writes; immutability `inventoryNumber`                                             |
| **Organizačné opatrenia**      | RBAC: GET = všetci v tenant-e, POST/PATCH = ASSET_MANAGER+ADMIN, DELETE = ADMIN only                                                                                                   |
| **Mongo collection**           | `assets`, `categories`, `locations`                                                                                                                                                    |
| **Audit log actions**          | `ASSET_CREATED`, `ASSET_UPDATED`, `ASSET_DELETED`, `ASSET_STATUS_CHANGED`, `ASSET_LOCATION_CHANGED`, `ASSET_DISPOSED`, `CATEGORY_*`, `LOCATION_*`                                      |

### 1.3. Vypožičiavanie majetku (loans)

> **Stav: implementované v Slice #5**. Hlavná business funkčnosť Inventario.

| Pole                           | Hodnota                                                                                                                                                                                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Účel spracovania**           | Záznam o tom, kto má aktuálne vypožičaný konkrétny majetok; schvaľovací workflow; protokoly o prevzatí a vrátení                                                                                                                                                                   |
| **Právny základ**              | Plnenie zmluvy o výpožičke medzi tenantom a vypožičiavateľom (písm. b); oprávnený záujem tenant-a — ochrana majetku (písm. f)                                                                                                                                                      |
| **Kategórie osobných údajov**  | Identifikátor vypožičiavateľa (`borrowerId`), schvaľovateľa (`approverId`), osoby preberajúcej / odovzdávajúcej (`handedOverBy` / `returnedTo`). Snapshot mena a e-mailu na protokole; digitálny podpis (sken obrázku alebo click-to-sign timestamp + IP)                          |
| **Poznámka k podpisom**        | Click-to-sign / sken obrázku **nie sú biometrickými údajmi** v zmysle čl. 4 ods. 14 GDPR — nedochádza k automatizovanému spracúvaniu osobitne identifikujúcich fyzických/fyziologických charakteristík. Iba zachytenie samotného aktu podpisu + technické metadata (timestamp, IP) |
| **Kategórie subjektov údajov** | Zamestnanci, manažéri klubov, rodičia (proxy pre maloletých — vyžaduje rodičovský súhlas v UI), externí spolupracovníci                                                                                                                                                            |
| **Príjemcovia**                | Tenant administrátor, schvaľovateľ; LTK Solutions (technický prevádzkovateľ)                                                                                                                                                                                                       |
| **Cezhraničné prenosy**        | Žiadne                                                                                                                                                                                                                                                                             |
| **Retention**                  | Aktívne pôžičky: počas trvania. Ukončené: 60 mesiacov (účtovné a kontrolné účely)                                                                                                                                                                                                  |
| **Technické opatrenia**        | Tenant-scoped queries; transakčné writes pri loan state transitions; PDF protokoly podpísané server-side timestamp-om; SHA-256 hash PDF pre dôkaz integrity                                                                                                                        |
| **Organizačné opatrenia**      | Schvaľovací workflow; principle of separation of duties (vypožičiavateľ ≠ schvaľovateľ); idempotency-key na duplicates protection                                                                                                                                                  |
| **Mongo collection**           | `loans`, `loan_requests`, `loan_protocols`                                                                                                                                                                                                                                         |
| **Audit log actions**          | `LOAN_REQUEST_CREATED`, `LOAN_REQUEST_APPROVED`, `LOAN_REQUEST_REJECTED`, `LOAN_REQUEST_CANCELLED`, `LOAN_PICKED_UP`, `LOAN_RETURNED`, `LOAN_EXTENDED`, `LOAN_MARKED_OVERDUE`, `LOAN_MARKED_LOST`                                                                                  |

### 1.4. Pozvánky používateľov (invitations)

> **Stav: implementované v Slice #6c K18**. Tenant ADMIN / ASSET_MANAGER pozýva nových používateľov e-mailom.

| Pole                           | Hodnota                                                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Účel spracovania**           | Riadené pridávanie nových používateľov do tenant prostredia; akceptácia cez password setup alebo OAuth; voliteľný domain policy enforcement                                         |
| **Právny základ**              | Plnenie zmluvy s tenantom (písm. b)                                                                                                                                                 |
| **Kategórie osobných údajov**  | E-mailová adresa pozývaného; voliteľne meno a priezvisko; identifikátor pozývajúceho admin-a; invitation token (jednorazový); pri akceptácii: hash hesla + ďalšie profile údaje     |
| **Kategórie subjektov údajov** | Pozývaní zamestnanci / externí spolupracovníci tenant-a                                                                                                                             |
| **Príjemcovia**                | Tenant ADMIN + ASSET_MANAGER (list pending); pozývaný (e-mail s linkom); Ecomail.cz / Resend (e-mail delivery)                                                                      |
| **Cezhraničné prenosy**        | Žiadne pre primárne uloženie. E-mail prechádza cez Ecomail.cz (EÚ) ako default                                                                                                      |
| **Retention**                  | Pending invitations: 7 dní platnosť tokenu, po expirácii možno revoke / re-invite. Revoked invitations: soft-deleted, 24 mesiacov ako u bežných users                               |
| **Technické opatrenia**        | 32-byte random hex token; verejný preview endpoint vracia 410 pre invalid / expired token bez leakovania e-mailu; argon2id hash hesla pri accept; e-mail v transakčnom kanáli s TLS |
| **Organizačné opatrenia**      | RBAC: ADMIN + ASSET_MANAGER môžu pozývať; ASSET_MANAGER nemôže pozvať ADMIN-a; voliteľný `enforceAllowedDomains` flag obmedzuje pozývanie len na firemné domény tenant-a            |
| **Mongo collection**           | `users` (pending invites majú `passwordHash=null` + `emailVerified=false` + `emailVerificationToken=<token>`)                                                                       |
| **Audit log actions**          | `USER_INVITED`, `USER_INVITATION_REVOKED`, `USER_INVITATION_ACCEPTED`                                                                                                               |

### 1.5. Audit log (cross-cutting)

| Pole                           | Hodnota                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Účel spracovania**           | Vedenie immutable append-only záznamu o významných akciách v systéme. Forenzika, GDPR čl. 5 ods. 2 accountability, security incident response, audit support pre tenant-a                                                                                                                                                                         |
| **Právny základ**              | Splnenie zákonnej povinnosti tenant-a (písm. c — čl. 5 ods. 2 GDPR accountability); oprávnený záujem (písm. f) — bezpečnosť                                                                                                                                                                                                                       |
| **Kategórie osobných údajov**  | `actor.userId`, `actor.displayName` (snapshot v čase akcie), `actor.accountType`, `actor.ipAddress`, `actor.userAgent`; `target.entityId` referencujúci dotknutý záznam; voliteľný `changes` diff (pred/po); `legalBasis` + `dataCategories` mapping na GDPR čl. 30                                                                               |
| **Kategórie subjektov údajov** | Všetci používatelia systému ako aktéri; subjekty údajov v target entities                                                                                                                                                                                                                                                                         |
| **Príjemcovia**                | Tenant administrátor (read prístup k tenant audit logu); LTK Solutions security operations                                                                                                                                                                                                                                                        |
| **Cezhraničné prenosy**        | Žiadne                                                                                                                                                                                                                                                                                                                                            |
| **Retention**                  | **24 mesiacov** pre štandardné akcie (CRUD); **60 mesiacov** pre auth + role-change + security udalosti; **84 mesiacov** pre tenant lifecycle udalosti (`ORGANISATION_*`). Po retention pseudonymizácia (`actor.userId` → `'PSEUDONYMIZED'`, `actor.displayName` a `actor.ipAddress` vymazané, zachovanie typu akcie a timestampu pre štatistiky) |
| **Technické opatrenia**        | Append-only collection (žiadny UPDATE/DELETE z aplikácie); index na `(target.entityType, target.entityId)`, `actor.userId`, `at`, `action`, `severity`                                                                                                                                                                                            |
| **Organizačné opatrenia**      | Read access len pre ADMIN role v rámci tenant-a; retention job spúšťaný cron-om (planned)                                                                                                                                                                                                                                                         |
| **Mongo collection**           | `audit_logs`                                                                                                                                                                                                                                                                                                                                      |
| **Schema**                     | `packages/shared-types/src/schemas/audit-log.ts` — Zod schéma + 50+ enum hodnôt pre `action`                                                                                                                                                                                                                                                      |

#### GDPR-relevantné polia v audit log zázname

Každý novo zapísaný audit záznam (od Phase D / Slice #2c) obsahuje dve polia, ktoré priamo mapujú čl. 30 GDPR:

| Field             | Typ                                        | Účel                                                                                                                                                                             |
| ----------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `legalBasis`      | enum (`contract`, `legal_obligation`, ...) | Právny základ spracovania podľa čl. 6 ods. 1 GDPR. Mapping na akciu rieši helper `defaultLegalBasisFor()` v `audit.service.ts`. Override možný cez `RecordEventInput.legalBasis` |
| `dataCategories`  | array kategórií                            | Ktoré kategórie osobných údajov sa akcia dotýka (čl. 30 ods. 1 písm. c). Defaultne odvodené cez `defaultDataCategoriesFor()`. Prázdne pole = akcia nespracuje os. údaje          |
| `pseudonymizedAt` | timestamp \| null                          | Kedy retention job pseudonymizoval záznam. `null` pre aktuálne ne-pseudonymizované záznamy                                                                                       |

### 1.6. Tenant lifecycle (Organisations)

| Pole                           | Hodnota                                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Účel spracovania**           | Vedenie tenant identity (názov organizácie, slug, brand kit, plán, status, settings — vrátane MFA policy, invitation policy, allowed auth providers, allowed domains) |
| **Právny základ**              | Plnenie zmluvy s tenant-om (písm. b)                                                                                                                                  |
| **Kategórie osobných údajov**  | `primaryContactEmail` (e-mail tenant administrátora). Nepriamo cez `createdBy`/`updatedBy` audit poliach                                                              |
| **Kategórie subjektov údajov** | Štatutári a IT administrátori tenant-ovských organizácií                                                                                                              |
| **Príjemcovia**                | Platform ADMIN (LTK Solutions); tenant samotný                                                                                                                        |
| **Cezhraničné prenosy**        | Žiadne                                                                                                                                                                |
| **Retention**                  | Aktívne tenanty: počas trvania zmluvy. Po ukončení zmluvy: 60 mesiacov (účtovné), potom anonymizácia s zachovaním štatistík                                           |
| **Technické opatrenia**        | Soft delete cez `deletedAt`/`deletedBy`; status enum (ACTIVE, SUSPENDED, ARCHIVED); auth middleware reject pre suspended/archived tenants                             |
| **Mongo collection**           | `organisations`                                                                                                                                                       |
| **Audit log actions**          | `ORGANISATION_CREATED`, `ORGANISATION_UPDATED`, `ORGANISATION_DELETED`                                                                                                |

---

## 2. Sub-processors (Article 28)

Aktuálny zoznam sub-processors je vedený v samostatnom verejne dostupnom dokumente: [**legal/sub-processors.md**](./legal/sub-processors.md) a publikovaný na https://inventario.estate/sub-processors.

Sumár pre rýchly prehľad:

| Sub-processor                | Účel                                             | Lokalita dát                     | Transferový mechanizmus   |
| ---------------------------- | ------------------------------------------------ | -------------------------------- | ------------------------- |
| **Vercel Inc.**              | Hosting frontend + API                           | EÚ (cdg1, fra1)                  | EU-US DPF + SCCs          |
| **MongoDB, Inc.**            | Hosting produkčnej DB (Atlas Flex)               | EÚ (AWS eu-central-1, Frankfurt) | EU-US DPF + SCCs          |
| **Ecomail.cz, s.r.o.**       | Transakčné e-maily (default)                     | EÚ (Česká republika)             | Žiadny — spracovanie v EÚ |
| **Microsoft Ireland**        | OAuth identity (Entra ID)                        | EÚ (configurable per tenant)     | Microsoft DPA + SCCs      |
| **Google Ireland**           | OAuth identity (Google Sign-In)                  | EÚ + globally                    | Google DPA + SCCs         |
| **Apple Distribution Int.**  | OAuth identity (Sign in with Apple) — _planned_  | EÚ + globally                    | Apple DPA + SCCs          |
| **Resend, Inc.** (voliteľný) | Alternatívne e-mail delivery — per-tenant opt-in | USA                              | EU-US DPF + SCCs          |

**Anthropic, PBC** je AI nástroj používaný iba pri vývoji platformy a **NIE JE sub-processor** — nemá runtime prístup k Inventario ani k osobným údajom tenant-a. Detaily v sub-processors.md.

---

## 3. Práva subjektov údajov (Chapter III)

LTK Solutions ako sprostredkovateľ **nesplňa žiadosti dotknutých osôb priamo** — to je povinnosť prevádzkovateľa (tenant-a). LTK Solutions poskytuje **funkčnosť v platforme** ktorá tenant-administrátorovi umožňuje žiadosti splniť. Pri priamom kontakte od dotknutej osoby LTK Solutions presmeruje žiadosť na príslušného tenant-a do 5 pracovných dní (viď DPA bod 3.5.3).

Implementačný stav per právo:

| Právo (čl.)                           | Stav         | Spôsob plnenia (tenant admin)                                                                                                                   |
| ------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Art. 15 — Right of access**         | ✅ Hotové    | `GET /v1/users/:id` v admin UI; samostatný JSON export celého profilu cez tenant administrátora                                                 |
| **Art. 16 — Right to rectification**  | ✅ Hotové    | Tenant admin cez `PATCH /v1/users/:id`; self-service `PATCH /v1/me` (planned in slice #8+)                                                      |
| **Art. 17 — Right to erasure**        | ⏳ Čiastočne | Soft delete cez `DELETE /v1/users/:id` (existuje); hard erasure / GDPR delete cez asynchronous job po 30 dni od soft delete (planned slice #8+) |
| **Art. 18 — Right to restrict**       | ⏳ Plánované | Cez nový `isRestricted` flag na User; UI v slice #8+                                                                                            |
| **Art. 19 — Notification obligation** | n/a          | Žiadny tretí príjemca PII (sub-processors sú processors, nie recipients v zmysle čl. 19)                                                        |
| **Art. 20 — Data portability**        | ⏳ Plánované | Súčasť `GET /v1/me/export` — slice #8+                                                                                                          |
| **Art. 21 — Right to object**         | ✅ Hotové    | Tenant nastavuje účely; subject sa môže obrátiť na tenant administrátora                                                                        |
| **Art. 22 — Automated decisions**     | n/a          | Žiadne automated decision making s legal/significant effect v platforme                                                                         |

Operatívne procesy pre žiadosti subjektov údajov:

1. Žiadosť dotknutej osoby ide **primárne na tenant administrátora** (e-mail uvedený v Privacy Policy tenant-a)
2. Pri kontakte priamo LTK Solutions na privacy@inventario.estate — LTK presmeruje na príslušného tenant-a do 5 pracovných dní
3. Identita žiadateľa overená cez prihlásenie do platformy (alebo cez kontaktnú adresu tenant administrátora pri externe pôsobiacich osobách)
4. Spracovanie do 30 dní (čl. 12 ods. 3)
5. Audit log akcia `DATA_EXPORT_REQUESTED` alebo `DATA_DELETION_REQUESTED`

---

## 4. Bezpečnostné opatrenia (Article 32)

### 4.1. Technické

| Opatrenie                 | Implementácia                                                                                                                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Šifrovanie at-rest**    | Atlas default (AES-256 transparent). Vercel runtime ephemeral storage tiež šifrovaný                                                                                                                                                     |
| **Šifrovanie in-transit** | TLS 1.3 minimum, HSTS preload pre `inventario.estate`                                                                                                                                                                                    |
| **Autentifikácia**        | Multi-provider: Microsoft Entra ID OAuth, Google OAuth, Apple Sign-In (planned), Email-password (argon2id KDF). Inventario JWT cookies (RS256, keypair rotácia)                                                                          |
| **MFA**                   | TOTP (RFC 6238) s 6-digit code, 30s period, ±1 step window. AES-256-GCM šifrované secrets at rest. Argon2id-hashed recovery codes. Per-tenant policy (DISABLED/OPTIONAL/REQUIRED)                                                        |
| **Autorizácia**           | Tenant-scoped RBAC s 5 rolami (EMPLOYEE, TEAM_MANAGER, ASSET_MANAGER, ADMIN, EXTERNAL); FK protection cez transactions                                                                                                                   |
| **Sieť**                  | Atlas allowlist (Vercel IPs in prod, 0.0.0.0/0 only na dev cluster pre CI); Vercel firewall default-deny                                                                                                                                 |
| **Tenant isolation**      | `organisationId` field na všetkých tenant-scoped collections, validated v každom service call cez `requireTenantId + tenantFilter` utility (apps/api/src/lib/organisation-scoping.ts). **17 cross-tenant isolation testov** v test suite |
| **Input validation**      | Zod schémy v `@inventario/shared-types` ako single source of truth; Fastify type provider odmieta neplatný request payload pred handlerom                                                                                                |
| **Output validation**     | Response schémy filtrujú citlivé fields (passwordHash, mfaSecret, mfaRecoveryCodes) sa odstraňujú vo vrstve repository, nie na UI                                                                                                        |
| **Audit log**             | Append-only, immutable z aplikácie; tenant-scoped read access                                                                                                                                                                            |
| **Rate limiting**         | 10 pokusov / 15 minút / IP na login endpointoch; 20 / 15 min na invitation creation; 5 / 15 min na MFA setup                                                                                                                             |

### 4.2. Organizačné

| Opatrenie                            | Detail                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **Mlčanlivosť**                      | Všetci zamestnanci LTK Solutions a sub-procesori sú viazaní mlčanlivosťou (zmluvne aj zákonne)      |
| **Prístup k produkčným dátam**       | Obmedzený na konateľa a oprávnený technický personál. Logovaný cez audit log MongoDB Atlas          |
| **Conventional Commits + PR review** | Každá zmena kódu prechádza review procesom. Žiadne deployments bez code review                      |
| **CodeQL**                           | Týždenný security scan (`security-extended` query pack)                                             |
| **SBOM**                             | Generovaný v CI pre každý push (CycloneDX 1.6, 90-day retention)                                    |
| **Dependabot**                       | Automatické sledovanie závislostí a security patches                                                |
| **REUSE 3.3 compliance**             | Compliance check v lint stage — všetky súbory licensované                                           |
| **Open source verejnosť**            | Kód auditovateľný komunitou (no security through obscurity), EUPL-1.2 licencia                      |
| **Vendor security review**           | Pri pridaní nového sub-procesora                                                                    |
| **Incident response**                | Procesný dokument **Breach Notification Plan** (planned — pred go-live prvého produkčného tenant-a) |
| **Penetration testing**              | Planned — prvý test pred go-live SFZ pilotu; následne ročne                                         |
| **Security awareness**               | Informálne pre malý tím (3 osoby); formálny program _planned_ pri raste tímu nad 10 osôb            |
| **Vedenie záznamov**                 | Tento dokument + `gdpr-article-30-controller.md` + `audit_logs` MongoDB collection                  |
| **Tabletop exercises**               | Plánované pred prvým produkčným launchom — simulácia data breach scenárov                           |

---

## 5. Postupy pre incidenty (Article 33 — 34)

V prípade porušenia ochrany osobných údajov v platforme Inventario:

1. **Detekcia** — cez Atlas Anomaly Detection alebo manuálny audit log review. Severity `ERROR` alebo `CRITICAL` v `audit_logs` aktivuje alert
2. **Containment** — okamžitý revoke ohrozených JWT, rotácia secrets ak dotknuté, isolation dotknutého tenant-a (`status: SUSPENDED`)
3. **Oznámenie tenant-ovi (prevádzkovateľovi)** podľa DPA — **do 24 hodín** od zistenia (rozšírený štandard nad rámec čl. 33 GDPR)
4. **Pomoc tenantovi** s oznámením ÚOOÚ SR do 72 hodín od zistenia (čl. 33 ods. 1) a notifikáciou dotknutých osôb ak hrozí "high risk to the rights and freedoms" (čl. 34 ods. 1)
5. **Post-mortem** verejný (pre open-source komunitu) cez GitHub Security Advisory + CVE registration (ak relevantné a bezpečné disclosure)

**Tenant** je vždy zodpovedný za posúdenie či Porušenie podlieha oznámeniu dozornému orgánu a/alebo dotknutým osobám, a za samotné odoslanie oznámenia.

Detaily Breach Notification Plan-u sú v samostatnom dokumente (planned — pred SFZ pilot launchom).

---

## 6. Retention schedule (sumár)

| Kolekcia / kategória               | Retention         | Akcia po expirácii                                                                  |
| ---------------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| Aktívne `users`                    | Trvanie zmluvy    | —                                                                                   |
| Soft-deleted `users`               | 24 mesiacov       | Pseudonymizácia (`PSEUDONYMIZED` placeholder), `USER_PSEUDONYMIZED` audit log entry |
| Pending invitations                | 7 dní (token TTL) | Token expiruje, dokument zostáva pre 24 mesiacov pre štatistiky / audit             |
| Aktívne `organisations`            | Trvanie zmluvy    | —                                                                                   |
| Soft-deleted `organisations`       | 60 mesiacov       | Anonymizácia s zachovaním štatistík                                                 |
| Aktívne `assets`                   | Životnosť majetku | —                                                                                   |
| Soft-deleted `assets`              | 60 mesiacov       | Hard delete                                                                         |
| Aktívne `loans`                    | Trvanie pôžičky   | —                                                                                   |
| Ukončené `loans`                   | 60 mesiacov       | Hard delete                                                                         |
| `loan_protocols` (HANDOVER/RETURN) | 60 mesiacov       | Hard delete (vrátane PDF v storage)                                                 |
| Audit log — bežné akcie            | 24 mesiacov       | Pseudonymizácia osobných polí v audit entry                                         |
| Audit log — auth / role / sec      | 60 mesiacov       | Pseudonymizácia osobných polí                                                       |
| Audit log — `ORGANISATION_*`       | 84 mesiacov       | Pseudonymizácia (tenant lifecycle udalosti potrebné pre účtovný audit dlhšie)       |
| MongoDB Atlas backups              | 90 dní            | Cyklické prepisovanie                                                               |
| Vercel access logs                 | 7 dní             | Vercel default rotácia                                                              |
| Ecomail delivery logs              | 30 dní            | Ecomail default rotácia                                                             |

> **Implementačná poznámka**: retention job pre Mongo pseudonymizáciu nie je v aktuálnej fáze plne automatizovaný — beží manuálne pred prvým produkčným launchom a potom plánovane mesačne ako Vercel cron job.

---

## 7. DPA — Zmluvný rámec s tenant-mi

LTK Solutions uzatvára s každým tenantom **Zmluvu o spracúvaní osobných údajov (DPA)** podľa čl. 28 GDPR. Šablóna DPA je dostupná ako [`docs/compliance/legal/dpa-template.md`](./legal/dpa-template.md).

DPA pokrýva:

- Predmet a rozsah spracovania (odkaz na Prílohu 1 — Opis spracovania)
- Bezpečnostné opatrenia (odkaz na Prílohu 2 — Technické a organizačné opatrenia)
- Sub-processors a notifikácia o zmenách (odkaz na Prílohu 3 + verejný sub-processors list)
- Pomoc s právami subjektov údajov
- Breach notification (24h voči tenantu, 72h voči ÚOOÚ)
- Audit cooperation
- Pomoc s DPIA tenant-a
- Return/delete dát po skončení zmluvy

---

## 8. Threshold Assessment — DPIA pre processor scope

Sprostredkovateľ **nemá povinnosť vyhotoviť vlastnú DPIA** podľa čl. 35 GDPR — DPIA je povinnosť prevádzkovateľa (tenant-a). LTK Solutions napriek tomu vyhotovil **formálny threshold assessment** pre platformu Inventario ako celok ako dôkaz accountability princípu a ako podporný materiál pre tenant-ov:

- [**Threshold Assessment / DPIA Pre-screen**](./threshold-assessment.md) — formálne posúdenie podľa čl. 35 ods. 3 GDPR, EDPB Guidelines WP248 rev.01 a zoznamu ÚOOÚ SR. **Záver: DPIA nie je povinná** pre platformu Inventario ako celok v jej súčasnom funkčnom rozsahu.

Nad rámec threshold dokumentu poskytuje LTK Solutions **podporu tenant-om** pri vyhotovovaní ich DPIA cez:

1. **Tento dokument** ako technický opis spracúvania
2. **DPA Template** s detailami opatrení a sub-processors
3. **Threshold Assessment** ako prílohu k tenant-ovmu vlastnému threshold assessmentu
4. **DPIA Reference Pack** (planned — publikovaný na https://inventario.estate/dpia) — pre-filled template DPIA ktorý tenant prispôsobí svojmu kontextu

Pre **vlastné business operations** LTK Solutions (mimo platformy Inventario) viď [Threshold Assessment v gdpr-article-30-controller.md sekcia 6](./gdpr-article-30-controller.md#6-threshold-assessment-dpia).

---

## 9. Zmenová história

| Verzia | Dátum                        | Zmena                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0    | 17. máj 2026                 | Prvá verzia. Phase D Blok 4 — Article 30 inventár, sub-processors, rights, security, breach. Originálne pripravené v kontexte SFZ/SportUp interného projektu.                                                                                                                                                                                                          |
| 2.0    | _\[doplniť pri publikácii\]_ | Refactor pre multi-tenant SaaS kontext — LTK Solutions ako sprostredkovateľ pre tenantov platformy Inventario. Aktualizovaná doména, kontakty, multi-provider auth (Slice #6), TOTP MFA (Slice #7), invitations (Slice #6c K18), loans (Slice #5). Pridaný odkaz na Controller view ([gdpr-article-30-controller.md](./gdpr-article-30-controller.md)) a DPA Template. |

---

## 10. Referencie

- [Nariadenie (EÚ) 2016/679 (GDPR)](https://eur-lex.europa.eu/eli/reg/2016/679/oj) — najmä čl. 4, 5, 6, 9, 12 — 22, 28, 30 ods. 2, 32 — 36, 37
- [Zákon č. 18/2018 Z. z. o ochrane osobných údajov](https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2018/18/) — slovenská implementácia GDPR
- [ÚOOÚ — Záznamy o spracovateľských činnostiach (čl. 30)](https://dataprotection.gov.sk/) — slovenský dozorný orgán
- [Rozhodnutie Komisie 2021/914 — Štandardné zmluvné doložky](https://eur-lex.europa.eu/eli/dec_impl/2021/914/oj) — SCCs Module 2 (Controller to Processor)
- [Microsoft Entra ID GDPR Compliance](https://learn.microsoft.com/en-us/compliance/regulatory/gdpr)
- [MongoDB Atlas Data Protection Addendum](https://www.mongodb.com/legal/dpa)
- [Vercel Data Processing Addendum](https://vercel.com/legal/dpa)
- [Ecomail.cz — Ochrana osobních údajů](https://www.ecomail.cz/podminky/ochrana-osobnich-udaju/)
- [GDPR čl. 30 ods. 1 — Controller view (LTK vlastné spracovanie)](./gdpr-article-30-controller.md)
- [DPA Template](./legal/dpa-template.md)
- [Sub-processor list](./legal/sub-processors.md)

---

**Tento dokument je živý** — po každom väčšom feature changu (nový modul, nový sub-processor, zmena retention) sa aktualizuje a inkrementuje verzia. Git history slúži ako audit trail jeho samotného.
