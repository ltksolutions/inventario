#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
# SPDX-License-Identifier: EUPL-1.2

#
# Phase C Blok 5 commit script — three separate commits, no push.
#
# Run from the repo root:
#   bash scripts/commit-phase-c-blok-5.sh
#
# After this completes, review with `git log -3 --stat` before pushing.
#
# Commit body lines are wrapped at ≤ 100 chars to satisfy the project's
# commitlint body-max-line-length rule.

set -euo pipefail

# Koren repa sa odvodzuje z umiestnenia skriptu — natvrdo zapisana cesta
# prezila premenovanie repa aj jeho presun a ukazovala do prazdna.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Phase C Blok 5 — Three commits via git CLI"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Sanity check — make sure we're on a clean main branch with the
# expected changes staged-or-modified.
echo "→ Pre-flight check"
git status --short
echo ""

read -p "Continue with three commits? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
fi

# ---------------------------------------------------------------------------
# Commit 1 — API + tests + fixtures + migration script
# ---------------------------------------------------------------------------

echo ""
echo "─── Commit 1: feat(api) multi-tenant isolation ───"

git add \
    apps/api/src/modules/organisations/organisations.repository.ts \
    apps/api/scripts/migrate-organisation-id.ts \
    apps/api/tests/helpers/test-fixtures.ts \
    apps/api/tests/integration/auth.test.ts \
    apps/api/tests/integration/assets-patch.test.ts \
    apps/api/tests/integration/categories-patch.test.ts \
    apps/api/tests/integration/locations-patch.test.ts \
    apps/api/tests/integration/cross-tenant-isolation.test.ts

git commit \
    -m "feat(api): finalize multi-tenant isolation with partial filter indexes and cross-tenant tests" \
    -m "Phase C Blok 5 dokoncuje multi-tenant migraciu. OrganisationsRepository indexy
entraTenantId a customDomain presli zo sparse na partialFilterExpression typeof
string. Mongo sparse indexy v skutocnosti indexuju explicit null hodnoty a Zod
schema pise null ako default, tak ze dvaja LOCAL tenanti by kolidovali. Partial
filter null hodnoty spravne preskakuje.

Migration script teraz drop-uje aj obsolete entraTenantId_unique_sparse plus
customDomain_unique_sparse z organisations collection cez novu
dropLegacyOrganisationIndexes funkciu. Dev DB aj test DB presli migraciou.

Test fixtures su multi-tenant aware. Novy resolveTestTenantId helper
lazy-resolvuje JIT tenant z TEST_ENTRA_TENANT_ID slugu alebo ho inline vytvori.
Novy seedTestTenant pre cross-tenant testy. Vsetky insertTestX helpers dostali
optional organisationId parameter.

Novy cross-tenant-isolation.test.ts pokryva 17 scenarov cez assets categories
locations users plus audit log scope. Kontrakt potvrdeny. GET list iba aktualny
tenant. GET PATCH DELETE cross-tenant id vracia 404 nie 403. Slug email
inventoryNumber per-tenant unikatne.

Tri inline insertOne calls v existujucich test suboroch dostali organisationId
stamp. Auth test scenar GET v1 me deactivated user prepisany z 200 na 401
reflektujuc Blok 3 kontrakt kde loadCurrentUser chain odmieta deactivated users
na vsetkych protected endpointoch vratane self lookup.

327 testov zelenych. 310 existujucich plus 17 novych cross-tenant."

echo "  ✓ Commit 1 done"

# ---------------------------------------------------------------------------
# Commit 2 — Phase C milestone doc
# ---------------------------------------------------------------------------

echo ""
echo "─── Commit 2: docs(milestones) phase C milestone ───"

git add docs/milestones/phase-c-multi-tenant-migration.md

git commit \
    -m "docs(milestones): add phase C multi-tenant migration milestone doc" \
    -m "Comprehensive zhrnutie celej Phase C migracie. Pokryva vsetkych 5 blokov od
Organisation schema cez tenant-scoped repositories cez auth middleware refactor
cez migration script po cross-tenant isolation tests.

Doc zahrna architektonicke rozhodnutia 404 vs 403 a JIT tenant provisioning.
Composite index pattern. Sparse vs partial filter lesson learned. Test fixture
migration challenges. Manual overenie izolacie examples. Production migration
runbook.

Pripravuje podu pre Phase D EU compliance a Slice 4 frontend."

echo "  ✓ Commit 2 done"

# ---------------------------------------------------------------------------
# Commit 3 — NEXT.md update
# ---------------------------------------------------------------------------

echo ""
echo "─── Commit 3: docs(sessions) phase C complete ───"

git add docs/sessions/NEXT.md

git commit \
    -m "docs(sessions): mark phase C complete and shift focus to phase D" \
    -m "Aktualizuje continuation plan po dokonceni Phase C Blok 5. Pridava Blok 5
entry do history. Oznacuje celu Phase C ako complete. Posuva PRISTI KROK na
Phase D EU compliance. Odstranuje integration test broken entry z technical
debt sekcie."

echo "  ✓ Commit 3 done"

# ---------------------------------------------------------------------------
# Final state
# ---------------------------------------------------------------------------

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ All three commits created"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Last 3 commits:"
git log -3 --oneline
echo ""
echo "Working tree status (should be clean if no other unstaged changes):"
git status --short
echo ""
echo "Next: open GitHub Desktop and push to origin/main."
