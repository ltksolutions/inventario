<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session — email_unique index fix (reziduálny globálny index na prod)

**Dátum:** 2026-06-01
**Model:** Claude Sonnet 4.6
**Trvanie:** krátka session (nadväzuje na DSAR session)
**TODO položka:** #2 (P0, pred SFZ pilotom)

---

## Problém

Pred onboardingom 2. tenanta (SFZ) bolo treba overiť, či bol starý globálny `{ email: 1 }` unique index na `users` reálne odstránený. Multi-tenant model (ADR-0015) povoľuje rovnaký email v dvoch rôznych organizáciách (napr. `admin@firma.sk` v org A aj org B) — globálny unique index by to blokoval a spôsobil E11000 pri JIT provisioningu druhého tenanta.

## Root cause

Migrácia `2026-05-29c-fix-email-unique-index` mala dropnúť legacy index, ale používala **fixný zoznam mien**:

```
['email_unique', 'email_1', 'users_email_unique']
```

Reálny index na produkcii sa však volal **`users_email_global_unique`** — v zozname nebol, takže `dropIndex` ho minul. Migrácia napriek tomu prebehla bez chyby (každý drop je v try/catch) a zapísala sa do `migrations` kolekcie ako `completed`. Dôsledok: runner ju **už nikdy nespustí znova**, takže oprava drop-listu v tej istej migrácii by nepomohla.

Overené cez Atlas Data Explorer: `users` mala 5 indexov vrátane `users_email_global_unique` ({ email: 1 }, UNIQUE, usage 83). Správny composite `organisationId_email_unique` ({ organisationId: 1, email: 1 }, UNIQUE) tam bol tiež — per-tenant unikátnosť teda fungovala, problém bol len ten globálny navyše.

## Riešenie

Dvojkolajné — okamžitá náprava prod + systémová poistka:

1. **Manuálny drop na prod Atlas:** `users_email_global_unique` odstránený cez Data Explorer. Bezpečné — `users` má 1 dokument, žiadne kolízie. Po dropnutí má `users` na prod správne 4 indexy:
   - `_id_`
   - `organisationId_isActive_deletedAt`
   - `entraOid_unique_partial`
   - `organisationId_email_unique`

2. **Nová migrácia `2026-06-01b-drop-residual-email-index`** — namiesto hádania mien **inšpektuje živý zoznam indexov** (`usersCol.indexes()`) a dropne ANY single-field unique index na `email`, bez ohľadu na meno. Composite `{ organisationId, email }` (2 polia) nechá nedotknutý. Idempotentná — ak nič nesedí, no-op.
   - Zaregistrovaná v `runner.ts` (nový kľúč `2026-06-01b-drop-residual-email-index`)
   - Na prod bude no-op (index už dropnutý ručne), ale opraví **dev cluster** (má pravdepodobne ten istý reziduálny index) a každý budúci **fork** — self-healing.

## Prečo nová migrácia, nie edit starej

Stará `2026-05-29c` má v `migrations` kolekcii `completedAt` → runner ju preskakuje. Edit jej drop-listu by sa nikdy nespustil. Nová migrácia s vlastným kľúčom je jediný spôsob, ako zaručene prebehne pri ďalšom deployi.

## Prečo inšpekcia indexov namiesto zoznamu mien

Presne ten istý bug (zlé meno v fixnom zozname) sa nemá ako zopakovať. Migrácia rozhoduje podľa **tvaru** indexu (single-field na `email` + unique), nie podľa mena. Robustné voči akémukoľvek pomenovaniu z minulosti.

## Súbory

- `apps/api/src/migrations/2026-06-01b-drop-residual-email-index.ts` (nový)
- `apps/api/src/migrations/runner.ts` (import + registrácia)
- `apps/api/tests/unit/migration-drop-residual-email-index.test.ts` (nový, 6 testov)

## Testy

```
migration-drop-residual-email-index.test.ts — ✅ (6 testov)
  - drop podľa mena users_email_global_unique
  - drop legacy email_1
  - preserve composite organisationId_email_unique
  - non-unique email index sa NEdropne
  - idempotencia (druhý beh no-op)
  - no-op keď nič nesedí
celá test suite — zelená ✅
```

## Stav

- ✅ Prod: globálny index dropnutý, 4 správne indexy
- ✅ Migrácia pre dev/forky pripravená, otestovaná
- ✅ **SFZ pilot odblokovaný** — žiadne E11000 riziko pri 2. tenantovi

## Commit message

```
fix(api): drop residual global email unique index (multi-tenant E11000 fix)
```
