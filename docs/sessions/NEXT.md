<!--
SPDX-FileCopyrightText: 2026 Jan Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — co robit v dalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-06-01 (ADR-0021 K1-K3 done — publicToken, inventoryNumberFormat, QR endpoint) |
| **Aktuálna fáza**         | Production LIVE — ADR-0021 K4 (verejny lookup) je next                             |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`                                      |
| **GitHub**                | https://github.com/ltksolutions/inventario                                         |

---

## 🔥 Teraz: ADR-0021 QR kody — K4 je next

**K1 ✅ schemy** — publicToken, PublicAssetViewSchema, InventoryNumberFormatSchema, appBaseUrl, foundContactInfo, publicAssetLookup  
**K2 ✅ publicToken generácia + tenant-level inventoryNumberFormat** — repository, service, migrácia, testy  
**K3 ✅ QR render endpoint** — `GET /v1/assets/:id/qr?format=svg|png`, qrcode npm, cache immutable

### K4 — verejny `GET /v1/public/scan/:token` endpoint (NEXT)

Nový plugin `public-assets.routes.ts`:

- Bez auth, rate-limited 30/min/IP (fastify rate-limit)
- Logika: `repo.findByPublicToken(token)` → loadOrg → ak `publicAssetLookup=false` → 404
- Response: `PublicAssetView` mapper — **pole po poli, NIE spread** (whitelist je bezp. invariant)
- Pola: `organisationName`, `organisationLogoUrl`, `inventoryNumber`, `name`, `foundContact`
- HTTP 200 pre found+enabled, 404 pre not-found ALEBO disabled (nerozlišovať — privacy)

### K5 — frontend

- `/scan/[publicToken]` route (Next.js)
- Redirect logika: prihlásený → `/assets/:id`, nie → login page alebo verejná stránka
- QR zobrazenie na detaile assetu (`/assets/[id]`)
- Settings: org `foundContactInfo` formulár s GDPR hint textom

### K6 — whitelist test (kriticke!)

```ts
expect(Object.keys(PublicAssetViewSchema.shape).sort()).toEqual(
  [
    'foundContact',
    'inventoryNumber',
    'name',
    'organisationLogoUrl',
    'organisationName',
  ].sort(),
);
```

### K7 — regen artefaktov

```
pnpm --filter @inventario/api openapi:export:offline
pnpm test
```

Commit: `chore(api): refresh openapi.json (ADR-0021)`

---

## ADR-0026 — Katalogove žiadosti + oddelene vydávanie ✅ IMPLEMENTOVANE

K1–K7 hotove, 690 testov zelených. Session: `docs/sessions/2026-06-01-adr-0026-implementation.md`.

---

## ADR-0025 / ADR-0024 / ADR-0023 ✅ IMPLEMENTOVANE

---

## ADR-0022 — Preberacie protokoly (on-demand PDF) ✅ ACCEPTED

Revidovane: PDF sa neuklada — LoanProtocol zaznam (cislo, snapshoty, podpisy) zostava, PDF
sa generuje cisto on-demand pri stiahnutí. K1-K8 cakaju na implementaciu (P2 backlog).

---

## Planované (neskôr)

### Smoke test po deployi

- [ ] `/settings/organisation` — formular + ulozenie billing funguje
- [ ] ADR-0026 formular žiadosti (kategória+množstvo) + vydávanie

### Pilot tenant onboarding

SFZ (`inventario@futbalsfz.sk`) — overiť login na prod a prejsť onboardingom.

### email_unique index — overiť na prod Atlas

- [ ] Skontrolovať že `email_unique` / `email_1` index bol dropnutý migráciou 2026-05-29c

---

## 🧭 Model routing

| Task typ                                                    | Model          |
| ----------------------------------------------------------- | -------------- |
| Strategické rozhodnutia, ADR, DPIA, security architecture   | **Opus 4.8**   |
| CRUD endpoints, frontend pages, debug, tests, implementácia | **Sonnet 4.6** |
| Milestone docs, mechanické edits, scoped docs               | **Haiku 4.5**  |

---

## 📂 Kde nájdeš čo

| Typ                               | Lokácia                                               |
| --------------------------------- | ----------------------------------------------------- |
| **Aktuálny stav**                 | `docs/sessions/NEXT.md` (TY SI TU)                    |
| **Session 2026-06-01 (K1-K3)**    | `docs/sessions/2026-06-01-adr-0021-qr-k1-k3.md`       |
| **Session 2026-06-01 (ADR-0026)** | `docs/sessions/2026-06-01-adr-0026-implementation.md` |
| **ADR-čka**                       | `docs/decisions/0001..0026-*.md`                      |
| **Slice milestones**              | `docs/milestones/slice-*.md`                          |

---

**Last updated:** 2026-06-01 (ADR-0021 K1-K3 done, K4 je next)  
**Tests:** 690+ ✅ | **CI:** zelene ✅ | **Repo:** github.com/ltksolutions/inventario | **Status:** Production LIVE ✅
