<!--
SPDX-FileCopyrightText: 2026 LTK Solutions, s.r.o.
SPDX-License-Identifier: CC-BY-4.0
-->

# Data Retention Schedule — Inventario

> **Účel.** Detailný per-category retenčný plán pre osobné údaje spracúvané platformou Inventario. Rozširuje sumár v [`gdpr-article-30.md`](./gdpr-article-30.md) (ROPA, sekcia 6) o konkrétne lehoty, právny základ a mechanizmus výmazu/pseudonymizácie pre každú dátovú kategóriu.
>
> ⚠️ **Disclaimer**: Technicko-právny dokument pripravený podľa GDPR a slovenského zákona č. 18/2018 Z. z. Pred použitím s reálnym zákazníkom má byť pripomienkovaný advokátom.

| Pole                   | Hodnota                                                  |
| ---------------------- | -------------------------------------------------------- |
| **Verzia**             | 1.0                                                      |
| **Účinné od**          | 2026-06-11                                               |
| **Správca**            | LTK Solutions, s.r.o. (sprostredkovateľ pre tenant data) |
| **Kontakt**            | privacy@inventario.estate                                |
| **Zdroj pravdy (kód)** | `apps/api/src/modules/audit/retention.service.ts`        |

---

## 1. Princípy

1. **Minimalizácia (čl. 5 ods. 1 písm. c GDPR)** — uchovávame len údaje nevyhnutné pre účel a po nevyhnutný čas.
2. **Obmedzenie uchovávania (čl. 5 ods. 1 písm. e)** — po uplynutí lehoty sa údaje pseudonymizujú alebo mažú automaticky.
3. **Pseudonymizácia namiesto mazania pri audit logu** — forenzná stopa (kto-čo-kedy bez priamej identifikácie) je zákonná povinnosť (čl. 5 ods. 2 — accountability), preto sa audit záznamy nikdy nemažú, len sa z nich odstránia priame identifikátory.
4. **Tenant ako prevádzkovateľ** — konkrétne lehoty pre tenant data určuje tenant; nižšie uvedené sú **default lehoty platformy**, ktoré tenant môže zmluvne sprísniť.

Lehoty sa počítajú s **30-dňovým mesiacom** (`MS_PER_MONTH` v `retention.service.ts`).

---

## 2. Retenčný plán podľa kategórie

### 2.1 Audit log (append-only)

Audit log sa **nikdy nemaže**. Po uplynutí lehoty retenčný job pseudonymizuje aktéra: `actor.userId → "PSEUDONYMIZED"`, vymaže `actor.displayName`, `actor.ipAddress`, `actor.userAgent` a nastaví `pseudonymizedAt`. Zachované ostávajú: `action`, `at`, `target`, `changes`, `severity`, `legalBasis`, `dataCategories`.

| Bucket                           | Lehota                 | Akcie (príklady)                                                                                                                                                                                                                                                                                          | Právny základ                                               |
| -------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **CRUD / business**              | **24 mesiacov**        | `ASSET_*` (vrátane `ASSET_ATTACHMENT_*`), `CATEGORY_*`, `LOCATION_*`, `LOAN_*` (vrátane `LOAN_PROTOCOL_CREATED/SIGNED`), `STOCK_*`, `USER_CREATED/UPDATED/DEACTIVATED/REACTIVATED/ROLE_*`, `MEMBERSHIP_*`, `ORGANISATION_UPDATED`, `BULK_IMPORT_EXECUTED`, `SYSTEM_CONFIG_CHANGED`, `INTEGRATION_TOKEN_*` | čl. 6 ods. 1 písm. b/f + čl. 5 ods. 2                       |
| **Auth / security / GDPR práva** | **60 mesiacov (5 r.)** | `USER_LOGIN(_FAILED)`, `USER_LOGOUT`, `USER_PASSWORD_*`, `USER_MFA_*`, `PASSKEY_*`, `DATA_EXPORT_REQUESTED`, `DATA_DELETION_REQUESTED`, `USER_PSEUDONYMIZED`, `USER_RESTRICTED/UNRESTRICTED`                                                                                                              | čl. 6 ods. 1 písm. c/f (prevencia podvodov, accountability) |
| **Organisation lifecycle**       | **84 mesiacov (7 r.)** | `ORGANISATION_CREATED`, `ORGANISATION_DELETED`                                                                                                                                                                                                                                                            | čl. 6 ods. 1 písm. b/c                                      |

> Pozn.: `ORGANISATION_UPDATED` patrí do CRUD bucketu (24 m), nie do lifecycle (84 m) — viď zoznam `CRUD_ACTIONS` v kóde.

### 2.2 Používateľské účty (`users`)

| Stav                                              | Lehota                         | Mechanizmus                                                          |
| ------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| Aktívny účet                                      | Trvanie zmluvy tenant-a        | —                                                                    |
| Soft-deleted (`deletedAt` nastavené)              | **24 mesiacov od `deletedAt`** | Pseudonymizácia (`USER_PSEUDONYMIZED`) — safety-net job              |
| Self-service výmaz (čl. 17, `DELETE /v1/auth/me`) | **Okamžite**                   | Okamžitá pseudonymizácia User + soft-delete memberships v transakcii |

Citlivé polia (`passwordHash`, `mfaSecret`, `mfaRecoveryCodes`) sú vždy vylúčené z API odpovedí (repository projekcia).

### 2.3 Pozvánky (`invitations`)

| Položka                                     | Lehota                           |
| ------------------------------------------- | -------------------------------- |
| Platnosť pozývacieho tokenu                 | **7 dní** (TTL)                  |
| Dokument pozvánky (po expirácii/akceptácii) | 24 mesiacov (štatistika + audit) |

### 2.4 Evidenčné dáta tenant-a

| Kategória                                          | Aktívne           | Po soft-delete / ukončení | Mechanizmus                                                                                                                                                        |
| -------------------------------------------------- | ----------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Organisations                                      | trvanie zmluvy    | **60 mesiacov**           | Anonymizácia so zachovaním agregovaných štatistík                                                                                                                  |
| Assets (majetok)                                   | životnosť záznamu | **60 mesiacov**           | Hard delete                                                                                                                                                        |
| Loans (výpožičky, ukončené)                        | —                 | **60 mesiacov**           | Hard delete                                                                                                                                                        |
| Loan protocols (HANDOVER/RETURN + PDF)             | —                 | **60 mesiacov**           | Hard delete vrátane vyrenderovaného PDF; PDF sa štandardne negeneruje a neukladá (on-demand render)                                                                |
| Prílohy majetku (foto/doklady, private Blob store) | životnosť majetku | viazané na majetok        | Soft-delete metadát + best-effort `del()` objektu; audit cez `ASSET_ATTACHMENT_*` (CRUD 24 m). EXIF/XMP sa strháva pri spracovaní uploadu — viď obmedzenie v 2.4.1 |

#### 2.4.1 Osirelé objekty v úložisku

Príloha vzniká v dvoch krokoch: prehliadač nahrá súbor podpísaným PUT-om
priamo do private storu, a až následné volanie `confirm` obsah overí,
**strhne EXIF/XMP** a založí záznam v evidencii. Keď druhý krok nedobehne
(zavretá karta, stratené pripojenie), v store zostane objekt, na ktorý
neukazuje žiadny záznam — **osirelý objekt**.

Taký objekt je mimo evidencie, takže sa naň nevzťahuje soft-delete ani
`del()` z tabuľky vyššie, nefiguruje v žiadnom výpise a pri žiadosti podľa
čl. 15 alebo 17 by ho nikto nenašiel. A keďže `confirm` nedobehol, **drží
pôvodné EXIF vrátane GPS súradníc**.

| Mechanizmus                                                     | Lehota                                  | Poznámka                                                                         |
| --------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------- |
| `POST /v1/system/storage/orphans/purge` (denný cron, 04:00 UTC) | objekty starší než **24 h** bez záznamu | Odklad 24 h je rezerva proti prebiehajúcemu `confirm`, ktorý reálne beží sekundy |
| `GET /v1/system/storage/orphans`                                | —                                       | Iba výpis, nemaže. Na kontrolu pred zásahom                                      |

**Zostatkové riziko, ktoré sa nedá odstrániť:** okno medzi PUT-om
a zmazaním sa dá len skrátiť, nie zrušiť. Strhnutie EXIF na strane
prehliadača by bolo nespoľahlivé a klientovi sa v tomto veriť nedá, takže
prvý zápis do storu je vždy s pôvodnými metadátami. S 24-hodinovým
odkladom a denným cronom je horná hranica existencie takého objektu
**~2 dni**. Rozhodnutie a zvažované alternatívy sú v
[ADR-0039](../decisions/0039-orphaned-storage-objects.md).

Čistič zároveň dobehne **zlyhané best-effort mazania** — objekt
soft-zmazanej prílohy sa za referencovaný nepovažuje.

### 2.5 Logy a zálohy infraštruktúry

| Zdroj                                                         | Lehota     |
| ------------------------------------------------------------- | ---------- |
| MongoDB Atlas backups (denný snapshot + oplog, point-in-time) | **90 dní** |
| Vercel access/function logs                                   | **7 dní**  |
| Ecomail delivery logs (transakčné e-maily)                    | **30 dní** |

---

## 3. Zákonné lehoty mimo platformy (LTK ako prevádzkovateľ)

Pre vlastné business operations LTK Solutions (nie tenant data) platia zákonné lehoty SR — uvedené v [`gdpr-article-30-controller.md`](./gdpr-article-30-controller.md):

| Kategória                 | Lehota                  | Predpis                  |
| ------------------------- | ----------------------- | ------------------------ |
| Účtovné doklady / faktúry | **10 rokov**            | zák. 431/2002 Z. z., §35 |
| Mzdové listy              | 10 rokov                | zák. 461/2003 Z. z.      |
| Osobný spis zamestnanca   | 10 rokov po skončení PP | zák. 311/2001 Z. z.      |
| BOZP dokumentácia         | 5 rokov                 | —                        |

---

## 4. Automatizácia a dohľad

- **Retenčný job** (`RetentionService.run()`) beží mesačne cez Vercel Cron (`vercel.json`: `0 3 1 * *`), chránený `CRON_SECRET`. Kroky sú sekvenčné a **idempotentné** (opakované spustenie je bezpečné).
- Job spracúva 3 audit buckety + soft-deleted users; vracia `RetentionRunResult` s počtami pseudonymizovaných záznamov.
- **Overenie:** unit testy `retention.test.ts` + integračné `retention-cron.test.ts`.

---

## 5. Práva dotknutých osôb (skrátene)

Retencia nemá prednosť pred právami podľa GDPR — dotknutá osoba môže kedykoľvek uplatniť právo na prístup (`GET /v1/me/export`, čl. 20), opravu (`PATCH /v1/me`, čl. 16), výmaz (`DELETE /v1/auth/me`, čl. 17) a obmedzenie (čl. 18). Detail v [`legal/privacy-policy.md`](./legal/privacy-policy.md).

---

## Zmenová história

| Verzia | Dátum      | Zmena                                                                      |
| ------ | ---------- | -------------------------------------------------------------------------- |
| 1.0    | 2026-06-11 | Prvá verzia — extrakcia per-category plánu z ROPA + `retention.service.ts` |

## Referencie

- [`gdpr-article-30.md`](./gdpr-article-30.md) — ROPA (processor view), sekcia 6
- [`gdpr-article-30-controller.md`](./gdpr-article-30-controller.md) — ROPA (controller view)
- `apps/api/src/modules/audit/retention.service.ts` — implementácia
