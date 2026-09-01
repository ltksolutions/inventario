<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0037. Object storage — náhľady v BinData, originály v S3 úložisku tenanta

|                   |                                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | Proposed                                                                                                                                                                                                  |
| **Dátum**         | 2026-09-01                                                                                                                                                                                                |
| **Autori**        | Ján Letko                                                                                                                                                                                                 |
| **Súvisiace ADR** | [0028](0028-per-tenant-branding.md) (logá tenantov, Vercel Blob), [0031](0031-per-tenant-oauth-credentials.md) (per-tenant secrety šifrované v DB), [0021](0021-asset-qr-codes.md) (verejný lost & found) |

## Kontext

Prílohy majetku (fotky, dokumenty) a logá organizácií dnes ležia vo
**Vercel Blobe** (`@vercel/blob`, `BLOB_READ_WRITE_TOKEN`). Pri audite
dokumentácie 2026-09-01 sa ukázali tri problémy, každý overený v kóde
alebo v dokumentácii platformy.

### 1. Prílohy sú verejné

`attachments.routes.ts` ukladá s `access: 'public'` a API vracia klientovi
priamu Blob URL — komentár v mapperi to hovorí otvorene: _„verejná Blob
URL"_. Kto má odkaz, vidí fotku bez prihlásenia a bez kontroly tenanta.
Pri repe, ktorý má `docs/compliance/` s DPIA a whitepaperom, je to
rozpor medzi dokumentáciou a implementáciou.

### 2. Prílohy nie sú v žiadnej zálohe

Atlas snapshot obsahuje metadáta prílohy, ale samotný súbor je v Blobe.
Po obnove zo snapshotu (DR test #1, 2026-05-23) by dokumenty ukazovali na
súbory, ktoré nikto nezálohuje. Vercel Blob zálohovanie ani verzovanie
neposkytuje — overené.

### 3. Limit 20 MB na upload na Verceli nikdy nefungoval

`server.ts` má `limits: { fileSize: 20 * 1024 * 1024 }` a handler hlási
vlastnú chybu „Maximálna veľkosť je 20 MB". Vercel má ale **strop 4,5 MB
na telo requestu aj odpovede** ([dokumentácia limitov][vercel-limits]),
nad ktorý vracia `413 FUNCTION_PAYLOAD_TOO_LARGE` **skôr, než sa request
dostane k funkcii**. Upload 5–20 MB súboru teda v produkcii padal a
používateľ dostal 413 namiesto našej hlášky. Nikto to nenahlásil, lebo
jediná nahraná príloha má 2,23 MB.

### Zmeraný stav (produkcia, 2026-09-01)

|                      |                     |
| -------------------- | ------------------- |
| prílohy              | 1 dokument, 2,23 MB |
| logá organizácií     | 2 (z 3 organizácií) |
| celá DB `inventario` | 4,1 MB              |

Migrácia dát je teda triviálna. Rozhodnutie je o architektúre, nie o
objeme.

### Obmedzenia, ktoré musí riešenie rešpektovať

- **4,5 MB na telo odpovede.** Nič, čo tečie cez našu funkciu, nemôže byť
  väčšie. Streamovanie na tom nič nemení.
- **Logo musí byť čitateľné bez prihlásenia.** `login-context` (ADR-0035)
  a verejný scan (ADR-0021) ho vracajú neautentifikovanému klientovi,
  a `protocols/logo-loader.ts` si ho ťahá po URL pri generovaní PDF.
- **Cold start.** Session 2026-08-31 ušetrila 1,75 s na ceste k dátam.
  Riešenie, ktoré posadí každý obrázok na serverless funkciu bez CDN, tú
  prácu vracia späť.

## Možnosti

### Možnosť A: Nechať Vercel Blob, doriešiť zálohu vlastným cronom

- Plus: najmenej práce.
- Mínus: nerieši verejné URL. Zálohu si píšeme sami. Limit 4,5 MB
  zostáva na uploade.

### Možnosť B: Všetko do Monga — GridFS

- Plus: autorizácia aj záloha vyriešené, žiadny nový dodávateľ.
- Mínus: **strop 4,5 MB zostáva**, lebo súbor tečie cez funkciu. Žiadne
  CDN, invokácia a Atlas read na každý obrázok. Binárky nafúknu DB
  a snapshoty (dnes 4,1 MB; sto fotiek po 3 MB je sedemdesiatnásobok).

### Možnosť C: Všetko do Monga — BinData v dokumente

- Plus: najjednoduchšia implementácia.
- Mínus: všetko z možnosti B **plus** dve vlastné pasce. Base64 nafúkne
  dáta o ~33 % (ak už, tak `BinData`, nikdy nie base64 string). A binárka
  v doméne znamená, že každý výpis, ktorý zabudne `projection`, vlečie
  megabajty — presne ten typ chyby, na ktorom projekt zhorel v session
  2026-08-31. Limit 16 MB na dokument je až druhá prekážka; prvá je
  Vercel so 4,5 MB.

### Možnosť D: Platformové S3-kompatibilné úložisko s podpísanými URL

- Plus: rieši všetko vrátane stropu — upload ide z prehliadača priamo do
  úložiska, funkciu obchádza.
- Mínus: platíme za dáta zákazníkov, pribúda sub-processor pre všetkých
  tenantov naraz, a data residency je naša, nie ich.

### Možnosť E: Hybrid — malé v BinData, originály v S3 úložisku tenanta

Ako D, ale bucket si pripája **tenant** vo svojich nastaveniach, a malé
veci (logo, náhľad) zostávajú v Mongu.

## Rozhodnutie

**Možnosť E.**

| dáta                                               | kde                                  | prístup                                                                         |
| -------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------- |
| logo organizácie (≤512 KB, limit už dnes)          | BinData v Mongu                      | verejný endpoint s `Cache-Control` — login stránka ho potrebuje bez prihlásenia |
| náhľad prílohy (~200–300 KB, dlhšia strana 800 px) | BinData v Mongu                      | po `requireAuth` + tenant checku, priamo z API                                  |
| originál prílohy                                   | S3-kompatibilné úložisko **tenanta** | krátkodobá podpísaná URL, vydaná až po autorizácii                              |

Tenant si v nastaveniach organizácie pripojí vlastný bucket (endpoint,
region, názov bucketu, access key, secret). **Kľúče sa šifrujú v DB
rovnakým vzorom ako per-tenant OAuth secrety podľa ADR-0031** — vlastným
`STORAGE_SECRET_ENCRYPTION_KEY` (princíp najmenšieho oprávnenia: iný kľúč
než OAuth a než MFA), a bez nastaveného kľúča ukladanie prístupových
údajov vracia 503, presne ako to robí ADR-0031.

**Bez pripojeného S3** sa originál uloží do Monga ako BinData, ak má do
**4 MB**. Nad to upload zlyhá s hláškou, ktorá povie, že treba pripojiť
úložisko. Nie je to obmedzenie navyše — je to dnešná realita platformy,
len konečne priznaná. Appka tak funguje aj pre tenanta bez vlastného
úložiska (SFZ dnes žiadne nemá) a S3 je vylepšenie, nie podmienka.

**Podpisovanie**: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`.
SigV4 si nepíšeme sami — je to autentifikačná kryptografia a chyba v nej
je ticho, nie pád. Bundle limit Vercelu je 250 MB, veľkosť SDK teda
nebolí.

**Náhľady**: `@napi-rs/canvas` (Skia), ktorý v `apps/api` už je —
používa ho `qr-image-renderer.ts` a sám rozpoznáva PNG aj JPEG.
Žiadna nová závislosť.

**Upload originálu** ide z prehliadača priamo do bucketu tenanta cez
podpísaný PUT. API pred tým vydá podpis a po dokončení si zapíše
metadáta. Tým sa 4,5 MB strop Vercelu obchádza úplne a limit 20 MB
platí naozaj.

## Dôsledky

### Pozitívne

- Prílohy prestanú byť verejne čitateľné po URL.
- Náhľady a logá sú v Atlas snapshote, teda konečne zálohované.
- Zoznam a detail majetku sa vykreslia z Monga, bez druhého dodávateľa
  a bez podpisovania.
- Data residency originálov je v rukách tenanta — pri verejnej správe
  a školách je to argument, nie komplikácia.
- Náklady na fotky nesie ten, kto ich nahral.
- Limit 20 MB začne platiť.

### Negatívne / kompromisy

- Tenant bez vlastného úložiska má strop 4 MB na súbor.
- Pribúda konfigurácia, ktorú treba vysvetliť v user-guide, a „otestuj
  pripojenie" endpoint, inak to bude podpora naveky.
- Náhľady nafúknu DB — pri 300 KB na prílohu a tisíc prílohách 300 MB.
  Treba to sledovať proti stropu Atlas Flex.
- Dva zdroje pravdy pre jeden súbor (náhľad v DB, originál v buckete);
  mazanie musí zvládnuť oba.

### Riziká, ktoré treba sledovať

- **SSRF.** Tenant zadá endpoint URL, na ktorý potom náš server siaha
  (mazanie, kontrola po uploade). Treba vynútiť `https`, zakázať privátne
  a link-local adresy aj metadata endpointy cloudov. Nie voliteľné.
- **CORS na strane tenanta.** Priamy upload z prehliadača vyžaduje, aby
  jeho bucket povolil náš origin. Bez čitateľnej diagnostiky to bude
  neriešiteľné na diaľku.
- **Právo na výmaz (GDPR čl. 17).** Mazanie musí doraziť do cudzieho
  bucketu. Ak tenant zrotoval kľúče, výmaz tichom zlyhá — treba audit
  a retry, nie best effort.
- **Cachovanie verejného loga.** Endpoint musí mať `Cache-Control`, aby
  login stránka neťahala logo z Atlasu pri každom otvorení. Či Vercel
  cachuje odpovede funkcií na CDN, treba overiť pred implementáciou —
  v dokumentácii limitov je „Cache responses: Yes", ale neoverené.
- **Voľba providera pre tých, čo si vlastný nepripoja**, zostáva otvorená
  (kandidáti: Cloudflare R2 — $0,015/GB-mesiac a egress zadarmo;
  Hetzner alebo Scaleway ako EU firmy). Každý znamená DPA a zápis do
  sub-processorov.

## Referencie

- [Vercel Functions Limits][vercel-limits] — 4,5 MB na telo requestu aj odpovede
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- `docs/sessions/2026-09-01-konvencie-a-runbook.md` — audit, v ktorom sa to našlo
- `docs/sessions/2026-08-31-pomale-nacitanie-dashboardu.md` — prečo nechceme obrázky cez funkciu

[vercel-limits]: https://vercel.com/docs/functions/limitations
