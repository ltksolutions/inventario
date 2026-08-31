<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0015. Cross-tenant memberships — User ↔ Organisation many-to-many

|                   |                                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | ✅ Accepted                                                                                                                                                                                               |
| **Dátum**         | 2026-05-23                                                                                                                                                                                                |
| **Autori**        | Ján Letko, Claude Opus 4.7 (LTK Solutions)                                                                                                                                                                |
| **Súvisiace ADR** | [0010 Multi-tenant white-label](0010-multi-tenant-white-label.md), [0013 Multi-provider auth + self-serve](0013-multi-provider-auth-self-serve.md), [0014 Passkeys / WebAuthn](0014-passkeys-webauthn.md) |

## Kontext

Inventario je v produkcii (launch-ready 100%, 511/511 testov). Aktuálne má _User ↔ Organisation_ vzťah **1:1**: každý User má presne jeden `organisationId` (cez `OrganisationScopedSchema`) a jeden set rolí v rámci toho tenantu. Pre prvý SFZ pilot je to dostatočné.

Pre druhý a ďalší tenant však narazíme na limit. Reálny scenár: zamestnanec SFZ-ky je registrovaný na `jan@futbalsfz.sk`. Mesto Pezinok ho chce pozvať ako externého správcu majetku do svojho Inventaria. Aktuálny systém túto pozvánku **odmietne s `400 EMAIL_ALREADY_EXISTS`**, lebo `users.email` má globálny unique index a invitations sa ukladajú ako "ghost users" do tej istej collection.

ADR-0013 (multi-provider auth) ani K18 (invite flow) tento prípad neriešili — boli vedome odložené ako "cross-tenant invites" feature. Tento ADR zavádza datový a logický model, ktorý ten prípad pokrýva.

### Existujúci stav

**User dokument** je single-tenant (`packages/shared-types/src/schemas/user.ts`):

```ts
UserSchema = BaseDocumentSchema
  .merge(SoftDeleteSchema)
  .merge(OrganisationScopedSchema)  // ← organisationId: string (single value)
  .extend({
    email, firstName, lastName, displayName, phone,
    accountType, entraOid, authProviders[], emailVerified,
    passwordHash, roles[], organizationalUnit, teams[],
    isActive, lastLoginAt, invitationSentAt, mustChangePassword,
    mfaEnabled, mfaSecret, mfaRecoveryCodes, mfaEnabledAt,
    preferences, // language, timezone, emailNotifications, pushNotifications
  });
```

**Invitations modul** (`apps/api/src/modules/invitations/invitations.repository.ts`) ukladá pending pozvánky **ako User dokumenty** s `passwordHash: null, emailVerified: false`. Filozofia "reuse the email unique constraint" funguje pre single-tenant, ale **bráni cross-tenant** — ak email už existuje, druhá pozvánka padne na E11000.

**JWT shape** (ADR-0013, K8):

```ts
{ sub, iss: 'inventario', aud: 'inventario-api',
  org: organisationId, roles: UserRole[],
  email, name, iat, exp }
```

JWT obsahuje statický `org` claim z User dokumentu. Žiadny pojem "aktívny tenant" mimo defaultu.

### Obmedzenia

- **Produkčné dáta** — máme aktívnu Atlas prod DB (sfz-asset-mgmt-prod) s tenant-om SFZ. Migrácia musí byť **zero-downtime** alebo s plánovaným < 5 min outage.
- **Backward compat** — existujúce klienty (web, mobilná appka neskôr, MCP server roadmap) musia fungovať počas a po migrácii.
- **GDPR right-to-erasure** — keď user zmaže účet, dáta musia byť anonymizované **vo všetkých tenantoch**. Existujúci `deletedAt` flow zatiaľ pracuje len v scope jedného tenantu.
- **Test coverage** — máme 511 testov, ktoré spoliehajú na `req.user.organisationId` z JWT. Refactor musí byť testovateľný bez plošného prepisu suite.
- **Audit log integrita** — existujúce audit log entries odkazujú na user/org cez stringy. Refactor nesmie rozbiť historické záznamy.

## Možnosti

### Možnosť A: Per-tenant User cloning

Pre cross-tenant invite duplikujeme User dokument — vznikne nový User v target tenant-e s rovnakým emailom, ale nezávislým `_id`, `passwordHash`, `authProviders`, `mfaSecret`, `preferences`. Pre overenie identity by sa muselo párovať cez `email`.

- **Plus:** Minimálny refactor schémy (pridať `email + organisationId` unique index namiesto globálneho). Audit log existing entries fungujú bez zmeny.
- **Mínus:** **Identitné peklo.** Jeden človek má N hesiel, N MFA seedov, N sád recovery codes. Pri zmene mena alebo telefónu sa to musí synchronizovať naprieč N tenantmi. OAuth account linking je nejednoznačný (Google sub patrí ktorému User dokumentu?). GDPR delete musí prejsť všetkými tenant-mi a deduplikovať. Bezpečnostné riziko: ak ho jeden tenant zmaže (alebo suspendne), v ostatných sa nič nestane → user pri prihlásení vidí dáta, kým by nemal. Zamietnuté.

### Možnosť B: Memberships table (User ↔ Organisation many-to-many)

Zavádzame **novú collection `memberships`** s `userId + organisationId` ako kompozitným unique kľúčom. User dokument zostáva **globálny** (jedna identita, jedno heslo, jedno MFA). Per-tenant kontext (roles, organizationalUnit, teams, per-tenant notification preferences) sa presunie na Membership. Invitations sa refactorujú na samostatnú collection s explicitným `invitedUserId: ObjectId | null` poľom.

- **Plus:** Čistá Single Source of Truth pre identitu (User). Známy pattern (Slack workspaces, Notion, GitHub orgs, Stripe Connect accounts). RBAC je per-membership, switching tenantov je explicit endpoint. GDPR delete = anonymizuj User + zmaž všetky memberships v jednej transakcii. OAuth linking je jednoznačný — provider patrí ku globálnemu Userovi. Audit log entries zostávajú správne (odkazy na `userId`/`organisationId` sa nemenia, len pribudne kontext).
- **Mínus:** Väčší refactor: nová collection, nový endpoint na tenant switch, JWT shape zmena (pridať `membershipId`), migration script. Single-tenant deployments (open-source self-host pre malé kluby) musia mať default flow keď user má len 1 membership. Last-admin protection treba dorobiť. Auth middleware musí načítať Membership pri každom requeste (cacheable, ale dodatočný query).

### Možnosť C: Cross-tenant invite bez schema refactor-u — len bypass email unique

Pre cross-tenant invite vyrobíme **deterministický suffix** (`jan@futbalsfz.sk` → `jan+pezinok@futbalsfz.sk`) a uložíme duplicitný User s pôvodným emailom v `aliasEmail` poli.

- **Plus:** Žiadne nové collections, žiadna JWT zmena.
- **Mínus:** **Email plus addressing je nespoľahlivý** — niektoré email systémy ho normalizujú, niektoré nepovolia, gmail ho ignoruje pri delivery ale validate ho zachová. Identitné peklo z Možnosti A znásobené (rovnaký človek má 5 emailov v DB). Phishing vector (útočník pozve `victim+attacker@gmail.com` a zachytí emaily cez Gmail rules). Audit log je nečitateľný. Zamietnuté.

## Rozhodnutie

Zvolili sme **Možnosť B: Memberships table**.

### Memberships collection

Nová collection `memberships` s nasledujúcou Zod schémou (`packages/shared-types/src/schemas/membership.ts`):

```ts
export const MembershipSchema = BaseDocumentSchema.merge(
  SoftDeleteSchema,
).extend({
  /** Reference to global User identity. */
  userId: ObjectIdSchema,

  /** Reference to the Organisation (tenant). */
  organisationId: ObjectIdSchema,

  /** Per-tenant roles. Was User.roles. */
  roles: z
    .array(z.enum(USER_ROLE_VALUES) as z.ZodType<UserRole>)
    .min(1, 'Membership musí mať aspoň jednu rolu.'),

  /** Per-tenant organizational unit. Was User.organizationalUnit. */
  organizationalUnit: z
    .object({
      id: ObjectIdSchema,
      name: z.string().min(1).max(200),
      type: z.enum(['SFZ_DEPARTMENT', 'NATIONAL_TEAM', 'CLUB', 'EXTERNAL_ORG']),
    })
    .nullable()
    .default(null),

  /** Per-tenant team memberships. Was User.teams. */
  teams: z
    .array(
      z.object({
        teamId: ObjectIdSchema,
        teamName: z.string().min(1).max(200),
        role: z.enum(['MEMBER', 'MANAGER', 'COACH', 'ASSISTANT']),
      }),
    )
    .default([]),

  /** Lifecycle status. */
  status: z.enum(['ACTIVE', 'SUSPENDED']).default('ACTIVE'),

  /** Whether this is the user's default tenant on login. Max one true per userId. */
  isDefault: z.boolean().default(false),

  /** Who created the membership (inviter for invites, self for self-serve). */
  invitedBy: z.union([ObjectIdSchema, z.literal('SYSTEM')]),

  /** When invite was issued (= membership row creation time). */
  invitedAt: TimestampSchema,

  /** When user accepted invite (null for self-serve where invite == accept). */
  acceptedAt: TimestampSchema.nullable().default(null),

  /** Per-tenant onboarding state. Was User.invitationSentAt / mustChangePassword. */
  mustChangePassword: z.boolean().default(false),

  /** Last time user accessed this tenant (for "switch to recently used" UX). */
  lastAccessedAt: TimestampSchema.nullable().default(null),

  /** Per-tenant notification preferences. Was User.preferences.{emailNotifications, pushNotifications}. */
  notifications: z
    .object({
      email: z.boolean().default(true),
      push: z.boolean().default(false),
    })
    .default({}),
});
```

**Indexes:**

- `{ userId: 1, organisationId: 1 }` — unique compound (one membership per user-tenant pair)
- `{ organisationId: 1, status: 1, deletedAt: 1 }` — list active members of a tenant
- `{ userId: 1, isDefault: 1 }` — partial unique index where `isDefault: true` (max 1 default per user)
- `{ userId: 1, deletedAt: 1 }` — list user's tenants

### User schema zmeny

Polia, ktoré sa **odstránia z User** (presúvajú sa na Membership):

- `organisationId` (cez `OrganisationScopedSchema`) — User už nie je tenant-scoped
- `roles[]` — per-tenant
- `organizationalUnit` — per-tenant
- `teams[]` — per-tenant
- `invitationSentAt` — per-tenant invite state
- `mustChangePassword` — per-tenant onboarding

Polia, ktoré **zostávajú na User** (globálna identita):

- `email`, `firstName`, `lastName`, `displayName`, `phone`
- `accountType`, `entraOid`, `authProviders[]`
- `emailVerified`, `emailVerificationToken`, `emailVerificationExpiresAt`
- `passwordHash`, `passwordResetToken`, `passwordResetExpiresAt`
- `mfaEnabled`, `mfaSecret`, `mfaRecoveryCodes`, `mfaEnabledAt`
- `isActive` (global suspend pre súdny zákaz / GDPR right-to-restrict)
- `lastLoginAt` (globálny posledný login bez ohľadu na tenant)
- `preferences.language`, `preferences.timezone` (osobné)

Polia v `preferences` sa **rozdeľujú**:

- User: `language`, `timezone`
- Membership: `notifications.email`, `notifications.push`

User schema teda prestáva mergeovať `OrganisationScopedSchema`. Nový samostatný typ `GlobalUserSchema`.

### Invitations refactor

Pending invitations sa presúvajú z `users` collection do **samostatnej `invitations` collection** (`packages/shared-types/src/schemas/invitation.ts`):

```ts
export const InvitationSchema = BaseDocumentSchema.merge(
  SoftDeleteSchema,
).extend({
  /** Target email (lowercase). Membership will be created for the User matching this email. */
  email: EmailSchema,

  /** Target tenant. */
  organisationId: ObjectIdSchema,

  /** Roles to grant on accept. */
  roles: z.array(z.enum(USER_ROLE_VALUES) as z.ZodType<UserRole>).min(1),

  /** Optional pre-fill for new-user accept page. */
  firstName: z.string().min(1).max(100).nullable().default(null),
  lastName: z.string().min(1).max(100).nullable().default(null),

  /** Resolved at invitation creation time: existing User _id if email matches, else null. */
  invitedUserId: ObjectIdSchema.nullable().default(null),

  /** Invitation token (32 bytes hex). NEVER in API response except via /preview. */
  token: z.string().regex(/^[a-f0-9]{64}$/),

  /** Token expiry. */
  expiresAt: TimestampSchema,

  /** Who invited. */
  invitedBy: ObjectIdSchema,

  /** Lifecycle status. */
  status: z
    .enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'])
    .default('PENDING'),

  /** Set when invitation transitions to ACCEPTED. */
  acceptedAt: TimestampSchema.nullable().default(null),

  /** Resulting membershipId after accept. */
  membershipId: ObjectIdSchema.nullable().default(null),
});
```

**Indexes:**

- `{ token: 1 }` — unique, sparse (one row per active invite token)
- `{ organisationId: 1, status: 1, deletedAt: 1 }` — list pending invites in a tenant
- `{ email: 1, organisationId: 1, status: 1 }` — prevent duplicate active invites to the same email+tenant
- `{ expiresAt: 1 }` — for cleanup job marking PENDING → EXPIRED

### Email match logika pri `POST /v1/invitations`

```
email := input.email.toLowerCase()
existingUser := users.findOne({ email, deletedAt: null })

if existingUser == null:
  // New-user invite — create User + Membership pair at accept
  insert Invitation { email, organisationId, roles, invitedUserId: null,
                      token, expiresAt: now+7d, invitedBy, status: PENDING }
  send email with /accept-invite?token=...

elif existingUser.isActive == false:
  return 400 USER_GLOBALLY_SUSPENDED

elif memberships.findOne({ userId: existingUser._id, organisationId: target, deletedAt: null }):
  // Already a member (active or suspended membership)
  return 409 ALREADY_MEMBER

elif memberships.findOne({ userId: existingUser._id, organisationId: target, deletedAt: { $ne: null } }):
  // Was a member, left/removed — rejoin allowed
  insert Invitation { ..., invitedUserId: existingUser._id, ... }
  send email "Boli ste pozvaný späť do {tenantName}"

else:
  // Existing Inventario user, never been in target tenant — cross-tenant invite
  insert Invitation { ..., invitedUserId: existingUser._id, ... }
  send email with /accept-invite?token=... + "You'll join {tenantName} with your existing account"
```

`enforceAllowedDomains` flag z K18 sa stále uplatňuje na vstupný `email`, nezávisle od `invitedUserId`.

### Accept flow

**`GET /v1/auth/invitations/:token`** — preview endpoint, rozšírený o `invitedUserId` boolean:

```ts
{
  email, roles, organisation: { displayName, slug, brandKit },
  inviter: { displayName },
  expiresAt,
  acceptMode: 'new-user' | 'existing-user',  // = (invitedUserId == null ? 'new-user' : 'existing-user')
  existingUserPreview: {           // present only when acceptMode === 'existing-user'
    displayName,                   // "Pripojiť sa ako Ján Letko"
    authProviders: ['MICROSOFT'],  // hints which login button to show
  } | null,
}
```

**Accept paths:**

1. **`acceptMode === 'new-user'`** — existing K18 flow nezmenený. Password path: create User + Membership v transakcii. OAuth path: create User + Membership v OAuth callback.

2. **`acceptMode === 'existing-user'`** — nové dva sub-flows:
   - **Invitee už prihlásený ako ten istý User** (server overí cez cookie + token match):
     - Frontend zobrazí confirm dialog: "Pripojiť sa k _{tenantName}_ ako _{roleList}_?"
     - Na confirm: `POST /v1/auth/accept-invitation` len s `{ token }` (žiadne heslo) → server vytvorí Membership, vydá nové JWT s aktívnym tenant context-om (= target tenant), redirect na `/dashboard?invited=accepted`

   - **Invitee neprihlásený alebo prihlásený ako iný User:**
     - Frontend ukáže "Boli ste pozvaný ako _{invitation.email}_. Prihláste sa pre dokončenie."
     - Login form / OAuth buttons s invitation token v state
     - Server pri login/OAuth callback: overí že `loggedInUser._id === invitation.invitedUserId`, ak áno → auto-accept (create Membership, switch JWT na target tenant). Mismatch → `400 EMAIL_MISMATCH`.

### JWT shape zmena

```ts
interface InventarioJwtPayload {
  sub: string; // User _id (global identity)
  iss: 'inventario';
  aud: 'inventario-api';
  org: string; // ACTIVE organisationId
  mid: string; // ACTIVE membershipId (new claim)
  roles: string[]; // roles z aktívnej Membership, nie z User
  email: string;
  name: string;
  iat: number;
  exp: number; // 15 min
}
```

Refresh token sa stáva **per-device, ale nie per-tenant** — pri refresh sa zachová `mid` z minulého access tokenu, takže switching tenant je explicit endpoint, nie side-effect refresh-u.

### Nový endpoint: switch organisation

**`POST /v1/auth/switch-organisation`**

```ts
Request:  { organisationId: string }
Response: 204 No Content (sets new cookies)
```

Behaviour:

1. Validate `membership = memberships.findOne({ userId: req.user.sub, organisationId, status: 'ACTIVE', deletedAt: null })`
2. If not found → `403 NOT_A_MEMBER`
3. Issue new access + refresh JWT s aktualizovanými `org`, `mid`, `roles`
4. Update `membership.lastAccessedAt`
5. Set httpOnly cookies (reuse `setAuthCookies`)
6. Emit audit event `USER_SWITCHED_ORGANISATION` v target tenant scope

**`GET /v1/auth/me`** sa rozšíri o pole `availableOrganisations`:

```ts
{
  user: { ...global fields },
  activeMembership: { organisationId, organisationName, roles, ... },
  availableOrganisations: [
    { organisationId, organisationName, slug, brandKit, roles, isDefault, lastAccessedAt },
    ...
  ],
}
```

Frontend AppShell zobrazí "tenant switcher" dropdown ak `availableOrganisations.length > 1`.

### Last ADMIN protection

Pri operáciách, ktoré by mohli odobrať posledný ACTIVE ADMIN membership v tenant-e:

- `DELETE /v1/memberships/:id` — soft-delete membership
- `PATCH /v1/memberships/:id` — zmena rolí ak by `ADMIN` ostal mimo `roles`
- `DELETE /v1/users/me` — global self-delete (kontroluje sa per-tenant)

Server vykoná pre-check:

```ts
const adminCount = memberships.countDocuments({
  organisationId: target,
  roles: 'ADMIN',
  status: 'ACTIVE',
  deletedAt: null,
});
if (adminCount === 1 && wouldRemoveAdmin) {
  throw new BadRequestError('LAST_ADMIN_PROTECTION', {
    message:
      'Cannot remove the last ADMIN from organisation. Promote another member to ADMIN first.',
  });
}
```

### Global user self-delete (GDPR right-to-erasure)

**`DELETE /v1/auth/me`** (existing) sa upraví:

1. For each Membership of user: apply LAST_ADMIN_PROTECTION check → if any tenant blocks delete, return `409 LAST_ADMIN_IN_ORGS` s zoznamom organizácií, kde musí najprv promovať iného admina.
2. If clear: soft-delete všetky Memberships, anonymizuj User (email → `deleted-<userId>@anonymized.invalid`, mená → `Deleted User`, vymaž `passwordHash`, `mfaSecret`, `authProviders`, `phone`).
3. Emit audit event `USER_DELETED_SELF` v každom dotknutom tenant scope.

### Migration plan

Migration runner v `apps/api/src/migrations/2026-05-XX-memberships.ts` spustí sa **pred prvým štartom novej API verzie** (cez Vercel build hook alebo manuálne CLI). Skript je idempotentný.

```ts
// Pseudo-code:
const users = await db.collection('users').find({}).toArray();

for (const u of users) {
  if (!u.passwordHash && !u.authProviders?.length && !u.emailVerified) {
    // Pending invite (ghost user) — convert to invitations collection
    await db.collection('invitations').insertOne({
      _id: new ObjectId(),
      email: u.email,
      organisationId: u.organisationId,
      roles: u.roles,
      firstName: u.firstName,
      lastName: u.lastName,
      invitedUserId: null,
      token: u.emailVerificationToken,
      expiresAt: u.emailVerificationExpiresAt,
      invitedBy: u.createdBy,
      status: 'PENDING',
      acceptedAt: null,
      membershipId: null,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      createdBy: u.createdBy,
      updatedBy: u.updatedBy,
      deletedAt: null,
      deletedBy: null,
    });
    await db.collection('users').deleteOne({ _id: u._id });
    continue;
  }

  // Active user — extract per-tenant fields into a Membership row
  await db.collection('memberships').insertOne({
    _id: new ObjectId(),
    userId: u._id,
    organisationId: u.organisationId,
    roles: u.roles,
    organizationalUnit: u.organizationalUnit ?? null,
    teams: u.teams ?? [],
    status: 'ACTIVE',
    isDefault: true,
    invitedBy: u.createdBy,
    invitedAt: u.createdAt,
    acceptedAt: u.createdAt,
    mustChangePassword: u.mustChangePassword ?? false,
    lastAccessedAt: u.lastLoginAt ?? null,
    notifications: {
      email: u.preferences?.emailNotifications ?? true,
      push: u.preferences?.pushNotifications ?? false,
    },
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    createdBy: u.createdBy,
    updatedBy: u.updatedBy,
    deletedAt: null,
    deletedBy: null,
  });

  // Strip migrated fields from User
  await db.collection('users').updateOne(
    { _id: u._id },
    {
      $unset: {
        organisationId: '',
        roles: '',
        organizationalUnit: '',
        teams: '',
        invitationSentAt: '',
        mustChangePassword: '',
        'preferences.emailNotifications': '',
        'preferences.pushNotifications': '',
      },
    },
  );
}

// Drop old indexes
await db
  .collection('users')
  .dropIndex('email_1_organisationId_1')
  .catch(() => {});
// Create new global email unique index
await db.collection('users').createIndex({ email: 1 }, { unique: true });
// Memberships indexes
await db
  .collection('memberships')
  .createIndex({ userId: 1, organisationId: 1 }, { unique: true });
await db
  .collection('memberships')
  .createIndex(
    { userId: 1, isDefault: 1 },
    { unique: true, partialFilterExpression: { isDefault: true } },
  );
await db
  .collection('memberships')
  .createIndex({ organisationId: 1, status: 1, deletedAt: 1 });
await db.collection('memberships').createIndex({ userId: 1, deletedAt: 1 });
// Invitations indexes
await db
  .collection('invitations')
  .createIndex({ token: 1 }, { unique: true, sparse: true });
await db
  .collection('invitations')
  .createIndex({ organisationId: 1, status: 1, deletedAt: 1 });
await db
  .collection('invitations')
  .createIndex({ email: 1, organisationId: 1, status: 1 });
await db.collection('invitations').createIndex({ expiresAt: 1 });
```

Deploy postup:

1. **Pre-deploy:** Atlas snapshot prod DB (DR baseline).
2. **Deploy v0.X:** spustí migration runner pri starte (jednorazovo, idempotentný flag `migrations.completed`).
3. **Smoke test:** prihlásenie existujúceho SFZ usera, načítanie aktív, vytvorenie loanu — všetko musí fungovať s 1 memberhip = default.
4. **Rollback plan:** Atlas restore z snapshot ak smoke test zlyhá. Restore < 1 min (overené DR Test #1, 2026-05-23).

### Auth middleware refactor

`plugins/auth.ts` aktuálne pri `requireAuth` číta `req.user = jwt.verify(...).payload` a `req.user.organisationId` ide rovno do scoped repositories. Po refactor-e:

```ts
// New: fetch active membership at request time (cached for ttl=60s in-memory per worker)
const membership = await membershipsRepo.findActive({
  userId: req.user.sub,
  organisationId: req.user.org,
});
if (!membership) throw new UnauthorizedError('MEMBERSHIP_NOT_FOUND');
if (membership.status === 'SUSPENDED')
  throw new ForbiddenError('MEMBERSHIP_SUSPENDED');

// Mutated request context:
req.user = {
  sub,
  email,
  name,
  organisationId: req.user.org,
  membershipId: membership._id,
  roles: membership.roles, // from membership, not JWT!
};
```

Cache invalidation: pri každom `PATCH /v1/memberships/:id` server invaliduje cache entry pre `{userId, organisationId}`. Pri JWT refresh sa membership re-validates.

**Bezpečnostná výhoda:** ak ADMIN odoberie rolu uprostred user-session, ďalší request si ju načíta z DB (max 60s lag), nie z 15-minútového JWT.

### Endpoints summary

**Nové endpointy:**

- `GET /v1/memberships` — list memberhipov aktívneho usera (or by ADMIN with `?organisationId=` query — list members of tenant)
- `GET /v1/memberships/:id` — detail
- `PATCH /v1/memberships/:id` — update roles (ADMIN only, LAST_ADMIN_PROTECTION)
- `DELETE /v1/memberships/:id` — soft-delete (= remove member). ADMIN only, LAST_ADMIN_PROTECTION.
- `POST /v1/memberships/:id/default` — mark as default (current user only, sets `isDefault: true` and clears others)
- `POST /v1/auth/switch-organisation` — issue new JWT for different active tenant

**Existing endpointy zmenené:**

- `GET /v1/users/me` → `GET /v1/auth/me` (alias preserved) — vracia `availableOrganisations[]`
- `POST /v1/invitations` — refactor body validation, email match logic per ADR
- `POST /v1/auth/accept-invitation` — handle `acceptMode: 'existing-user'` (no password required if already logged in)
- `GET /v1/auth/invitations/:token` — extended response (`acceptMode`, `existingUserPreview`)
- `DELETE /v1/auth/me` — per-membership LAST_ADMIN_PROTECTION check

**Existing endpointy bez zmeny v contracte, len v interpretácii `req.user`:**

- Všetky `/v1/assets`, `/v1/categories`, `/v1/locations`, `/v1/loans`, `/v1/users` — RBAC checky teraz čítajú `req.user.roles` z aktívnej membership, scope query naďalej cez `req.user.organisationId`.

## Sub-task breakdown — Slice #9 (Cross-tenant memberships)

### Fáza 1: Schema + migration (Slice #9a, ~1.5 dňa, Sonnet)

| Blok   | Popis                                                                                                                        | Model  |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- | ------ |
| **K1** | Schemas: `membership.ts`, `invitation.ts`, refactor `user.ts` (drop org fields). Regen `@inventario/shared-types`.           | Sonnet |
| **K2** | Migration runner `apps/api/src/migrations/2026-05-XX-memberships.ts` + bootstrap flag in `migrations` collection.            | Sonnet |
| **K3** | Repositories: `MembershipsRepository` (CRUD + findActive + countAdmins), `InvitationsRepository` rewrite for new collection. | Sonnet |
| **K4** | Migration unit tests: idempotency, ghost-user → invitations, active user → 1 default membership.                             | Sonnet |

### Fáza 2: Auth + JWT (Slice #9b, ~1 deň, Sonnet)

| Blok   | Popis                                                                                                                  | Model  |
| ------ | ---------------------------------------------------------------------------------------------------------------------- | ------ |
| **K5** | JWT shape extension: pridať `mid` claim. Update `issueAccessToken` + `verifyAccessToken`.                              | Sonnet |
| **K6** | `plugins/auth.ts` refactor: fetch active membership, populate `req.user.roles` from membership (60s cache).            | Sonnet |
| **K7** | `POST /v1/auth/switch-organisation` endpoint + tests.                                                                  | Sonnet |
| **K8** | `GET /v1/auth/me` rozšírenie o `availableOrganisations[]`.                                                             | Sonnet |
| **K9** | OAuth/email register flow: vytvor User + 1 default Membership v transakcii. Existing K18.3 OAuth invite accept update. | Sonnet |

### Fáza 3: Cross-tenant invite logic (Slice #9c, ~1 deň, Sonnet)

| Blok    | Popis                                                                                                                | Model  |
| ------- | -------------------------------------------------------------------------------------------------------------------- | ------ |
| **K10** | `POST /v1/invitations` refactor: email match logic (new-user / cross-tenant / rejoin / 409 ALREADY_MEMBER).          | Sonnet |
| **K11** | `GET /v1/auth/invitations/:token` extended preview (`acceptMode`, `existingUserPreview`).                            | Sonnet |
| **K12** | `POST /v1/auth/accept-invitation` for `acceptMode: 'existing-user'` (no password, requires logged-in matching user). | Sonnet |
| **K13** | OAuth callback path for cross-tenant accept (logged-in user accepts via OAuth re-auth).                              | Sonnet |
| **K14** | Audit events: `USER_JOINED_ORGANISATION` (cross-tenant), `USER_REJOINED_ORGANISATION`.                               | Sonnet |

### Fáza 4: Memberships CRUD + last-admin protection (Slice #9d, ~1 deň, Sonnet)

| Blok    | Popis                                                                                                                | Model  |
| ------- | -------------------------------------------------------------------------------------------------------------------- | ------ |
| **K15** | `GET/PATCH/DELETE /v1/memberships/:id` endpoints. `POST /v1/memberships/:id/default`. RBAC.                          | Sonnet |
| **K16** | LAST_ADMIN_PROTECTION: shared service `assertNotLastAdmin()` reused by membership delete/patch and user self-delete. | Sonnet |
| **K17** | `DELETE /v1/auth/me` update: per-membership LAST_ADMIN check, anonymize User + soft-delete all Memberships.          | Sonnet |
| **K18** | Audit events: `MEMBERSHIP_CREATED`, `MEMBERSHIP_ROLES_CHANGED`, `MEMBERSHIP_REMOVED`, `USER_SWITCHED_ORGANISATION`.  | Sonnet |

### Fáza 5: Frontend (Slice #9e, ~1.5 dňa, Sonnet)

| Blok    | Popis                                                                                                              | Model  |
| ------- | ------------------------------------------------------------------------------------------------------------------ | ------ |
| **K19** | `AppShell` tenant switcher dropdown (visible if `availableOrganisations.length > 1`).                              | Sonnet |
| **K20** | `/accept-invite` page extended pre `acceptMode: 'existing-user'` (logged-in confirm flow, login-then-accept flow). | Sonnet |
| **K21** | `/settings/members` page: list memberships, change roles, remove member, "last admin" warning UX.                  | Sonnet |
| **K22** | `/settings/organisations` page (user-side): list own memberships, mark default, leave organisation button.         | Sonnet |

### Fáza 6: Docs + milestone (Slice #9f, ~0.5 dňa, Haiku)

| Blok    | Popis                                                                                    | Model |
| ------- | ---------------------------------------------------------------------------------------- | ----- |
| **K23** | Milestone doc `docs/milestones/slice-9-cross-tenant-memberships.md`.                     | Haiku |
| **K24** | Update `docs/sessions/NEXT.md` — Slice #9 done, remove cross-tenant from roadmap MEDIUM. | Haiku |
| **K25** | API reference docs update (auth endpoints, memberships endpoints).                       | Haiku |

**Celkom:** ~6-7 pracovných dní (25 K-blokov, 5 fáz + docs).

**Test target:** ~60-70 nových testov. Total suite ~575-580 (z 511 dnes).

## Dôsledky

### Pozitívne

- **Cross-tenant invites fungujú** — zamestnanec jedného tenantu môže byť pozvaný do druhého bez duplikácie identity
- **Single Source of Truth pre identitu** — jedno heslo, jeden MFA seed, jeden set OAuth providerov pre osobu
- **GDPR right-to-erasure správne pokrytý** — global delete cascadeuje na všetky memberships
- **RBAC z DB, nie len z JWT** — odobratá rola sa prejaví do 60s (cache TTL), nie po expiry 15-min tokenu
- **Tenant switcher** — UX pre konzultantov / freelancerov / multi-org adminov
- **Per-tenant notification preferences** — user dostáva push notifikácie len z tenantu, kde to chce
- **Audit log čistejší** — `USER_JOINED_ORGANISATION` ako explicit event s metadát `via: 'cross-tenant-invite'`
- **Foundation pre budúcnosť** — billing per-tenant, per-tenant seats limits, organisation transfer ownership

### Negatívne / kompromisy

- **Väčší refactor** — 25 K-blokov, ~6-7 dní práce. Najväčší schema change od Slice #6c.
- **Auth middleware dodatočný query** — `findActive` membership per request. Mitigácia: 60s in-memory cache per worker. Pre väčší scale neskôr Redis cache.
- **Test suite update** — 511 testov spolieha na `req.user.organisationId` z JWT. Väčšina prejde bez zmeny (JWT stále má `org`), ale RBAC testy musíme aktualizovať aby vytvárali Memberships namiesto User.roles.
- **Single-tenant open-source self-host** — pre malé kluby je many-to-many overkill. Riešenie: ak `availableOrganisations.length === 1`, frontend skryje switcher. Žiadny extra step v UX.
- **JWT teraz obsahuje aj `mid`** — minor token size increase (~24 bytes). Acceptable.
- **Switch-organisation nie je idempotent** — vydáva nové cookies vždy. Treba rate-limit aby útočník nemohol spamovať server JWT issuance.
- **Migration risk** — production data sa transformuje. Mitigácia: pre-deploy Atlas snapshot, idempotent runner, smoke test po deploy-i, rollback plan < 1 min (DR Test #1 validated).

### Riziká, ktoré treba sledovať

- **Last admin race condition** — dvaja ADMIN-i naraz volajú `DELETE /v1/memberships/:id` na seba navzájom. Mitigácia: transakcia + count v rámci transakcie. MongoDB Atlas Flex podporuje multi-document transactions.
- **Membership cache stale** — 60s lag medzi role change a effect. Pre security-sensitive operácie (napr. user removal) treba force-invalidate cache pri write. Pridáme `cacheInvalidator.invalidate({userId, organisationId})` po každom `PATCH/DELETE /v1/memberships`.
- **JWT replay po switch-tenant** — staré JWT s pôvodným `mid` je platné 15 min aj keď user prepol. Mitigácia: server pri každom requeste validate `mid` proti aktuálnej active membership; ak user prepol, staré JWT s iným `mid` sa odmietne (`401 MEMBERSHIP_MISMATCH`). To zároveň rieši "remove member" scenario.
- **Refresh token leak across tenants** — refresh token nie je per-tenant, takže útočník s refresh tokenom dostane prístup do **default** tenantu (ne všetkých). Acceptable risk; mitigácia rovnaká ako pri ADR-0013 (rotation, device fingerprinting future).
- **Email enumeration via `POST /v1/invitations` errors** — odpoveď `409 ALREADY_MEMBER` vs `400 EMAIL_NOT_ALLOWED` leakuje informáciu o členstve. Mitigácia: pre external callers (ASSET_MANAGER bez ADMIN práv pre user listing) vraciame jednotnú `400 INVITE_FAILED` chybu. ADMIN dostáva detailné kódy lebo ich potrebuje pre UX.
- **GDPR DSAR (data subject access request)** sa rozširuje\*\* — user dostane export svojich dát zo všetkých memberships. K23 milestone doc to musí pokryť v "DSAR fulfillment" sekcii.
- **Onboarding flow pri prvom invite** — keď user dostane invite do druhého tenantu pri prvom prihlásení vôbec, prejde dvomi flowmi naraz (register + accept-invite). Mitigácia: register flow pri OAuth callback skontroluje `invitationToken` v state, ak je prítomný → vytvor len 1 default Membership v target tenant-e (žiadny self-serve org create).

## Referencie

- [ADR-0010 Multi-tenant white-label](0010-multi-tenant-white-label.md) — Organisation schema
- [ADR-0013 Multi-provider auth + self-serve](0013-multi-provider-auth-self-serve.md) — JWT shape, OAuth flows
- [K18 Invite flow design](../sessions/2026-05-20-slice-6c-k18-design.md) — current single-tenant invite implementation
- [Slack workspace model](https://slack.engineering/scaling-slack/) — many-to-many user ↔ workspace reference
- [Notion teamspaces architecture](https://www.notion.so/help/intro-to-teamspaces) — similar UX pattern
- [GitHub orgs and memberships](https://docs.github.com/en/organizations) — REST API shape reference for `/users/:user/orgs`
- [MongoDB partial unique index](https://www.mongodb.com/docs/manual/core/index-partial/) — for `isDefault` constraint
- [OWASP Multi-tenancy Cheat Sheet](https://cheatsheetseries.owasp.org/)
