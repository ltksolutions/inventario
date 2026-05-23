<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Inventario API — referencia

|                  |                                           |
| ---------------- | ----------------------------------------- |
| **Verzia API**   | v1                                        |
| **Špecifikácia** | OpenAPI 3.1 — `apps/api/openapi.json`     |
| **Swagger UI**   | `http://localhost:3000/docs` (dev)        |
| **Base URL**     | `https://asset-management-api.vercel.app` |
| **Auth**         | httpOnly cookie `inv_access` (RS256 JWT)  |
| **Status**       | ✅ Produkcia                              |

> **Primárny zdroj pravdy** je generovaný súbor `apps/api/openapi.json`.
> Tento dokument je ľudsky čitateľný sprievodca; Swagger UI na `/docs`
> má vždy aktuálne schémy.

---

## Autentifikácia

Inventario používa **httpOnly cookie** flow — nie Bearer tokeny v headeri.

### Prihlásenie (email + heslo)

```http
POST /v1/auth/login
Content-Type: application/json

{ "email": "jan@firma.sk", "password": "..." }
```

Odpoveď nastaví dve httpOnly cookies:

| Cookie        | Path               | Platnosť | Popis                  |
| ------------- | ------------------ | -------- | ---------------------- |
| `inv_access`  | `/`                | 15 min   | RS256 JWT access token |
| `inv_refresh` | `/v1/auth/refresh` | 30 dní   | opaque refresh token   |

### Prihlásenie cez OAuth (Google / Microsoft)

```http
GET /v1/auth/login/google?redirectAfter=/assets
GET /v1/auth/login/microsoft
```

Redirect na provider → callback → cookies nastavené automaticky.

### Refresh tokenu

```http
POST /v1/auth/refresh
```

Rotuje `inv_refresh` a vydá nový `inv_access`. Volá sa automaticky frontendovým klientom.

### Odhlásenie

```http
POST /v1/auth/logout
```

Zmaže oba cookies a revokuje refresh token v DB.

### JWT payload

```json
{
  "sub": "507f1f77bcf86cd799439011", // user _id
  "org": "507f1f77bcf86cd799439012", // aktívna organisationId
  "mid": "507f1f77bcf86cd799439013", // aktívna membershipId (K5)
  "roles": ["ADMIN"], // z activeMembership (autoritatívne)
  "email": "jan@firma.sk",
  "name": "Ján Novák"
}
```

---

## Multi-tenant kontext

Každý request je scopovaný na jeden tenant (Organisation). Aktívny tenant
je určený JWT claimom `org`. Pre prepnutie tenanta použite switch endpoint:

```http
POST /v1/auth/switch-organisation
Content-Type: application/json

{ "organisationId": "507f1f77bcf86cd799439099" }
```

Vydá nové cookies s novým `org` + `mid` + `roles`.

---

## RBAC — role a oprávnenia

| Rola            | Číta | Píše assets | Schvaľuje výpožičky | Admin |
| --------------- | ---- | ----------- | ------------------- | ----- |
| `EXTERNAL`      | ✅   | ✗           | ✗                   | ✗     |
| `EMPLOYEE`      | ✅   | ✗           | ✗                   | ✗     |
| `TEAM_MANAGER`  | ✅   | ✗           | čiastočne           | ✗     |
| `ASSET_MANAGER` | ✅   | ✅          | ✅                  | ✗     |
| `ADMIN`         | ✅   | ✅          | ✅                  | ✅    |

Role sú per-tenant — ten istý používateľ môže byť `ADMIN` v org A a `EMPLOYEE` v org B.

---

## Paginovanie

Všetky listové endpointy používajú **offset paginovanie**:

```http
GET /v1/assets?limit=50&skip=0
```

Odpoveď:

```json
{
  "data": [...],
  "pagination": {
    "total": 243,
    "limit": 50,
    "skip": 0,
    "hasMore": true
  }
}
```

---

## Chybové odpovede

```json
{
  "statusCode": 400,
  "error": "BadRequest",
  "message": "Heslo musí mať aspoň 12 znakov."
}
```

Validačné chyby (Zod) obsahujú aj `issues[]`:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Request validation failed",
  "issues": [
    { "path": "email", "message": "Invalid email", "code": "invalid_string" }
  ]
}
```

---

## Rate limiting

- Default: 100 req/min per IP
- Prísnejšie limity na auth endpointoch (login, register, invite)
- V teste: rate limiting vypnutý

---

## Endpointy — prehľad

### Auth (`/v1/auth/...`)

| Metóda   | Endpoint                       | Popis                                                     |
| -------- | ------------------------------ | --------------------------------------------------------- |
| `POST`   | `/v1/auth/login`               | Email + heslo login                                       |
| `POST`   | `/v1/auth/logout`              | Odhlásenie                                                |
| `POST`   | `/v1/auth/refresh`             | Rotácia refresh tokenu                                    |
| `GET`    | `/v1/auth/login/:provider`     | OAuth redirect (google/microsoft)                         |
| `GET`    | `/v1/auth/callback/:provider`  | OAuth callback                                            |
| `GET`    | `/v1/auth/me`                  | Aktuálny user + activeMembership + availableOrganisations |
| `DELETE` | `/v1/auth/me`                  | GDPR erasure (anonymizácia + soft-delete memberships)     |
| `POST`   | `/v1/auth/switch-organisation` | Prepnutie aktívneho tenanta                               |
| `GET`    | `/v1/auth/invitations/:token`  | Preview pozvanky (acceptMode + existingUserPreview)       |
| `POST`   | `/v1/auth/accept-invitation`   | Prijatie pozvanky (new-user aj existing-user)             |
| `POST`   | `/v1/auth/register`            | Registrácia nového teantu                                 |

### MFA (`/v1/auth/mfa/...`)

| Metóda | Endpoint                     | Popis                                |
| ------ | ---------------------------- | ------------------------------------ |
| `POST` | `/v1/auth/mfa/setup`         | Vygeneruje TOTP secret + QR URL      |
| `POST` | `/v1/auth/mfa/verify-setup`  | Aktivuje MFA (prvý TOTP kód)         |
| `POST` | `/v1/auth/mfa/disable`       | Deaktivuje MFA (password re-entry)   |
| `GET`  | `/v1/auth/mfa/status`        | Stav MFA pre aktuálneho usera        |
| `POST` | `/v1/auth/mfa/challenge`     | TOTP alebo recovery kód po 202 login |
| `GET`  | `/v1/auth/mfa/forced-setup`  | Token pre forced MFA setup           |
| `POST` | `/v1/auth/mfa/forced-verify` | Verify pri forced setup              |

### Memberships (`/v1/memberships/...`)

| Metóda   | Endpoint                      | RBAC             | Popis                                    |
| -------- | ----------------------------- | ---------------- | ---------------------------------------- |
| `GET`    | `/v1/memberships`             | ADMIN            | Zoznam členov org (s displayName, email) |
| `GET`    | `/v1/memberships/:id`         | ADMIN alebo self | Detail membership                        |
| `PATCH`  | `/v1/memberships/:id`         | ADMIN            | Zmena rolí, statusu, notifikácií         |
| `DELETE` | `/v1/memberships/:id`         | ADMIN alebo self | Soft-delete (last-admin guard)           |
| `POST`   | `/v1/memberships/:id/default` | self             | Nastavenie default org                   |

### Pozvánky (`/v1/invitations/...`)

| Metóda   | Endpoint                     | RBAC                 | Popis                                 |
| -------- | ---------------------------- | -------------------- | ------------------------------------- |
| `POST`   | `/v1/invitations`            | ADMIN, ASSET_MANAGER | Nová pozv. (cross-tenant email match) |
| `GET`    | `/v1/invitations`            | ADMIN, ASSET_MANAGER | Zoznam pending pozvaniek              |
| `DELETE` | `/v1/invitations/:id`        | ADMIN, ASSET_MANAGER | Revoke pozvanky                       |
| `POST`   | `/v1/invitations/:id/resend` | ADMIN, ASSET_MANAGER | Znova odoslať (nový token + +7d)      |

### Majetok (`/v1/assets/...`)

| Metóda   | Endpoint         | RBAC                 | Popis         |
| -------- | ---------------- | -------------------- | ------------- |
| `GET`    | `/v1/assets`     | EMPLOYEE+            | Zoznam aktív  |
| `GET`    | `/v1/assets/:id` | EMPLOYEE+            | Detail aktíva |
| `POST`   | `/v1/assets`     | ASSET_MANAGER, ADMIN | Vytvorenie    |
| `PATCH`  | `/v1/assets/:id` | ASSET_MANAGER, ADMIN | Aktualizácia  |
| `DELETE` | `/v1/assets/:id` | ADMIN                | Soft-delete   |

### Kategórie a lokality

| Metóda   | Endpoint             | RBAC                 | Popis                  |
| -------- | -------------------- | -------------------- | ---------------------- |
| `GET`    | `/v1/categories`     | EMPLOYEE+            | Zoznam                 |
| `POST`   | `/v1/categories`     | ASSET_MANAGER, ADMIN | Vytvorenie             |
| `PATCH`  | `/v1/categories/:id` | ASSET_MANAGER, ADMIN | Aktualizácia           |
| `DELETE` | `/v1/categories/:id` | ADMIN                | Soft-delete (FK guard) |
| `GET`    | `/v1/locations`      | EMPLOYEE+            | Zoznam                 |
| `POST`   | `/v1/locations`      | ASSET_MANAGER, ADMIN | Vytvorenie             |
| `PATCH`  | `/v1/locations/:id`  | ASSET_MANAGER, ADMIN | Aktualizácia           |
| `DELETE` | `/v1/locations/:id`  | ADMIN                | Soft-delete (FK guard) |

### Výpožičky

| Metóda   | Endpoint                        | RBAC                 | Popis               |
| -------- | ------------------------------- | -------------------- | ------------------- |
| `POST`   | `/v1/loan-requests`             | EMPLOYEE+            | Nová žiadosť        |
| `GET`    | `/v1/loan-requests`             | EMPLOYEE+            | Zoznam (self / all) |
| `POST`   | `/v1/loan-requests/:id/approve` | ASSET_MANAGER, ADMIN | Schválenie          |
| `POST`   | `/v1/loan-requests/:id/reject`  | ASSET_MANAGER, ADMIN | Odmietnutie         |
| `DELETE` | `/v1/loan-requests/:id`         | EMPLOYEE+            | Zrušenie            |
| `GET`    | `/v1/loans`                     | EMPLOYEE+            | Aktívne výpožičky   |
| `GET`    | `/v1/loans/my`                  | EMPLOYEE+            | Vlastné výpožičky   |
| `POST`   | `/v1/loans/:id/return`          | ASSET_MANAGER, ADMIN | Vrátenie            |

### Používatelia a organizácie

| Metóda   | Endpoint            | RBAC   | Popis                    |
| -------- | ------------------- | ------ | ------------------------ |
| `GET`    | `/v1/me`            | auth   | Základný profil (legacy) |
| `GET`    | `/v1/users`         | ADMIN  | Zoznam userov            |
| `GET`    | `/v1/users/:id`     | ADMIN  | Detail usera             |
| `PATCH`  | `/v1/users/:id`     | ADMIN  | Zmena rolí + isActive    |
| `DELETE` | `/v1/users/:id/mfa` | ADMIN  | Reset MFA                |
| `GET`    | `/v1/organisations` | ADMIN  | Zoznam org (vlastníctvo) |
| `POST`   | `/v1/organisations` | SYSTEM | Nová org                 |

---

## Kľúčové dátové modely

### User (globálna identita)

```typescript
{
  _id: string; // MongoDB ObjectId
  email: string; // globálny unikátny
  firstName: string;
  lastName: string;
  displayName: string;
  accountType: 'LOCAL' | 'ENTRA_ID';
  authProviders: Array<{ provider; providerId; email; linkedAt }>;
  isActive: boolean; // globálny suspend
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  preferences: {
    language: 'sk' | 'en';
    timezone: string;
  }
}
```

### Membership (per-tenant kontext)

```typescript
{
  _id: string;
  userId: string;           // ref → User
  organisationId: string;   // ref → Organisation (tenant)
  roles: UserRole[];        // autoritatívny zdroj rolí
  status: 'ACTIVE' | 'SUSPENDED';
  isDefault: boolean;       // max 1 per user
  notifications: { email: boolean; push: boolean };
  lastAccessedAt: string | null;
}
```

### Invitation

```typescript
{
  _id: string;
  email: string;
  organisationId: string;
  roles: UserRole[];
  invitedUserId: string | null;   // null = new-user; set = cross-tenant
  token: string;                  // 64 hex chars, 7-dňová platnosť
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
  acceptedAt: string | null;
}
```

---

## Lokálny vývoj

```bash
# Spustenie API servera
pnpm --filter @inventario/api dev

# Swagger UI
open http://localhost:3000/docs

# Export OpenAPI spec (s Atlas pripojením)
pnpm --filter @inventario/api openapi:export

# Export OpenAPI spec (offline, MongoMemoryServer)
pnpm --filter @inventario/api openapi:export:offline
```

---

## Migrácie

Po každom deployi sa automaticky spustí migration runner pri boote Fastify:

```
apps/api/src/migrations/2026-05-23-memberships.ts
```

Idempotentný — bezpečné spustiť viackrát. Výsledok uložený v kolekcii `migrations`.
