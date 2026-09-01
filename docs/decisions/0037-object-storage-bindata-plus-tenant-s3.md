# 0037. Object storage — náhľady v BinData, originály v private Blob storu

|                   |                                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | Accepted                                                                                                                                                                                                  |
| **Dátum**         | 2026-09-01                                                                                                                                                                                                |
| **Autori**        | Ján Letko                                                                                                                                                                                                 |
| **Súvisiace ADR** | [0028](0028-per-tenant-branding.md) (logá tenantov, Vercel Blob), [0031](0031-per-tenant-oauth-credentials.md) (per-tenant secrety šifrované v DB), [0021](0021-asset-qr-codes.md) (verejný lost & found) |

> **Poznámka k verzii.** Prvý návrh tohto ADR (rovnaký deň) staval na tom,
> že Vercel Blob nedokáže súbory chrániť autentifikáciou, a preto navrhoval
> per-tenant S3 úložisko s vlastným SigV4 podpisovaním. **Táto premisa už
> neplatí** — Vercel Blob má medzitým **private stores** (GA) aj
> **podpísané URL** pre GET a PUT. ADR je preto prepísaný ešte pred
> schválením; pôvodná verzia je v git histórii.

## Kontext

Prílohy majetku (fotky, dokumenty) a logá organizácií dnes ležia
v **public** Vercel Blob store (`@vercel/blob`, `access: 'public'`). Audit
2026-09-01 našiel tri problémy, každý overený v kóde alebo v dokumentácii
platformy.

### 1. Prílohy sú verejne čitateľné

`attachments.routes.ts` ukladá s `access: 'public'` a API vracia klientovi
priamu Blob URL — komentár v mapperi to hovorí otvorene: _„verejná Blob
URL"_. Kto má odkaz, vidí fotku bez prihlásenia a bez kontroly tenanta.
Repo má pritom `docs/compliance/` s DPIA a security whitepaperom.

### 2. Prílohy nie sú v žiadnej zálohe

Atlas snapshot obsahuje metadáta prílohy, ale samotný súbor je v Blobe.
Po obnove zo snapshotu (DR test #1, 2026-05-23) by dokumenty ukazovali na
súbory, ktoré nikto nezálohuje. **Vercel Blob neposkytuje zálohovanie ani
verzovanie** — overené.

### 3. Limit 20 MB na upload nikdy nefungoval

Vercel stráži **4,5 MB na telo requestu aj odpovede** ([limity][limits])
a request nad limit zahodí s `413 FUNCTION_PAYLOAD_TOO_LARGE` **skôr, než
sa dostane k funkcii**. Overené na produkcii: 6 MB → 413, 1 KB → 401.
Opravené samostatne (limit na 4 MB, commit `2afa929`), ale správne
riešenie je upload, ktorý funkciu obchádza.

### Zmeraný stav (produkcia, 2026-09-01)

| položka              | hodnota             |
| -------------------- | ------------------- |
| prílohy              | 1 dokument, 2,23 MB |
| logá organizácií     | 2 (z 3 organizácií) |
| celá DB `inventario` | 4,1 MB              |

Migrácia dát je teda triviálna. Rozhodnutie je o architektúre.

### Čo platforma naozaj umožňuje (overené v dokumentácii)

- **Private Blob stores** sú GA. Vyžadujú autentifikáciu na každé čítanie
  aj zápis, URL má tvar `<store-id>.private.blob.vercel-storage.com` a nie
  je verejne dostupná. Potrebujú `@vercel/blob` >= 2.3 — **repo má
  `^2.8.0`, takže žiadna nová závislosť.**
- **Podpísané URL** fungujú pre GET aj PUT, expirácia až 7 dní, a
  **prehliadač ich vie použiť priamo** (aj v `<img src>`), bez funkcie
  v ceste. Každá URL je zúžená na jednu operáciu, jeden pathname a jednu
  expiráciu; GET-podpis sa nedá použiť ako PUT.
- **Client uploads** idú z prehliadača priamo do storu a **nemajú
  data-transfer poplatky**.
- Vercel **výslovne odporúča neCDN-cachovať** odpovede s privátnym
  obsahom (`s-maxage`) a overovať autorizáciu priamo v handleri pri
  `get()`, nie v middleware. Pre privátny obsah radí
  `Cache-Control: private, no-cache` a `ETag`/`If-None-Match`, čo dáva
  efektívne `304`.
- Odpovede funkcií **sa dajú** CDN-cachovať, ale len keď request nemá
  hlavičku `Authorization`, je to `GET`/`HEAD`, odpoveď má 200 a do 10 MB
  a nemá `set-cookie`. To sedí na verejné logo, nie na prílohy.

### Obmedzenia, ktoré musí riešenie rešpektovať

- **Logo musí byť čitateľné bez prihlásenia** — `login-context` (ADR-0035)
  aj verejný scan (ADR-0021) ho vracajú neautentifikovanému klientovi
  a `protocols/logo-loader.ts` si ho ťahá po URL pri generovaní PDF.
- **Cold start.** Session 2026-08-31 ušetrila 1,75 s na ceste k dátam.
  Riešenie, ktoré posadí každý obrázok na serverless funkciu bez cache,
  tú prácu vracia späť.

## Možnosti

### Možnosť A: Nechať public Blob, doriešiť len zálohu

- Plus: najmenej práce.
- Mínus: nerieši verejné URL.

### Možnosť B: Všetko do Monga (GridFS alebo BinData)

- Plus: autorizácia aj záloha vyriešené, žiadny externý storage.
- Mínus: **strop 4,5 MB zostáva**, lebo súbor tečie cez funkciu. Žiadna
  CDN, invokácia a Atlas read na každý obrázok. Binárky nafúknu DB
  a snapshoty (dnes 4,1 MB; sto fotiek po 3 MB je sedemdesiatnásobok).
  Pri BinData navyše platí, že binárka v doméne vlečie megabajty v každom
  výpise, ktorý zabudne `projection` — presne ten typ chyby, na ktorom
  projekt zhorel v session 2026-08-31. (Base64 by nafúklo dáta o ~33 %;
  ak už do dokumentu, tak `BinData`.)

### Možnosť C: Per-tenant S3 úložisko s vlastným SigV4

Pôvodný návrh tohto ADR.

- Plus: data residency a záloha v rukách tenanta.
- Mínus: rieši autorizáciu, ktorú platforma teraz dáva zadarmo, za cenu
  SSRF plochy (tenant zadáva endpoint, na ktorý siaha náš server), CORS
  na jeho strane, výmazu do cudzieho bucketu a novej závislosti na
  `@aws-sdk`. Neúmerná cena za problém, ktorý už riešiť netreba.

### Možnosť D: Private Blob store + podpísané URL, malé veci v BinData

## Rozhodnutie

**Možnosť D.**

| dáta                                               | kde                    | ako sa doručí                                                                                           |
| -------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| logo organizácie (≤512 KB, limit už dnes)          | BinData v Mongu        | verejný endpoint s `Cache-Control: s-maxage` — CDN ho cachuje, login stránka ho vidí bez prihlásenia    |
| náhľad prílohy (dlhšia strana 800 px, ~200–300 KB) | BinData v Mongu        | po `requireAuth` + tenant checku priamo z API, `private, no-cache` + `ETag`                             |
| originál prílohy                                   | **private** Blob store | upload z prehliadača podpísaným PUT; download krátkodobou podpísanou GET URL, vydanou až po autorizácii |

Konkrétne:

- **Upload** originálu ide z prehliadača **priamo do storu** podpísaným
  PUT. API pred tým overí oprávnenie a vydá podpis, po dokončení si zapíše
  metadáta a vygeneruje náhľad. Tým sa 4,5 MB strop obchádza úplne a limit
  na veľkosť súboru je zase náš, nie platformy.
- **Download** originálu: API overí `requireAuth`, tenant a rolu, potom
  vydá **podpísanú GET URL s krátkou expiráciou** (návrh 15 minút).
  Prehliadač si súbor stiahne priamo zo storu — žiadna funkcia v ceste,
  žiadny 4,5 MB strop, žiadny Fast Data Transfer za prietok cez funkciu.
- **Náhľady a logá** generuje `@napi-rs/canvas` (Skia), ktorý v `apps/api`
  už je — používa ho `qr-image-renderer.ts` a sám rozpoznáva PNG aj JPEG.
  Žiadna nová závislosť.
- **Per-tenant S3** sa neimplementuje. Zostáva ako možné rozšírenie, ak
  niektorý tenant bude vyžadovať data residency vo vlastnej infrastruktúre;
  vtedy sa vráti aj vzor per-tenant secretov podľa ADR-0031.

### Prečo náhľad v Mongu a nie tiež v Blobe

Kvôli zálohe. Blob nemá verzovanie ani snapshoty, takže po obnove Atlasu
by originály chýbali. Náhľad v BinData znamená, že **DB snapshot vždy nesie
degradovanú kópiu každej prílohy** — evidencia majetku po obnove nie je
prázdna, len má menšie obrázky. Je to lacná poistka (300 KB na prílohu),
ktorá zároveň zrýchli zoznam a detail majetku.

Plná záloha originálov je **samostatné rozhodnutie**, nie súčasť tohto ADR
— viď „Zostáva otvorené".

## Dôsledky

### Pozitívne

- Prílohy prestanú byť verejne čitateľné po URL. Autorizácia sa overuje
  v handleri, ktorý URL vydáva.
- Náhľady a logá sú v Atlas snapshote, teda zálohované.
- Limit na veľkosť súboru prestane byť limitom platformy — upload ani
  download netečie cez funkciu.
- Zoznam a detail majetku sa vykreslia z Monga, bez podpisovania a bez
  druhého round-tripu.
- Žiadna nová závislosť a žiadny nový dodávateľ, teda ani DPA a ani zápis
  do sub-processorov.
- Verejné logo sa cachuje na CDN, takže login stránka nečaká na Atlas.

### Negatívne / kompromisy

- **Podpísaná URL je prenosná.** Kto ju do expirácie získa, súbor vidí.
  Je to slabšie než kontrola na každý request, ale výrazne lepšie než
  dnešná trvalá verejná URL. Preto krátka expirácia a žiadne logovanie
  celých URL.
- Náhľady nafúknu DB — pri 300 KB a tisíc prílohách 300 MB. Treba to
  sledovať proti stropu Atlas Flex.
- Dva zdroje pravdy pre jeden súbor (náhľad v DB, originál v store);
  mazanie a GDPR výmaz musia zvládnuť oba.
- Existujúce dáta (1 príloha, 2 logá) treba presunúť z public storu.

### Riziká, ktoré treba sledovať

- **Autorizáciu overovať v handleri pri vydávaní podpisu**, nie
  v middleware — Vercel to výslovne odporúča a dôvod je, že chyba
  v middleware odhalí privátny obsah.
- **Verejný logo endpoint nesmie tiecť nič okrem loga.** Je bez
  autentifikácie a CDN-cachovaný, takže akákoľvek chyba v tenant scope je
  cachovaná chyba.
- **Náhľad sa nesmie dostať do výpisov.** Každý dotaz, ktorý číta
  `attachments` bez `projection`, potiahne binárku. Chce to explicitný
  projection a test, ktorý to stráži.
- **Mazanie v private store** po soft-delete prílohy a po výmaze podľa
  GDPR čl. 17.

## Zostáva otvorené

- **Plná záloha originálov.** Náhľad v DB je degradovaná poistka, nie
  záloha. Možnosti: mesačný cron, ktorý zrkadlí private store inam
  (infrastruktúra pre cron už existuje — retencia), alebo zmierenie sa
  s tým, že originály sú jediná kópia. Rozhodnúť samostatne.
- **Expirácia podpísanej URL** — návrh 15 minút, treba overiť na reálnom
  používaní (galéria s viacerými fotkami, pomalé pripojenie).
- **Náklady.** Private store sa účtuje ako Blob Data Transfer + Fast
  Origin Transfer pri čítaní cez funkciu; pri podpísanej URL ide prietok
  mimo funkcie. Presné čísla pri reálnom objeme neprepočítané.

## Referencie

- [Vercel Functions Limits][limits] — 4,5 MB na telo requestu aj odpovede
- [Vercel Blob — Private Storage](https://vercel.com/docs/vercel-blob/private-storage)
- [Vercel Blob — signed URLs](https://vercel.com/changelog/signed-urls-are-now-available-for-vercel-blob)
- [Vercel CDN Cache](https://vercel.com/docs/caching/cdn-cache) — kritériá cachovateľnosti
- `docs/sessions/2026-09-01-sfz-naming-a-limit-uploadu.md` — oprava limitu
- `docs/sessions/2026-08-31-pomale-nacitanie-dashboardu.md` — prečo nechceme obrázky cez funkciu

[limits]: https://vercel.com/docs/functions/limitations
