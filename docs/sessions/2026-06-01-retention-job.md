<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session — Retention job #8 (GDPR audit log + user pseudonymizácia)

**Dátum:** 2026-06-01
**Model:** Claude Sonnet 4.6
**TODO položka:** #8 (P2)

---

## Čo sme spravili

### Architektúra

Retention job je rozdelený na tri vrstvy:

**`RetentionRepository`** (`apps/api/src/modules/audit/retention.repository.ts`) — jediný povolený UPDATE path na `audit_logs`. Zámerná separácia od `AuditLogRepository` (append-only) aby neexistovala možnosť náhodne zamiešať write+modify. Dve metódy:

- `pseudonymizeAuditLogs(actions, cutoff)` — bulk `updateMany` pre daný action set + cutoff dátum; nahrádza actor PII, nastavuje `isPseudonymized: true` + `pseudonymizedAt`
- `pseudonymizeSoftDeletedUsers(cutoff)` — per-user update pre soft-deleted users starších ako cutoff; rovnaká logika ako `DELETE /v1/auth/me` (pseudoEmail, secrets null)

**`RetentionService`** (`apps/api/src/modules/audit/retention.service.ts`) — orchestruje beh; `run(now?)` parameter pre testovateľnosť:

- Bucket 1: CRUD/business akcie → 24 mesiacov
- Bucket 2: auth/security/GDPR akcie → 60 mesiacov (5 rokov)
- Bucket 3: org lifecycle → 84 mesiacov (7 rokov)
- Krok 4: soft-deleted users → 24 mesiacov od `deletedAt`
- Kroky bežia sekvenčne (nie paralelne) — Atlas Flex má nižšie limity pre súbežné write operácie
- Vracia `RetentionRunResult` s počtami per bucket

**`retention.routes.ts`** (`apps/api/src/modules/system/retention.routes.ts`) — nový `system` modul:

- `POST /v1/system/retention/run` — chránený `Authorization: Bearer <CRON_SECRET>`
- 503 ak `CRON_SECRET` nie je nakonfigurovaný (endpoint disabled)
- 401 na chýbajúci/nesprávny token
- 200 + `RetentionRunResult` JSON pri úspechu
- Vercel cron posiela header automaticky pri cron invocations

**`vercel.json`** — pridaná `crons` sekcia: `0 3 1 * *` (1. každého mesiaca o 03:00 UTC)

**`config.ts`** — nová env premenná `CRON_SECRET` (optional, min 32 chars) + `turbo.json` globalEnv

### Retention buckety (detaily)

| Bucket             | Akcie                                                                                                                           | Retenčná doba            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| CRUD               | ASSET*\*, CATEGORY*_, LOCATION\__, LOAN*\*, STOCK*_, USER*CREATED/UPDATED/..., MEMBERSHIP*_, ORGANISATION_UPDATED, system akcie | 24 mesiacov              |
| Security/GDPR      | USER*LOGIN\*, USER_PASSWORD*_, USER*MFA*_, PASSKEY*\*, DATA*\*\_REQUESTED, USER_PSEUDONYMIZED, USER_RESTRICTED/UNRESTRICTED     | 60 mesiacov              |
| Org lifecycle      | ORGANISATION_CREATED, ORGANISATION_DELETED                                                                                      | 84 mesiacov              |
| Soft-deleted users | users s `deletedAt < cutoff` a email bez `deleted-` prefixu                                                                     | 24 mesiacov od deletedAt |

### Pseudonymizácia (čo sa mení / čo ostáva)

**Nahradené (PII):**

- `actor.userId` → `'PSEUDONYMIZED'`
- `actor.displayName` → `'Pseudonymized User'`
- `actor.ipAddress` → `null`
- `actor.userAgent` → `null`
- `isPseudonymized` → `true`
- `pseudonymizedAt` → timestamp

**Zachované (forenzná hodnota bez PII):**

- `action`, `at`, `severity`, `target`, `description`, `changes`, `metadata`, `legalBasis`, `dataCategories`, `organisationId`

### 30-dňový grace period

`DELETE /v1/auth/me` pseudonymizuje okamžite (validné čl. 17 — žiadna námietka voči okamžitému výmazu). `pseudonymizeSoftDeletedUsers` je safety net pre budúce admin-initiated soft-delete cesty (zatiaľ neexistujú, ale vrstva je pripravená).

## Testy

```
retention.test.ts (unit)              — ✅ 16 testov
  RetentionRepository:
    - pseudonymizuje matching records
    - zachováva non-PII polia
    - skip already-pseudonymized (idempotencia)
    - skip mimo action set
    - skip newer than cutoff
  Pseudonymize soft-deleted users:
    - pseudonymizuje starých soft-deleted
    - skip already-pseudonymized (email prefix)
    - skip active users
    - skip within grace period
  RetentionService:
    - spracuje všetky 3 buckety, správne počty
    - idempotencia (druhý beh = 0)
    - pseudonymizuje soft-deleted users
    - rešpektuje `now` parameter

retention-cron.test.ts (integration)  — ✅ 4 testy
  - 401 bez auth headeru
  - 401 so zlým tokenom
  - 200 + RetentionRunResult shape s platným tokenom
  - idempotencia (druhé volanie = 0 counts)

celá test suite                        — zelená ✅
```

## Po deployi

Nastaviť `CRON_SECRET` v Vercel Settings → Environment Variables:

```bash
openssl rand -hex 32
```

Prvý manuálny smoke test:

```bash
curl -X POST https://api.inventario.estate/v1/system/retention/run \
  -H "Authorization: Bearer <CRON_SECRET>"
# očakávaný výsledok: 200, všetky counts = 0 (prod DB je čerstvá)
```

## Commit message

```
feat(api): GDPR audit log retention job with Vercel cron (#8)
```
