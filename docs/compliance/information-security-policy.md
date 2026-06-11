<!--
SPDX-FileCopyrightText: 2026 LTK Solutions, s.r.o.
SPDX-License-Identifier: CC-BY-4.0
-->

# Information Security Policy — LTK Solutions / Inventario

> **Účel.** Interný riadiaci dokument popisujúci bezpečnostné zásady, kontroly a zodpovednosti pri vývoji a prevádzke platformy Inventario. Slúži ako jeden zo základných dokumentov pre budúci SOC 2 / ISO 27001 audit a ako podklad pre customer due diligence.
>
> **Klasifikácia: INTERNÉ.** Verejne komunikované zhrnutie je v [`security-privacy-whitepaper.md`](./security-privacy-whitepaper.md).
>
> ⚠️ **Disclaimer**: Pred formálnou certifikáciou (SOC 2 / ISO 27001) musí byť tento dokument rozšírený a auditovaný akreditovaným audítorom.

| Pole                  | Hodnota                                         |
| --------------------- | ----------------------------------------------- |
| **Verzia**            | 1.0                                             |
| **Účinné od**         | 2026-06-11                                      |
| **Vlastník politiky** | Ing. Ján Letko (konateľ, LTK Solutions, s.r.o.) |
| **Prehodnotenie**     | ročne, alebo pri podstatnej zmene architektúry  |
| **Kontakt**           | security@inventario.estate                      |

---

## 1. Rozsah a zodpovednosti

Politika sa vzťahuje na celú platformu Inventario (`apps/api`, `apps/web`, infraštruktúra) a na všetky osoby s prístupom k produkčným systémom alebo zákazníckym dátam.

- **Vlastník bezpečnosti:** konateľ LTK Solutions — schvaľuje politiku, rozhoduje o reziduálnom riziku.
- **Vývoj a prevádzka:** dodržiavanie secure SDLC, code review, reakcia na incidenty.
- **Dodávatelia (sub-processori):** viazaní DPA + SCCs — viď [`legal/sub-processors.md`](./legal/sub-processors.md).

## 2. Riadenie prístupu (Access Control)

- **Autentifikácia:** OAuth 2.0 (Microsoft Entra ID, Google, Apple — plánované) alebo lokálny účet (e-mail + heslo).
- **Heslá:** hashované **argon2id** (memoryCost 65536, timeCost 3, parallelism 4). Heslá sa nikdy neukladajú v čitateľnej forme.
- **MFA:** TOTP (RFC 6238, 6-cifier, 30 s), per-tenant politika `DISABLED / OPTIONAL / REQUIRED`. TOTP secret šifrovaný **AES-256-GCM**, recovery kódy hashované argon2id.
- **Autorizácia:** RBAC s 5 rolami (EXTERNAL, EMPLOYEE, ASSET_MANAGER, ADMIN + platform), vynucované na úrovni routes.
- **Princíp najmenších oprávnení:** produkčný DB používateľ má `readWrite` len na produkčnú databázu; prístup k secrets cez Vercel encrypted env, nie v repozitári.
- **Session:** JWT (RS256, asymetrický) v HttpOnly + Secure + SameSite cookie; rotácia kľúčov.

## 3. Multi-tenant izolácia

Najvyššia bezpečnostná priorita (threat I-1 v [`threat-model.md`](./threat-model.md)). `organisationId` sa nastavuje **výhradne server-side z JWT claimu**, nikdy z tela požiadavky. Každý repository dotaz je tenant-scoped (`requireTenantId` + `tenantFilter`, `apps/api/src/lib/organisation-scoping.ts`). Cudzí-tenant zdroj vracia **404 (nie 403)**. Pokrytie: **17 cross-tenant izolačných testov**.

## 4. Šifrovanie

| Vrstva               | Mechanizmus                                           |
| -------------------- | ----------------------------------------------------- |
| At-rest              | MongoDB Atlas AES-256 (transparent); zálohy šifrované |
| In-transit           | TLS 1.3 minimum; HSTS preload pre `inventario.estate` |
| Heslá                | argon2id                                              |
| MFA secrets          | AES-256-GCM (kľúč v `MFA_SECRET_ENCRYPTION_KEY`)      |
| OAuth client secrets | Vercel encrypted env; per-tenant secrets AES-256-GCM  |
| Inventario JWT       | RS256 (asymetrický keypair)                           |

## 5. Bezpečný vývoj (Secure SDLC)

- **Validácia vstupov/výstupov:** Zod schémy na hraniciach API.
- **Code review:** zmeny cez PR; CI brána (lint, typecheck, build, testy, REUSE lint, OpenAPI freshness, commitlint).
- **Statická analýza:** ESLint (vrátane `jsx-a11y` pre frontend), CodeQL workflow.
- **Závislosti:** Dependabot; SBOM generovaný (`sbom.cdx.json`, CycloneDX 1.6).
- **Append-only audit log:** zapisovaný atomicky v Mongo transakcii spolu s business operáciou.
- **Tajomstvá:** nikdy v kóde; `.env` mimo gitu; rotácia pri podozrení na únik.
- **Data minimisation pri uploade:** EXIF/XMP metadáta (GPS, zariadenie) sa odstraňujú z nahrávaných obrázkov (`lib/strip-image-metadata.ts`).

## 6. Riadenie zraniteľností

- **Penetračné testy:** ročne (po go-live).
- **Coordinated Vulnerability Disclosure:** [`SECURITY.md`](../../SECURITY.md), kontakt security@inventario.estate; pre P1 verejné GitHub Security Advisory.
- **Rate limiting** proti brute-force a flooding (threat D-2/D-4).
- Reakcia na CVE v závislostiach: triáž a patch podľa závažnosti.

## 7. Logovanie a monitoring

- Append-only audit log pre business + security udalosti (kto-čo-kedy, IP, User-Agent).
- Retencia podľa [`data-retention-schedule.md`](./data-retention-schedule.md) (24/60/84 mesiacov).
- Mesačná kontrola audit logu na anomálie; alerty na security severity.

## 8. Zálohovanie a obnova (BCP/DR)

- **RPO ≤ 24 h, RTO ≤ 8 h** (viď [`disaster-recovery-plan.md`](./disaster-recovery-plan.md)).
- Atlas continuous backup + denný snapshot, retencia 90 dní, point-in-time recovery, AWS eu-central-1.
- Replica-set failover < 1 min (automatický).
- **Test kadencia:** restore test štvrťročne, tabletop ročne. DR Test #1 (2026-05-23): PASS.

## 9. Reakcia na incidenty a porušenia

Podľa [`breach-notification-plan.md`](./breach-notification-plan.md): klasifikácia P1–P4; notifikácia tenant-a do **24 h**, dozorný orgán (ÚOOÚ SR) do **72 h** (čl. 33), dotknuté osoby do 72 h pri vysokom riziku (čl. 34). Containment: revoke JWT, suspend tenant, rotácia secrets, IP blok.

## 10. Fyzická a organizačná bezpečnosť

- Žiadna vlastná serverová infraštruktúra — všetko u certifikovaných sub-processorov (Vercel, MongoDB Atlas) s vlastnými fyzickými kontrolami (ISO 27001 / SOC 2 na ich strane).
- Pracovné stanice: šifrovaný disk, MFA na všetkých účtoch s prístupom k produkcii.

---

## Zmenová história

| Verzia | Dátum      | Zmena                                                            |
| ------ | ---------- | ---------------------------------------------------------------- |
| 1.0    | 2026-06-11 | Prvá verzia — konsolidácia z threat-model, DR plánu, ROPA a kódu |

## Referencie

- [`threat-model.md`](./threat-model.md) · [`disaster-recovery-plan.md`](./disaster-recovery-plan.md) · [`breach-notification-plan.md`](./breach-notification-plan.md)
- [`data-retention-schedule.md`](./data-retention-schedule.md) · [`gdpr-article-30.md`](./gdpr-article-30.md)
- [`../../SECURITY.md`](../../SECURITY.md)
