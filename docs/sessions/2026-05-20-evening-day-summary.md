<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 2026-05-20 (evening) — Slice #4 Frontend Kompletný

## Súhrn

Dokončenie posledných chýbajúcich kusov Slice #4 frontend web app.
Viac ako 90 % kódu bolo už pripravených v stub komponentoch (Opus 4.7
plánoval, generoval architektúru a stubs v predchádzajúcej session).
Táto session (Sonnet 4.6) doplnila dva chýbajúce kusy a uzavrela
Slice #4 milestone.

**Model routing:** Opus 4.7 pre strategické plány / handoff → Sonnet 4.6
pre targeted edity + milestone doc.

---

## Čo sa zistilo pri čítaní repo

Stubs boli **plno implementované** — api-hooks.ts mal všetky loan hooky
(`useLoanRequests`, `useMyLoans`, `useLoans`, `useCreateLoanRequest`,
`useApproveLoanRequest`, `useRejectLoanRequest`, `useCancelLoanRequest`,
`useCanManageLoans`), AppShell nav mal `/loans` + `/my-loans` položky,
`LoanRequestContent.tsx` a `LoansContent.tsx` boli kompletné.

Chýbali iba **2 veci**:

1. `MyLoansContent.tsx` — sekcia „Čakajúce žiadosti" (pending requests)
2. `DashboardContent.tsx` — loans card mal `value={0}` + hint „modul príde čoskoro"

---

## Čo sa urobilo

### 1. `MyLoansContent.tsx` — sekcia „Čakajúce žiadosti"

Pridané:

- `useLoanRequests({ status: 'PENDING', limit: 20 })` call
- `PendingRequestsList` komponent — tabuľka s Majetok / Účel / Termín / Akcie
- `PendingRequestRow` komponent — jeden riadok s Zrušiť button
  (`useCancelLoanRequest` mutation, inline error pre 403/400)
- Sekcia sa **skryje** keď nie sú žiadne PENDING žiadosti (condition:
  `pendingRequests.length > 0 || pendingQuery.isLoading`)
- Loading state: pulse skeleton div kým query beží
- Existujúca loans tabuľka dostala `<section aria-labelledby="loans-heading">`
  wrapper pre správnu landmark štruktúru

### 2. `DashboardContent.tsx` — real loans data

- Import `useMyLoans` pridaný
- `const loans = useMyLoans({ limit: 1, status: 'ACTIVE' })` — iba
  active výpožičky, limit 1 pre pagination.total count (rovnaký
  pattern ako useAssets/useCategories/useLocations)
- StatCard: `value={loans.data?.pagination.total}` + `isLoading` +
  `isError` + `hint="aktívnych výpožičiek"` (nahradilo `value={0}`)
- Error banner condition rozšírená o `loans.isError`

### 3. `docs/milestones/slice-4-frontend-web.md`

Nový milestone doc pre kompletný Slice #4:

- 7/7 P0 stránok s build sizes + commit references
- Tech stack tabuľka
- Komponentová štruktúra
- Auth flow diagram
- RBAC gating hooks tabuľka
- Loans modul detailný popis (3 stránky)
- a11y WCAG 2.1 AA highlights
- Mobile responsive prehľad
- Vercel deploy lekcie (skrátené, odkaz na day-summary)
- Deferral list (čo NIE JE v Slice #4)
- Commit chronológia

### 4. `docs/sessions/NEXT.md`

- Stratégia: Slice #4 označený ako ✅ **DONE** (7/7 P0 stránok)
- Header update: nový timestamp, Slice #4 kompletný
- Sekcia „Ďalší krok" prepísaná: pilot tenant onboarding (nie loans backend)
- Slice #5b sekcia zachovaná ale jasne označená „po pilot feedback — nie teraz"

---

## Súbory zmenené

| Súbor                                          | Zmena                                           |
| ---------------------------------------------- | ----------------------------------------------- |
| `apps/web/src/components/MyLoansContent.tsx`   | +sekcia Čakajúce žiadosti (PendingRequestsList) |
| `apps/web/src/components/DashboardContent.tsx` | +useMyLoans, real loans card data               |
| `docs/milestones/slice-4-frontend-web.md`      | **NOVÝ** — kompletný milestone doc              |
| `docs/sessions/NEXT.md`                        | Slice #4 ✅, ďalší krok = pilot onboarding      |

---

## Stav po session

- ✅ **Slice #4 KOMPLETNÝ** — 7/7 P0 stránok implementovaných + docs
- ✅ `app.inventario.sportup.sk` zostáva live (žiadne breaking changes)
- ✅ Loans flow end-to-end: `/loans/request` → ASSET_MANAGER approve v `/loans`
  → `/my-loans` zobrazí aktívnu výpožičku
- ⏭️ **Ďalší krok: Pilot tenant onboarding** (per NEXT.md)

---

## Commit

```
feat(web): complete Slice #4 — loans UI + dashboard card + milestone doc

- MyLoansContent: add 'Čakajúce žiadosti' section (pending loan-requests
  with cancel action, hidden when empty, pulse skeleton while loading)
- DashboardContent: wire loans stat card to real data via useMyLoans
  (status=ACTIVE, limit=1 for pagination.total count)
- docs/milestones/slice-4-frontend-web.md: complete Slice #4 milestone doc
  (7/7 P0 pages, tech stack, RBAC hooks, a11y, mobile, Vercel lessons)
- docs/sessions/NEXT.md: mark Slice #4 DONE, next step = pilot onboarding
```
