<!--
SPDX-FileCopyrightText: 2026 LTK Solutions, s.r.o.
SPDX-License-Identifier: CC-BY-4.0
-->

# Discrepancy audit — marketingový web/docs vs. reálna appka (2026-06-12)

> **Účel.** Podklad pre TODO #25. Porovnanie tvrdení na `docs/marketing-site/` so skutočne implementovanými funkciami (`apps/web` + `apps/api`, CHANGELOG, ADR). **Toto je report na schválenie — copy zatiaľ NEUPRAVENÝ.** Po odsúhlasení nasledujú opravy textov + screenshoty.
>
> Zdroj pravdy = kód. Overené greppom v `apps/`.

## 🔴 P1 — Overclaim: funkcia inzerovaná, ale v kóde NEEXISTUJE

Tieto treba buď **stiahnuť z webu**, alebo jasne označiť ako „v roadmape". Inak web sľubuje nehotové veci.

| #   | Tvrdenie (kde)                                                                                                                                   | Realita                                                                                                                                                                             | Návrh                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | **Bulk import z CSV/Excel** (index krok 01 „importom z CSV"; pricing Pro Small „bulk import z Excel/CSV"; demo)                                  | V kóde **nie je** import endpoint ani parser. Existuje len audit enum `BULK_IMPORT_EXECUTED` (rezervované).                                                                         | Označiť „v roadmape" alebo odstrániť, kým sa neimplementuje.                                                |
| 2   | **Export reportov do CSV / PDF / JSON / XLSX** (index „Reporty s exportom do CSV/PDF"; demo „export do CSV/XLSX"; pricing „export CSV/PDF/JSON") | Reálne existuje len: **DSAR self-export (JSON)** `GET /v1/me/export`, **PDF protokolov** a **PDF/ZPL štítkov**. Všeobecný export zoznamu majetku / reportov do CSV/XLSX **nie je**. | Spresniť na to, čo appka vie (DSAR JSON, PDF protokol/štítok); zvyšok do roadmapy.                          |
| 3   | **Multi-level approval workflow** (pricing Pro Plus + tabuľka)                                                                                   | Loan-requests majú **jednoúrovňové** approve/reject. Viacúrovňové schvaľovanie **nie je**.                                                                                          | Odstrániť z tierov / označiť roadmap.                                                                       |
| 4   | **Child tenant + cross-org reporty** (use-cases VÚC)                                                                                             | Multi-tenant + prepínanie organizácií (membership) existuje, ale **hierarchia child-tenantov a cross-org reporting nie**.                                                           | Preformulovať na reálny multi-tenant model (samostatné tenanty + membership), bez sľubu cross-org reportov. |
| 5   | **Webhooks (Slack/Teams)** v pricing Pro Plus bez „roadmap" caveatu                                                                              | Neimplementované (technology ho správne značí „v roadmape").                                                                                                                        | Zjednotiť — v pricingu tiež označiť ako roadmap.                                                            |

## 🟠 P2 — Nesprávny stav funkcie (hotové vs. roadmap)

| #   | Tvrdenie                                                                                  | Realita                                                                                                            | Návrh                                                                       |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 6   | **Google OAuth** — index SSO sekcia ho značí „v roadmape", len Microsoft Entra „Dostupné" | Google **aj** Microsoft sú implementované a funkčné (`oauth.routes.ts`); about.html ich správne uvádza ako hotové. | Index: Google → „Dostupné".                                                 |
| 7   | **Apple Sign-In** — register/auth-settings UI zobrazuje tlačidlo                          | Kód existuje, ale je **gated env-mi → 503** (nie je nakonfigurované v produkcii).                                  | Nesľubovať Apple ako funkčné; označiť „čoskoro", kým nie sú Apple env vars. |

## 🟡 P3 — Interné nezrovnalosti a zastarané čísla

| #   | Problém                                                                         | Realita / návrh                                                                 |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 8   | **Počet testov:** 962 (index, about) vs **257** (technology)                    | Aktuálne ~**962** (959 passed + 2 skipped). Zjednotiť na aktuálne číslo všade.  |
| 9   | **REUSE súbory 175/175** (technology)                                           | Aktuálne **632/632** compliant. Aktualizovať.                                   |
| 10  | **Free používatelia:** 10 (pricing) vs 5 (demo CTA)                             | Zjednotiť (rozhodni 5 alebo 10).                                                |
| 11  | **Multi-level schvaľovanie** v pricingu: Pro Plus karta vs Pro Standard tabuľka | Aj tak ide preč (bod 3) — pri prepise odstrániť obe.                            |
| 12  | **SLA %**: Pro Standard karta bez %, tabuľka 99.5 %                             | Zjednotiť.                                                                      |
| 13  | **Verzia v0.3** (interactive-demo hero + footer shared.js)                      | Zastarané voči stavu (protokoly, MFA, branding, prílohy…). Aktualizovať verziu. |
| 14  | **Rola „Manager" vs „ASSET_MANAGER"**                                           | Kozmetické — zjednotiť pomenovanie.                                             |
| 15  | **Číselné metaúdaje demo** „6 P0 obrazoviek · v0.3 mockupy · 100 % Real UI"     | „100 % Real UI" je v rozpore s „mockupy"; viď screenshoty nižšie.               |

## 🟢 P4 — Zavádzajúce rámcovanie

| #   | Problém                                                                                                                                                                                                                                                           | Návrh                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 16  | **Demo tenanti ako reálne nasadenia** — use-cases.html uvádza Pezinok/Inter/Kremnica s číslami nasadenia („2 800+ položiek", „40 hod ušetrených/mes") ako reálnych zákazníkov; interactive-demo ich označuje ako **demo brandy**. SFZ je reálny (founding/pilot). | Jasne odlíšiť: SFZ = reálny pilot; ostatné = ilustračné demo scenáre (caveat „ilustračný príklad"). Inak hrozí zavádzajúce tvrdenie. |

## 🐞 Bug (nie marketing)

| #   | Problém                                                                                                                                                 | Návrh                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 17  | `demo.html` prepínač stránok: `pageFrame.src = page === "home" ? "index.html" : '.html'` → pre nehome stránky generuje len `.html` (nefunkčný preklik). | Opraviť na `${page}.html`. |

## 📸 Screenshoty / product-screens (samostatná fáza — vyžaduje živú appku)

- `interactive-demo.html` zobrazuje **statické mockupy** (`product-screens/_*.html`) v iframe a tvrdí „100 % Real UI" — mockupy nemusia zodpovedať aktuálnemu UI.
- Žiadna marketingová stránka nemá reálne raster screenshoty.
- **Potrebné:** prístup do živej appky (`app.inventario.estate`, login) cez Chrome → spraviť reálne screenshoty 6 obrazoviek (login, dashboard, zoznam majetku, detail, žiadosť, moje výpožičky) + nahradiť/aktualizovať mockupy. **Toto urobíme po schválení textových opráv** (potrebujem prístup/credentials alebo tvoju asistenciu pri logine).

## ✅ Čo na webe SEDÍ (overené)

QR kódy + tlač štítkov (PDF + Zebra ZPL), preberacie protokoly + PDF + podpis, audit log (append-only, IP, diff, retencia 24/60/84 m), RBAC, multi-tenant izolácia (organisationId, 404 na cudzie), MFA/TOTP + passkeys, per-tenant branding (logo/farby/font), prílohy/foto + EXIF strip, BULK/SERIALIZED + sklad, hierarchické kategórie/lokality, žiadosti o výpožičku + conflict detection, dashboard role-aware, DSAR práva, EÚ hosting, šifrovanie, OpenAPI 3.1, EUPL-1.2/REUSE/WCAG, `/security`, `/sub-processors`, `/dpia` stránky existujú.

---

## Navrhované poradie opráv (po schválení)

1. **P1 overclaimy** (1–5) — najvyššia priorita (právne/dôveryhodnostné riziko).
2. **P2 stav OAuth** (6–7).
3. **P3 čísla a konzistencia** (8–15).
4. **P4 demo tenanti** (16) + **bug** (17).
5. **Screenshoty** — samostatne, so živou appkou.
