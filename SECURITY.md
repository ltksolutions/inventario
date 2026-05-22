<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Bezpečnostná politika

## Hlásenie zraniteľností

Bezpečnosť projektu **Inventario** berieme vážne. Platforma spracúva údaje o majetku organizácií (športových zväzov, miest, obcí, klubov, škôl, neziskoviek) — informácie, ktoré nepatria do verejného priestoru. Ďakujeme, že nám pomáhate zodpovedným hlásením bezpečnostných problémov.

### ⚠️ Nehláste bezpečnostné chyby cez verejné GitHub issues

Verejné issues sú viditeľné pre všetkých a útočníci by mohli zraniteľnosť zneužiť skôr, než ju opravíme.

### Ako nahlásiť

Použite jeden z týchto kanálov:

1. **GitHub Security Advisories** (preferované)
   - Choďte na záložku **Security** tohto repa → **Report a vulnerability**
   - Toto je súkromný kanál priamo medzi vami a údržbárami repa

2. **E-mail:** `inventario@ltk.solutions`
   - Predmet: `[SECURITY] Inventario — krátky popis`
   - Voliteľne PGP šifrované — kľúč na vyžiadanie

### Čo zahrnúť do hlásenia

Pre čo najrýchlejšie vyriešenie nám prosím poskytnite:

- **Popis** zraniteľnosti a potenciálny dopad
- **Kroky na reprodukciu** (proof of concept ak je možný)
- **Postihnuté verzie** alebo komponenty
- **Návrh riešenia**, ak ho máte
- **Vaše kontaktné údaje** pre prípadné doplňujúce otázky

### Čo môžete očakávať

| Časový rámec | Akcia                                                                             |
| ------------ | --------------------------------------------------------------------------------- |
| Do 48 hodín  | Potvrdenie prijatia hlásenia                                                      |
| Do 7 dní     | Prvotné posúdenie a klasifikácia (severity)                                       |
| Do 30 dní    | Plán opravy alebo finálne vyjadrenie                                              |
| Po oprave    | Verejné zverejnenie (CVE ak relevantné) a poďakovanie reportérovi (ak si to želá) |

### Disclosure timeline

Praktizujeme **coordinated disclosure**:

1. Hlásenie nahlásené súkromne
2. Preverenie a oprava (typicky 30–90 dní podľa závažnosti)
3. Patch nasadený do hosted SaaS inštancie aj odporúčaný self-hosted upgrade
4. Verejné zverejnenie zraniteľnosti s atribúciou reportéra (ak si to želá)

Pre zraniteľnosti, ktoré sú aktívne zneužívané, môže byť timeline kratší.

### Rozsah

**V rozsahu (in-scope):**

- Kód v tomto repe (`apps/`, `packages/`, `infra/`)
- Verejne dostupné inštancie projektu (po nasadení, napr. `inventario.estate`)
- MCP servery v repe (po nasadení)
- Závislosti, ak ich zraniteľnosť priamo ovplyvňuje náš projekt

**Mimo rozsahu (out-of-scope):**

- **Self-hosted forks**: ak ste si forkli projekt a hostujete vlastnú inštanciu, ste primárne zodpovední za bezpečnosť svojho deployment-u. Radi vám poradíme cez community channels, ale CVD timeline neplatí.
- Sociálne inžinierstvo voči maintainerom alebo prispievateľom
- Fyzický prístup k zariadeniam
- DDoS útoky
- Zraniteľnosti v third-party službách (hláste priamo dodávateľovi; my zaktualizujeme po ich fixe)
- Aplikácie tretích strán postavené na Inventario API (sú zodpovednosťou ich autorov)
- Spam alebo obsahové problémy bez bezpečnostného dopadu

## Bezpečnostné postupy v projekte

- **Závislosti monitorované cez Dependabot** (GitHub) a pravidelne aktualizované.
- **Automatické PR pri bezpečnostných záplatách** kritických závislostí.
- **`pnpm audit`** ako súčasť CI pred každým release-om.
- **Bezpečnostné záplaty** sa releasujú prioritne, mimo bežného release cyklu.
- **Audit log** každej operácie zapisanej do MongoDB (kto, kedy, čo zmenil).
- **RBAC** s rolami EMPLOYEE / ASSET_MANAGER / ADMIN na úrovni Fastify routes.
- **Transactions** pre kritické operácie (audit log + dáta v jednej atomic akcii).
- **JWT verifikácia** cez JWKS rotation (Microsoft Entra ID).
- **MongoDB Atlas** s end-to-end TLS, IP whitelisting, encrypted storage at rest.

## Bezpečnostné princípy pre Inventario v EÚ verejnom sektore

Plánované implementácie pred produkčným nasadením (slice #8):

- **DPIA** (Data Protection Impact Assessment) — GDPR Article 35
- **Threat Model** — STRIDE alebo PASTA framework
- **Disaster Recovery Plan** — RTO/RPO definície
- **SBOM** (CycloneDX) — Cyber Resilience Act compliance (2027)
- **Penetration testing** — externý audit pred prvým produkčným tenant-om
- **WCAG 2.1 AA accessibility** — zákon 95/2019 (povinné pre verejný sektor SR)
- **Coordinated Vulnerability Disclosure (CVD)** policy — tento dokument

## Hall of Fame (Poďakovanie)

Po vyriešení zraniteľnosti radi uvedieme reportéra (ak si to želá) v zozname nižšie.

_Zatiaľ žiadne nahlásenia._

---

Ďakujeme, že nám pomáhate udržiavať **Inventario** v bezpečí. 🛡️

— Inventario maintainers · LTK Solutions · 2026
