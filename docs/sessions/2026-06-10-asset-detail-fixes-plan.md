# Plán opráv — detail majetku (Audit log, Prílohy/foto, QR/štítky)

**Dátum:** 2026-06-10
**Autor:** Janika + asistent
**Stav:** ✅ HOTOVÉ — všetky 3 prúdy implementované, otestované (941/941) a nasadené. Session log: `2026-06-10-asset-detail-fixes.md`.

## Kontext

Pri testovaní detailu majetku (`MacBook Air, SFZ-2026-00001`) sa našli 4 problémy.
Mapujú sa na **3 pracovné prúdy** podľa príčiny a náročnosti.

| #   | Problém (UI)                                          | Príčina                                                   | Prúd |
| --- | ----------------------------------------------------- | --------------------------------------------------------- | ---- |
| 3   | „Tlačiť štítok (PDF)" → chyba `appBaseUrl`            | `organisation.appBaseUrl = null` a nedá sa nikde nastaviť | A    |
| 4   | QR „Identifikácia" prázdny + „Stiahnuť PNG" nefunguje | to isté (`appBaseUrl`)                                    | A    |
| 1   | „Audit log" tab → len placeholder „čoskoro"           | dáta sa zapisujú, ale chýba read endpoint + napojenie UI  | B    |
| 2   | „Prílohy"/foto majetku → placeholder, nedá sa nahrať  | attachments modul na backende neexistuje, žiadne úložisko | C    |

---

## Prúd A — QR kódy + štítky (#3 + #4) · veľkosť: **S** (rýchle)

**Príčina (overené v kóde):**

- `GET /v1/assets/:id/qr` vracia **409**, ak `org.appBaseUrl` je null (zámer ADR-0021 — doména sa nikdy neberie z `Host` hlavičky).
- `appBaseUrl` je v `OrganisationSchema`, ale **nie je v žiadnej PATCH schéme** — ani admin `PATCH /:id`, ani self-service `PATCH /current` (ktorú používa stránka Organizácia). → Hláška „nastavte v Settings → Organizácia" odkazuje na pole, ktoré v UI neexistuje.

**Kroky:**

1. Backend: pridať `appBaseUrl` do `UpdateOwnOrganisationBodySchema` (PATCH `/current`) + `UpdateOrganisationBodySchema` (admin PATCH `/:id`); doplniť do `OrganisationsService.updateCurrent` / `update`. Validácia: platná `https://` URL alebo null.
2. Frontend: pridať pole „Základná URL aplikácie (pre QR/štítky)" do `OrganisationSettingsContent.tsx` (sekcia Organizácia), uložiť cez `useUpdateCurrentOrganisation`.
3. SFZ: admin nastaví `appBaseUrl = https://app.inventario.estate` cez nové pole (žiadny zásah do DB potrebný).
4. Test: QR panel, „Stiahnuť PNG", „Tlačiť štítok (PDF)".

**Riziká:** minimálne. QR scan stránka musí žiť na zvolenej doméne (`/scan/:token`).
**Výsledok:** odblokuje #3 aj #4 naraz.

---

## Prúd B — Audit log tab (#1) · veľkosť: **M**

**Stav (overené):** audit eventy pre `ASSET_*` sa zapisujú (transakčne). Repo má len `findByActor` — **chýba dotaz podľa cieľa (`target.entityId`)**, chýba routes modul aj UI napojenie.

**Kroky:**

1. Backend repo: `findByTarget(organisationId, entityType, entityId, { limit, skip })` + index na `{ organisationId, 'target.entityType', 'target.entityId', at }`.
2. Backend route: `GET /v1/assets/:id/audit` (alebo generický `GET /v1/audit?entityType=Asset&entityId=…`), RBAC = kto vidí asset; stránkovanie.
3. Frontend: hook + napojiť „Audit log" tab — zoznam (čas, aktér, akcia, popis, zmeny). Nahradiť placeholder.
4. Test: integračný (vytvor/uprav asset → audit list vráti záznamy), RBAC.

**Riziká:** GDPR — zobrazujeme `actor.displayName`/IP; obmedziť na oprávnené roly. Pseudonymizované záznamy ošetriť.

---

## Prúd C — Prílohy + foto majetku (#2) · veľkosť: **L** (vyžaduje rozhodnutie)

**Stav (overené):** existuje **len** `AttachmentSchema` v shared-types. Na backende **nie je** attachments modul, repo, routes, ani nakonfigurované object storage. Schéma spomína MinIO/Azure Blob a buckety `sfz-asset-attachments` / `sfz-asset-protocols`.

**OTVORENÉ ROZHODNUTIE — kam ukladať súbory?** (potrebujem od teba)

- **Vercel Blob** — najjednoduchšie, app beží na Verceli, presigned upload; vendor lock-in.
- **Azure Blob Storage** — sedí k Entra/Microsoft ekosystému SFZ, EU región; viac setupu.
- **S3-kompatibilné (MinIO/Cloudflare R2)** — flexibilné, self-host možný; vlastná správa.

**Kroky (po rozhodnutí o úložisku):**

1. ADR pre file storage (rozhodnutie + EU/GDPR, retencia, max veľkosť, povolené MIME).
2. Storage adaptér (presigned PUT/GET) + env konfig.
3. Backend: attachments modul — repo + `POST /v1/assets/:id/attachments` (init upload → presigned URL → confirm), `GET` zoznam, `DELETE` (soft), thumbnail pre foto.
4. Antivírus/limit MIME + veľkosti, EXIF strip pri fotkách.
5. Frontend: upload (drag&drop), galéria fotiek, hlavné foto majetku (nahradí placeholder dlaždicu), prílohy s náhľadom.
6. Testy: upload/limit/MIME, RBAC, soft-delete.

**Riziká:** bezpečnosť (presigned URL scope, MIME spoofing), GDPR (fotky = os. údaje, retencia), náklady na úložisko.

---

## Navrhované poradie a dodávka

1. **Prúd A** (dnes) — malý, okamžite viditeľný, odblokuje 2 problémy. Samostatný commit/PR.
2. **Prúd B** — stredný, samostatný commit/PR.
3. **Prúd C** — najväčší; začať ADR + rozhodnutie o úložisku, potom implementácia.

## Čo potrebujem od teba pred kódom

- Schválenie tohto poradia (alebo úprava priorít).
- Pre Prúd A: potvrdiť hodnotu `appBaseUrl` pre SFZ = `https://app.inventario.estate`?
- Pre Prúd C: voľba úložiska (Vercel Blob / Azure Blob / S3-kompat.).

> Commit + push: na tvoje potvrdenie (git MCP), príp. spravím ja po schválení.
