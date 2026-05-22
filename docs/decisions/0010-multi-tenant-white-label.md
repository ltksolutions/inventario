<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0010. Multi-tenant white-label architektúra

|                   |                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | ✅ Accepted                                                                                                                              |
| **Dátum**         | 2026-05-15                                                                                                                               |
| **Autori**        | Ján Letko, Claude (LTK Solutions)                                                                                                        |
| **Súvisiace ADR** | [0003 MongoDB Atlas](0003-mongodb-atlas.md), [0004 Entra ID](0004-auth-entra-id.md), [0011 EUPL licensing](0011-licensing-eupl-reuse.md) |

## Kontext

Pri návrhu Inventaria v LTK Solutions sme riešili strategickú otázku: ako postaviť platformu pre evidenciu majetku tak, aby bola použiteľná pre výrazne rôzne typy organizácií, bola ekonomicky udržateľná v prevádzke, a zároveň dávala veľkým subjektom možnosť plnej kontroly nad vlastnou inštanciou.

Funkčný problém — _„kde čo máme a kto si to vzal?"_ — riešia rôzne sektory paralelne:

- športové zväzy (futbal, hokej, basketbal, atletika, vodný motorizmus),
- mestá a obce (mobiliár, služobné vozidlá, IT vybavenie),
- vyššie územné celky (krajský majetok),
- športové kluby (mládežnícke dresy, tréningové pomôcky),
- školy a školské zariadenia (IT, učebné pomôcky, hudobné nástroje),
- občianske združenia a neziskové organizácie.

Dátový model navrhujeme bez sektor-špecifických polí — kategórie a lokality sú konfigurovateľné per tenant, takto sa celý model adaptuje na každý kontext bez špeciálnych vetiev v kóde.

Paralelne s týmto rozhodnutím vzniká platforma [sportup.sk](https://sportup.sk) — _Good Idea Sport Slovakia_ — národný register osôb, organizácií, aktivít a športovísk. Inventario má potenciál stať sa jej modulom pre správu majetku, čo prirodzene vyžaduje multi-tenancy.

### Obmedzenia

- **Náklady**: MongoDB Atlas Flex tier stojí ~30 USD/mesiac za cluster. Per-tenant cluster pre desiatky malých klubov by bol ekonomicky neudržateľný.
- **Operability**: jedna inštancia s jedným backupom, monitoringom a migration pipeline je rádovo lacnejšia ako N inštancií.
- **Dáta separácia**: GDPR a niektoré sektorové predpisy (verejný sektor, štátna správa) môžu vyžadovať fyzickú separáciu dát.
- **Časový tlak**: chceme byť pripravení pre EU verejný sektor a EU fondy (OPII, OP Slovensko) — viď [ADR-0011](0011-licensing-eupl-reuse.md).

## Možnosti

### Možnosť A: Single-tenant (status quo)

Každý zákazník dostane vlastnú inštanciu. Žiadny `organisationId` field, žiadne tenant scoping.

- **Plus**: jednoduchý kód; každý tenant má vlastnú DB; jasná dátová izolácia.
- **Mínus**: pre 50 zákazníkov treba 50 inštancií; vysoké náklady; ťažšia údržba a updaty.

### Možnosť B: Multi-tenant cez `organisationId` (logical multi-tenancy)

Jeden cluster, jedna DB, ale každý dokument v kolekcii má `organisationId` field. Backend middleware filtruje queries podľa current user organisation.

- **Plus**: lacné prevádzkové náklady; jedna codebase; jednoduché upgrades; vhodné pre desiatky až stovky malých tenantov.
- **Mínus**: musíme garantovať že žiadny query nikdy nezabudne `organisationId` filter (bezpečnostná invariant); zdieľaná DB znamená že performance problém jedného tenanta ovplyvní ostatných.

### Možnosť C: Database-per-tenant

Každý tenant má vlastnú databázu v rovnakom clustri. Connection pooler vyberá DB podľa current tenant.

- **Plus**: fyzická separácia dát; performance izolácia.
- **Mínus**: komplexnejšia infraštruktúra; pri migráciách treba spustiť každú DB; väčšie operatívne náklady; stále zdieľaný cluster.

### Možnosť D: Logical multi-tenant + open-source fork

Predvolená inštancia (hosted SaaS na inventario.sk) je multi-tenant podľa možnosti B. Veľké organizácie, ktoré potrebujú **vlastnú DB / infraštruktúru / compliance** (mestá nad 100 000 obyvateľov, ministerstvá, veľké zväzy), si **forkujú celý open-source projekt** a hostia vlastnú self-hosted inštanciu.

- **Plus**: kombinuje výhody B (lacné pre malých) a C (separácia pre veľkých) bez zložitej infraštruktúrnej vrstvy; podporuje open-source pozíciu projektu; argument _„bez vendor lock-in"_ je silný pre verejný sektor.
- **Mínus**: forkujúce organizácie si musia spravovať vlastný upgrade cyklus; potrebujeme čistú dokumentáciu pre self-hosting.

## Rozhodnutie

Zvolili sme **Možnosť D: Logical multi-tenant + open-source fork**.

Konkrétne to znamená:

1. **Hosted SaaS** inštancia (inventario.sk alebo podobne) je shared cluster s `organisationId` na všetkých kolekciách. Toto je predvolená cesta pre väčšinu zákazníkov.
2. **Nová kolekcia `organisations`** drží metadata každého tenanta: name, slug, branding (logo, primary color, secondary color), settings, billing info.
3. **Každá doménová kolekcia** (assets, categories, locations, users, audit_log, loans, ...) dostane `organisationId: ObjectId` field. Compound indexy: `{ organisationId: 1, deletedAt: 1, ... }`.
4. **Backend middleware** injektuje `ctx.organisationId` z JWT do každého query. Žiadny query bez `organisationId` filter-a nesmie prejsť — vytvoríme architecturalexistujúce repozitárové triedy tak, aby pomocou `OrganisationScopedRepository<T>` base class-y nešlo zabudnúť na filter.
5. **Veľké organizácie** s tvrdými requirements (GDPR DPIA, štátna správa, vlastný cluster) → **fork repo + self-host**. EUPL-1.2 licencia toto plne umožňuje (viď [ADR-0011](0011-licensing-eupl-reuse.md)).
6. **Žiadny `Organisation.database: string` field** — nebudeme stavať connection pooler. Fork je transparentnejšie riešenie.

### Tenant branding mechanizmus

Každý `Organisation` dokument obsahuje pole `branding`:

```ts
type OrganisationBranding = {
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string; // hex, napr. "#1A2D47"
  secondaryColor: string; // hex
  accentColor: string; // hex
  customDomain?: string; // napr. "assets.bratislava.sk"
};
```

Pri SSR/CSR injektujeme CSS variables do `:root` podľa current tenanta. Default branding používa SportUp paletu (Navy/Blue/Paper).

### Dátový model — migrácia

Existujúce kolekcie (assets, categories, locations, users, audit_log) v slice #3 ešte nemajú `organisationId`. Migráciu spravíme v slice #3.5 alebo na začiatku slice #4:

1. Pridať `organisationId: ObjectId` field do shared-types schém ako required.
2. Spustiť migration script ktorý priradí všetkým existujúcim dokumentom default `organisationId` (vytvoríme „Inventario" default tenant organisation ako technického prvého tenanta).
3. Aktualizovať všetky repository queries aby filtrovali podľa current tenant.
4. Pridať middleware ktorý odmietne request bez tenant context-u (okrem public health-check endpointov).

### Autentifikácia v multi-tenant svete

Microsoft Entra ID už podporuje multi-tenant aplikácie. Konfigurácia:

- Aplikácia bude registrovaná ako _multi-tenant_ v Azure AD (`signInAudience: AzureADMultipleOrgs`).
- Každá organizácia (športový zväz, Mesto Pezinok, ŠŠ Kremnica, ...) má vlastný Entra tenant.
- Pri prvom prihlásení sa užívateľ priradí k organisation podľa Entra tenantId — vytvoríme novú `Organisation` ak ešte neexistuje (JIT tenant provisioning, paralela existujúceho JIT user provisioningu).
- V budúcnosti pridáme SportUp identita ako druhý OIDC provider.

## Dôsledky

### Pozitívne

- **Ekonomicky udržateľné**: jeden cluster pre desiatky až stovky tenantov; cena na tenant klesá s počtom.
- **Otvorená cesta pre veľké tenanty**: fork + self-host je vždy možnosť, žiadny vendor lock-in.
- **Konzistentný produkt**: všetci tenanti dostávajú rovnaké features v rovnakom čase; jediná inštancia má aktuálnu verziu.
- **Branding ako konkurenčná výhoda**: každý tenant cíti aplikáciu ako vlastnú, nie ako _„SaaS od XY"_.
- **Audit a compliance**: jedna audit log kolekcia s `organisationId` filtrom; ľahko sa generujú GDPR Article 30 reporty per-tenant.
- **EU fondy ready**: kombinácia multi-tenant + open-source + EUPL = splnenie podmienok pre OPII, Digital Europe, Horizon Europe.

### Negatívne / kompromisy

- **Bezpečnostná invariant**: žiadny query nesmie zabudnúť na `organisationId`. Riešenie: `OrganisationScopedRepository<T>` base class-a kde sa filter pridáva automaticky. Test coverage musí explicitne overovať cross-tenant izoláciu.
- **Performance shared pool**: ak má jeden tenant 100 000 assetov a iný 100, queries na compound index sú stále rýchle, ale aggregation pipelines musia byť opatrné. Pre extrémny rast budeme musieť riešiť tenant-specific connection pooling.
- **Backup & restore granularita**: backup je per-cluster, nie per-tenant. Ak chce jeden tenant restore na point-in-time, ovplyvňuje to všetkých. Mitigácia: pravidelné export-y per-tenant do tenant-specific S3 bucketu.
- **Cross-tenant queries**: aggregate reporting cez všetkých tenantov je technicky možné (admin view), ale potrebuje špeciálne API a explicit super-admin role. Toto pre teraz neimplementujeme.

### Riziká, ktoré treba sledovať

- **Forgotten tenant filter** = data leak. Mitigácia: code review checklist, repository base class, integration testy s `organisationId` cross-checks.
- **Tenant onboarding overhead**: pre 50+ tenantov potrebujeme self-service onboarding (signup, automatický setup default kategórií a lokácií). V slice #4 frontend.
- **Custom domain SSL**: ak budeme ponúkať `assets.bratislava.sk`, musíme automatizovať SSL cez Let's Encrypt + Vercel custom domains. Toto rieši Vercel platforma natívne.
- **Storage scaling**: MongoDB Atlas Flex je do ~5 GB. Pre 100 tenantov × 1 000 assets × attachments to môže byť tesné — pripraviť plán prechodu na M10/M20 Dedicated.

## Referencie

- [Microsoft — Multi-tenancy architectural guidance](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/overview)
- [MongoDB — Building with Patterns: The Multi-Tenant Pattern](https://www.mongodb.com/blog/post/building-with-patterns-the-multi-tenant-pattern)
- [Vercel — Multi-tenant Next.js applications](https://vercel.com/guides/nextjs-multi-tenant-application)
- [ADR-0011: EUPL-1.2 + REUSE compliance](0011-licensing-eupl-reuse.md) — open-source forkability je súčasť tejto stratégie
- [Session plán 2026-05-15](../sessions/2026-05-15-design-pivot.md) — kontext rozhodnutia
- [sportup.sk](https://github.com/ltksolutions/sportup.sk) — paralelná platforma ekosystému
