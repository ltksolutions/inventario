<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session — DSAR práva: erasure (#5) + restrict (#6)

**Dátum:** 2026-06-01
**Model:** Claude Sonnet 4.6
**Trvanie:** jedna session
**Predchádza:** `2026-06-01-dsar-export-patch-me.md` (#3 + #4)

---

## Kontext a zistenie na úvod

Cieľom bolo doimplementovať zvyšné dve DSAR práva. Pri analýze sa ukázalo, že **#5 (erasure) už čiastočne existoval** ako `DELETE /v1/auth/me` z K17 (Slice #6c) — robil okamžitú pseudonymizáciu + soft-delete memberships + last-admin guard. Chýbali mu však testy a audit insert bol nekonzistentný (priamy `collection.insertOne` namiesto `AuditLogService`).

Rozhodnutie: ponechať okamžitú pseudonymizáciu (validné splnenie čl. 17), refaktorovať audit, dopísať testy. 30-dňový grace period odložený na retention job (#8), s ktorým zdieľa pseudonymizačnú vrstvu — rozbiehať teraz polovičný scheduler by sme o chvíľu prerábali.

---

## Čo sme spravili

### #5 — Right to erasure (čl. 17): `DELETE /v1/auth/me`

`auth-session.routes.ts`:

- Audit `DATA_DELETION_REQUESTED` refaktorovaný z priameho `collection.insertOne` na `fastify.auditLog.record(...)` — konzistentný tvar s `legalBasis: legal_obligation`, `dataCategories`, plný actor snapshot (displayName, accountType, IP, UA)
- Plugin dependency rozšírená o `'audit'`
- Logika erasure (pseudonymizácia + soft-delete memberships v transakcii + last-admin guard) ostala nezmenená

`tests/integration/auth-erasure.test.ts` (nový, endpoint predtým nemal testy):

- 204 + pseudonymizácia (email/meno nahradené, isActive=false, deletedAt, secrets clearnuté)
- soft-delete všetkých memberships
- `DATA_DELETION_REQUESTED` audit event s plným actor tvarom + legalBasis
- clear auth cookies
- last-admin guard (sólo admin sa nedá zmazať)
- 401 bez cookie

### #6 — Right to restrict (čl. 18): `POST /v1/users/:id/restriction`

`shared-types/src/schemas/user.ts`:

- nové polia `isRestricted` (default false), `restrictedAt`, `restrictionReason`
- dôležité: **samostatné od `isActive`** — `isActive: false` blokuje login úplne (deaktivácia), `isRestricted: true` dáta uchováva a umožňuje read, blokuje len write (čl. 18)

`shared-types/src/schemas/audit-log.ts`:

- nové akcie `USER_RESTRICTED`, `USER_UNRESTRICTED`

`audit.service.ts`:

- `legalBasis` mapping: obe nové akcie → `legal_obligation`
- `dataCategories` mapping: obe → `['account']`

`users.repository.ts`:

- `setRestriction()` — tenant-scoped flag flip s `restrictedAt`/`restrictionReason`

`users.service.ts`:

- `setRestriction()` — admin akcia, transakčná (flag + audit atomicky), idempotencia (already-restricted/not-restricted → 400), cross-tenant 404

`users.routes.ts`:

- `RestrictionBodySchema` (`restrict: boolean`, optional `reason`)
- `POST /v1/users/:id/restriction` — ADMIN only

`plugins/auth.ts` — **enforcement**:

- v `loadCurrentUser` po načítaní usera: ak `isRestricted === true`, mutujúce HTTP metódy (POST/PATCH/PUT/DELETE) → 403 `PROCESSING_RESTRICTED`, safe metódy (GET/HEAD/OPTIONS) prejdú
- výnimka: `DELETE /v1/auth/me` (erasure čl. 17 má prednosť pred restriction)

`tests/integration/users-restriction.test.ts` (nový):

- restrict/unrestrict happy path + audit eventy
- idempotencia (400), 404, nevalidný id, chýbajúci `restrict`
- RBAC (403 EMPLOYEE, 401 bez cookie)
- enforcement: restricted user GET prejde, PATCH /v1/me → 403; po zrušení restrikcie PATCH znova prejde

---

## Kľúčové rozhodnutia

**Okamžitá pseudonymizácia vs. 30-dňový grace period (#5):** Grace period viazaný na retention cron (#8), ktorý ešte nie je. Okamžitá pseudonymizácia je nezvratná anonymizácia → validné splnenie čl. 17. Grace period sa pridá pri #8.

**`isRestricted` ako samostatný flag, nie reuse `isActive`:** Čl. 18 (restrict) ≠ deaktivácia. Restricted user musí mať read prístup k vlastným údajom (čl. 15, 20 stále platia), len write je blokovaný. `isActive: false` by zablokoval aj login.

**Enforcement v auth middleware, nie v každom endpointe:** Jediné miesto (`loadCurrentUser`) cez ktoré prechádzajú všetky autentifikované requesty. HTTP metóda určuje mutáciu — jednoduchšie a úplnejšie než per-endpoint kontrola.

**Erasure výnimka z restriction enforcement:** Restricted user musí stále môcť uplatniť právo na výmaz (čl. 17) — preto `DELETE /v1/auth/me` prechádza aj pri `isRestricted: true`.

**Audit konzistencia:** Pri refaktore #5 sa audit zjednotil na `AuditLogService`. Zostáva jeden starý priamy insert (`USER_SWITCHED_ORGANISATION` v switch-organisation endpointe) — nechané, mimo rozsahu tejto session.

---

## Stav testov

```
auth-erasure.test.ts       — ✅
users-restriction.test.ts  — ✅
celková test suite         — zelená ✅
openapi regen              — ✅ (nové pole + endpoint + audit akcie)
```

Pripomienka: `shared-types` build je nutný pred typecheckom po zmene schém (`pnpm --filter @inventario/shared-types build`) — TS inak číta staré `.d.ts`.

---

## DSAR — kompletný stav

| #   | Právo            | Článok | Endpoint                         | Stav |
| --- | ---------------- | ------ | -------------------------------- | ---- |
| 3   | Data portability | čl. 20 | `GET /v1/me/export`              | ✅   |
| 4   | Rectification    | čl. 16 | `PATCH /v1/me`                   | ✅   |
| 5   | Erasure          | čl. 17 | `DELETE /v1/auth/me`             | ✅   |
| 6   | Restriction      | čl. 18 | `POST /v1/users/:id/restriction` | ✅   |

Všetky štyri DSAR práva sú implementované a otestované.

---

## Otvorené / nadväzujúce

- Retention job (#8) — pri ňom dorobiť 30-dňový grace period pre erasure
- Starý priamy audit insert pri `USER_SWITCHED_ORGANISATION` — možno zjednotiť na AuditLogService neskôr
- Smoke test nových endpointov na produkcii po deployi

---

## Commit message

```
feat(api): GDPR erasure refactor + right to restrict (Art. 17, 18)
```
