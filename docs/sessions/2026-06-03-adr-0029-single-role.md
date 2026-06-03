# Session 2026-06-03 — ADR-0029: Single Hierarchical Role (K1–K7)

## Zhrnutie

Implementácia ADR-0029 — prechod z `roles: UserRole[]` na `role: UserRole` (jedna hodnota)
na memberships a invitations. Hierarchická RBAC utilita (`roleSatisfies`, `requireMinRole`).

Rozsah: K1 shared-types → K2 RBAC+JWT → K3 service layer → K4 write-side auth →
K5 migration → K6 frontend → K7 testy + ADR accepted.

## Rozhodnutia prijaté

- `User.roles` ponechaný ako legacy pole (RBAC ho nečíta); autorita = `Membership.role`
- JWT dual-tvar tolerancia: `assertInventarioPayload` akceptuje nový `role` aj legacy `roles[]`
  (žiadny vynútený re-login)
- Zhoda úrovní EMPLOYEE/EXTERNAL: EMPLOYEE vyhráva
- `users.service.ts` + `users.routes.ts` + `users.repository.ts` — PONECHANÝ na legacy `User.roles[]`
  (PATCH /v1/users/:id je zastaraný spôsob správy rolí; tech-debt, RBAC-irrelevantné)

## Zmeny na disku

### shared-types

- `packages/shared-types/src/enums/user-role.ts` — ROLE_LEVEL, roleSatisfies, highestRole
- `packages/shared-types/src/schemas/membership.ts` — roles[] → role
- `packages/shared-types/src/schemas/invitation.ts` — roles[] → role

### Backend (apps/api/src)

- `plugins/auth.ts` — requireMinRole, backfill currentUser.role, synthesizeMembership, resolveTokenRole
- `plugins/inventario-jwt.ts` — role claim namiesto roles[], dual-tvar tolerancia
- `modules/loans/loans.service.ts` — roleSatisfies, role filter Mongo
- `modules/loans/loan-requests.routes.ts` — requireMinRole
- `modules/loans/loans.routes.ts` — requireMinRole
- `modules/memberships/memberships.repository.ts` — role: 'ADMIN' filter
- `modules/memberships/memberships.service.ts` — assertNotLastAdmin single role
- `modules/memberships/memberships.routes.ts` — PatchMembership role, requireMinRole, toPublic
- `modules/auth/registration.routes.ts` — membership role: ADMIN
- `modules/auth/email-auth.routes.ts` — membership + issueAccessToken role
- `modules/auth/oauth.routes.ts` — ProvisionResult role, membership inserts, issueAccessToken
- `modules/auth/auth-session.routes.ts` — role v switch-org, GET /me
- `modules/invitations/invitations.routes.ts` — role na invite, accept, resend
- `modules/invitations/invitations.repository.ts` — role v toPublic, ghostUserToInvitation
- `migrations/2026-06-03-single-role.ts` — NOVÁ: roles[] → role (memberships, invitations)
- `migrations/runner.ts` — zaregistrovaná nová migrácia

### Frontend (apps/web/src)

- `lib/auth-context.tsx` — AuthUser.role, ActiveMembership.role, AvailableOrganisation.role
- `lib/api-hooks.ts` — ROLE_LEVEL, roleSatisfies, MemberPickerItem.role, RBAC helpery, USER_ROLES+EXTERNAL
- `components/InvitationsContent.tsx` — single-select, drop TEAM_MANAGER, role vs roles
- `components/AcceptInvitePage.tsx` — role, drop TEAM_MANAGER
- `components/AppShell.tsx` — user.role, isAdmin/isManager, formatRole, drop TEAM_MANAGER
- `components/MembersContent.tsx` — MemberRow.role, single-select edit, PATCH role
- `components/OrganisationsContent.tsx` — org.role, drop TEAM_MANAGER

### Testy

- `tests/helpers/test-fixtures.ts` — issueAccessToken single role, insertTestMembership role
- `tests/integration/invitations-post.test.ts` — role namiesto roles[]
- `tests/integration/invitations-accept.test.ts` — role namiesto roles[]
- `tests/integration/auth-email.test.ts` — activeMembership.role assertion
- `tests/unit/migration-single-role.test.ts` — NOVÝ: 10+ scenárov pre novú migráciu

### Docs

- `docs/decisions/0029-single-hierarchical-role.md` — status: Accepted

## Tech-debt (pridané do TODO)

- `users.service.ts` / `users.routes.ts` / `users.repository.ts` — PATCH /v1/users/:id
  stále pracuje s legacy User.roles[]. Správa rolí má ísť cez PATCH /v1/memberships/:id.
  Tento endpoint je zastaraný; premigrovat ho na membership alebo odstraniť pred GA.

## Čo treba urobiť (Janika)

1. `pnpm --filter @inventario/shared-types build`
2. `pnpm --filter @inventario/api openapi:export:offline`
3. Regen `apps/web/api-types.ts` (z nového OpenAPI)
4. `pnpm typecheck`
5. `pnpm test`

Ak niečo padne, pošli výstup — opravím.

## Commit message

```
feat: single hierarchical role per membership (ADR-0029)
```
