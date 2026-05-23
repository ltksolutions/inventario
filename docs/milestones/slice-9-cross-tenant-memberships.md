<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Slice #9 — Cross-tenant memberships

**Dátum:** 2026-05-23  
**Status:** ✅ DOKONČENÝ  
**Sub-slices:** #9a – #9f  
**K-bloky:** K1 – K25  
**Testy po dokončení:** 553 / 553 (525 pred #9 → +28 nových)

---

## Čo sme vyriešili

Pred Slice #9 mal Inventario jednu kritickú architektúrnu limitáciu:
jeden User = jeden tenant. Pozvánky pre existujúcich používateľov
zlyhávali na unikátnom globálnom indexe `users.email`, pretože
ghost-user pattern ukladal pending invitations ako User dokumenty.

Slice #9 kompletne odstránil obe obmedzenia zavedením:

1. **`memberships` kolekcie** — User ↔ Organisation many-to-many join.
   Per-tenant polia (roles, organizationalUnit, teams, mustChangePassword,
   notifications) sa presunuli z User na Membership.

2. **`invitations` kolekcie** — náhrada ghost-user patternu. Nové pole
   `invitedUserId: ObjectId | null` odlišuje new-user od cross-tenant pozvania.

3. **Tenant switcher** — `POST /v1/auth/switch-organisation` vydáva nové
   JWT cookies s updated `org`/`mid`/`roles`. Frontend dropdown v AppShell.

4. **GDPR erasure** — `DELETE /v1/auth/me` s per-org last-admin check,
   transakčnou pseudonymizáciou User + soft-delete všetkých Memberships.

---

## Architektúrne rozhodnutia (ADR-0015)

### User vs Membership split

Globálna identita zostala na `User` (email, name, passwordHash, authProviders,
MFA, isActive, lastLoginAt, language/timezone). Per-tenant kontext presunuli
sme na `Membership`:

- `roles` — autoritatívny zdroj rolí pre každý request (nie JWT claims)
- `organizationalUnit`, `teams` — per-tenant príslušnosť
- `mustChangePassword` — per-tenant onboarding flag
- `notifications: { email, push }` — per-tenant preferencie

### JWT `mid` claim

Každý access token teraz nesie `mid` (membershipId). Auth middleware
validuje konkrétnu membership (nie len userId+orgId), čo umožňuje
rýchlejšiu detekciu stale tokenov po tenant switchi.

60-sekundový in-memory cache per worker (Map s TTL) minimalizuje DB
round-tripy — invalidácia prebehne okamžite pri write operáciách cez
`invalidateMembershipCache()` z `plugins/auth.ts`.

### Last-admin protection

`MembershipsService.assertNotLastAdmin()` je transaction-safe shared
service použitý na troch miestach:

- `PATCH /v1/memberships/:id` — pri odoberaní ADMIN role
- `DELETE /v1/memberships/:id` — pri odstraňovaní ADMIN člena
- `DELETE /v1/auth/me` — per-org check pred GDPR erasure

### Cross-tenant invite flow

```
POST /v1/invitations
  → email match: new-user | cross-tenant | rejoin | 409 ALREADY_MEMBER

GET /v1/auth/invitations/:token
  → acceptMode: 'new-user' | 'existing-user'
  → existingUserPreview: { displayName, authProviders }

POST /v1/auth/accept-invitation
  new-user:       create User + Membership, issue JWT
  existing-user:  validate inv_access cookie, create Membership only
```

---

## Implementácia

### Backend (apps/api)

**Nové súbory:**

| Súbor                                               | Popis                                                                                          |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/modules/memberships/memberships.repository.ts` | CRUD + findActive + listByOrganisation + countActiveAdmins + setDefault + softDeleteAllForUser |
| `src/modules/memberships/memberships.service.ts`    | assertNotLastAdmin() + assertNotLastAdminForDeletion()                                         |
| `src/modules/memberships/memberships.routes.ts`     | GET/PATCH/DELETE /:id + POST /:id/default + GET / (list)                                       |
| `src/migrations/2026-05-23-memberships.ts`          | Idempotentný migration runner: ghost-users → invitations, users → memberships                  |

**Upravené súbory (kľúčové):**

| Súbor                                               | Zmena                                                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/plugins/auth.ts`                               | K6: loadCurrentUser fetchuje aktívnu Membership; 60s cache; synthesizeMembership fallback |
| `src/plugins/inventario-jwt.ts`                     | K5: `mid` claim v issueAccessToken / verifyAccessToken                                    |
| `src/modules/auth/auth-session.routes.ts`           | K7: POST /switch-organisation; K8: GET /auth/me (extended); K17: DELETE /auth/me (GDPR)   |
| `src/modules/invitations/invitations.routes.ts`     | K10-K14: cross-tenant email match, existing-user accept, audit events                     |
| `src/modules/invitations/invitations.repository.ts` | Rewrite na novú `invitations` kolekciu, ghost-user fallback                               |
| `packages/shared-types/src/schemas/membership.ts`   | Nová Membership schéma + UpdateMembershipSchema                                           |
| `packages/shared-types/src/schemas/invitation.ts`   | Nová Invitation schéma s invitedUserId                                                    |
| `packages/shared-types/src/schemas/audit-log.ts`    | +4 nové akcie + Membership entityType                                                     |
| `src/modules/audit/audit.service.ts`                | GDPR mappings pre nové membership akcie                                                   |

### API endpointy (nové)

| Endpoint                            | RBAC             | Popis                                                        |
| ----------------------------------- | ---------------- | ------------------------------------------------------------ |
| `POST /v1/auth/switch-organisation` | auth             | Prepne aktívny tenant, vydá nové JWT cookies                 |
| `GET /v1/auth/me`                   | auth             | Extended: user + activeMembership + availableOrganisations   |
| `DELETE /v1/auth/me`                | auth             | GDPR erasure: per-org last-admin check + pseudonymizácia     |
| `GET /v1/memberships`               | ADMIN            | Zoznam členov org (s userEmail + userDisplayName batch JOIN) |
| `GET /v1/memberships/:id`           | ADMIN alebo self | Detail membership                                            |
| `PATCH /v1/memberships/:id`         | ADMIN            | Zmena rolí / statusu + cache invalidation                    |
| `DELETE /v1/memberships/:id`        | ADMIN alebo self | Soft-delete + last-admin guard                               |
| `POST /v1/memberships/:id/default`  | self             | Nastavenie default org (transakcia)                          |

### Frontend (apps/web)

**Nové komponenty:**

| Komponent                  | Popis                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `AppShell.tsx`             | TenantSwitcher dropdown (viditeľný pri ≥2 org); deterministické farebné avatary; nové nav položky |
| `MembersContent.tsx`       | Admin panel: zoznam členov, edit rolí dialog, delete s last-admin guard                           |
| `OrganisationsContent.tsx` | User panel: vlastné org, set-default, leave org                                                   |
| `AcceptInvitePage.tsx`     | K20: existing-user path (confirm ak prihlásený, login redirect ak nie)                            |

**Nové stránky:**

- `/settings/members` — správa členov org (ADMIN)
- `/settings/organisations` — vlastné memberships (všetci)

**auth-context.tsx:**  
Prepisaný na `GET /v1/auth/me`. Exposes `availableOrganisations`,
`activeMembership`, `switchOrg()`. `user.roles` populovaný z
`activeMembership.roles` (autoritatívny zdroj).

### Testy

Nové testy v `apps/api/tests/integration/`:

| Súbor                 | Testy                                                                               |
| --------------------- | ----------------------------------------------------------------------------------- |
| `memberships.test.ts` | 28 testov: CRUD, RBAC, last-admin protection, default switching, cache invalidation |

**Celkovo: 553 testov, 0 failov** (+28 oproti 525 pred #9).

---

## Čo NIE JE v Slice #9

- **K13 OAuth callback cross-tenant** — deferred; OAuth invite path
  pre existing-user cez Google/MS SSO. Estimate ~2h Sonnet.
- **Per-email invitation exceptions** (`Organisation.settings.invitations.exceptions[]`) — ~1h Sonnet
- **Resend invitation endpoint** (`POST /v1/invitations/:id/resend`) — ~1h Sonnet
- **Email change verification flow** — ~2h Sonnet
- **Keyboard shortcut `Cmd+K` tenant picker** — ~30 min Sonnet, post-launch polish
- **`Membership` entityType v audit log** — pridaný do shared-types; budúce
  endpointy môžu používať typizovane

---

## Závislostiové zmeny

Žiadne nové production závislosti.
