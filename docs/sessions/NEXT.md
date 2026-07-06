# NEXT

## Aktuálny stav (2026-07-07, pokračovanie) — číselník Tagov + Audit log (rozrobené)

Session log: `docs/sessions/2026-07-07-tagy-ciselnik-audit-log.md`. Commity:
`17ce25e` (Tagy backend), `7b76b2bf` (Tagy frontend).

- ✅ **Číselník "Tagy" — HOTOVÝ a nasadený.** Nová záložka v Číselníky:
  zoznam tagov s počtom použití, premenovanie (server zlúči duplicity),
  mazanie zo všetkého majetku. RBAC výnimka: mazanie tu ASSET_MANAGER+ADMIN
  (nie len ADMIN ako pri Kategóriách/Lokalitách).
- ⏳ **Audit log pre správcov — rozrobené, ešte nezačaté kódovo** (tasky
  #56-59). RBAC potvrdené: ADMIN aj ASSET_MANAGER, scoped na aktívny tenant.
  Filtre: akcia + entita + osoba + dátum, bez voľného textu, len prehľadávanie
  (žiadny export zatiaľ).

## Aktuálny stav (2026-07-07) — zvyšné UI/UX drobnosti + SelectField fix

Session log (dodatky): `docs/sessions/2026-07-06-ui-buttons-tagy-freetext.md`.
Commity: `ea55833`, `a353a14`, `4a37f78`, `3412882`, `2fce826`.

- ✅ `/my-loans` "Detail" a `/protocols` "Výpožička" prerobené na tlačidlá (dokončenie
  UI/UX zjednotenia z predošlej session).
- ✅ Stav protokolu "Návrh — čaká na podpisy" skrátený na "Podpísať".
- ✅ LoadingOverlay: preloader obalený kartou s pozadím, čitateľnejší nad rušným obsahom.
- ✅ Asset detail "Popis a tagy": opravený padding bug (`divide-y` bez `px-5 py-3` na
  ad-hoc elementoch) — nešlo o dáta/paste problém, len chýbajúci CSS padding.
- ✅ Natívny `<select>` → `SelectField` v `LocationCreateDialog.tsx` (Typ lokality,
  Nadradená lokalita) a `CategoryCreateDialog.tsx` (Root kategória) — v rozpore s
  ADR-0018, teraz zjednotené s `AssetCreateContent.tsx` vzorom.
- ✅ **Dodatočne zistené:** fix vyššie sa netýkal reálne používanej komponenty na
  `/ciselniky` — Lokality tab tam má vlastnú lokálnu `LocationDialog` v
  `CiselnikyContent.tsx` s vlastným natívnym selectom (Kategórie tam už
  správne používali zdieľanú `CategoryCreateDialog`). Opravené zvlášť
  (commit `41ec214`), potvrdené Janikou naživo.

## Aktuálny stav (2026-07-06, neskorý večer) — UI/UX tlačidlá, veľké písmená tagov, normalizácia voľného textu

Session log: `docs/sessions/2026-07-06-ui-buttons-tagy-freetext.md`.
Commity: `09c2b22` (tlačidlá + zobrazenie tagov), `b9661d5` (normalizácia
voľného textu + backfill).

- ✅ Detail/Výpožička odkazy v Žiadostiach, `/persons` a na domovskej stránke
  ("Čaká na vás") zjednotené na tlačidlá s ikonkou (rovnaký štýl ako "Vydať").
- ✅ Tagy: veľké prvé písmeno len pri zobrazení (`displayTag()`), DB ostáva lowercase.
- ✅ Nová `freeText()` normalizácia (NBSP, CRLF, trailing whitespace, 3+ prázdne
  riadky) na všetkých voľných textových poliach (Popis, Účel, Poznámka, Dôvod
  zamietnutia...) + deploy-time migrácia na backfill existujúcich dát.
- ⏳ Otvorené: "Výpožička" odkaz na `/assets` — nenašiel sa v kóde, čaká sa na
  upresnenie od Janiky.

## Aktuálny stav (2026-07-06, večer, ďalšie pokračovanie) — Tagy: normalizácia + autocomplete

Session log: `docs/sessions/2026-07-06-tagy-autocomplete.md`. Commit `d3aee39`.

- ✅ Nová `TagSchema` (shared-types): server VŽDY normalizuje tag na
  trim + zbalené medzery + malé písmená (predtým len kozmeticky v
  jednom UI). Viacslovné tagy s medzerou zostávajú povolené.
- ✅ Nový `GET /v1/assets/tags` — unikátne existujúce tagy tenanta
  (Mongo `distinct`, žiadna nová kolekcia netreba).
- ✅ `TagsCombobox` mal už pripravenú `suggestions` prop, ale nikde sa
  nepoužívala — teraz zapojená (autocomplete pri písaní, možnosť
  pridať aj nový tag zostáva).
- Nasadené, runtime chyby čisté.

## Aktuálny stav (2026-07-06, večer, dodatok) — ignoreCommand vo vercel.json

Root cause opakovaného pomalého `/assets`: môj vlastný docs-only
"poupratuj" commit vyvolal nové produkčné nasadenie API aj webu (Vercel
defaultne redeployuje na každý push na `main`), čo zhodilo teplé
serverless inštancie presne v momente, keď si Janika otvorila appku.

Fix: `ignoreCommand` (`apps/api/vercel.json`, `apps/web/vercel.json`) —
commity meniace výhradne `docs/**` už nevyvolajú redeploy. Commit
`9b77d6c`, nasadené, runtime chyby čisté. Detail:
`docs/sessions/2026-07-06-assets-perf-form-focus.md`.

## Aktuálny stav (2026-07-06, večer, pokračovanie) — perf `/assets` + autoscroll/focus

Session log: `docs/sessions/2026-07-06-assets-perf-form-focus.md`.
Commity: `e9b3061` (perf `/assets`), `1e18cde` (autoscroll+focus).

- ✅ **`/assets` zoznam rýchlejší:** odstránený extra `useLoans({status:'ACTIVE', limit:500})`
  dopyt aj s ním súvisiaci stĺpec "kto má vypožičané" a filter "Vypožičané kým"
  (na žiadosť Janiky, plné odstránenie namiesto čiastočného).
- ✅ **Autoscroll + focus na prvé chybné pole** vo formulároch Pridanie majetku
  (`/assets/new`) a Editácia majetku — pri chýbajúcom povinnom poli mimo
  viditeľnej plochy appka teraz odroluje a fokusne problémové pole. Nová
  zdieľaná utilita `apps/web/src/lib/form-scroll.ts` (funguje aj pre
  Controller-obalené custom komponenty, kde RHF `setFocus` zlyháva).
  Zámerne postavené ako znovupoužiteľné pre ostatné formuláre (zatiaľ
  neaplikované na Kategórie/Lokality dialógy ani žiadosť o výpožičku —
  Janika to pre toto kolo nevybrala).
- Oba nasadené, `get_runtime_errors` čisté.

## Aktuálny stav (2026-07-06, večer) — modul "Osoby"

**Nový modul "Osoby" (osobná karta majetku) — HOTOVÝ a nasadený.**
Session log: `docs/sessions/2026-07-06-osoby-modul.md`. Commit: `15f3712`.

- ✅ Nová stránka `/persons` (zoznam) + `/persons/:id` ("osobná karta
  majetku") pre role Správca majetku a Administrátor. Karta zobrazuje
  aktuálny majetok VŽDY PRVÝ, potom čakajúce žiadosti, potom históriu
  (vrátené/poškodené/stratené).
- ✅ Nové RBAC endpointy `GET /v1/users/directory` + `/:id`
  (ASSET_MANAGER+ADMIN, minimálny profil — oddelené od plného
  admin-only `GET /v1/users`).
- ✅ `GET /v1/loan-requests` rozšírené o `beneficiaryId` filter
  (requester-OR-beneficiary union, ADR-0023).
- ⚠️ **Incident:** stale `.git/index.lock` z diagnostického bash `git
status` zablokoval commit — git MCP tool je bezpečnejšia cesta pre
  git operácie na tomto repe než bash sandbox.

## Aktuálny stav (2026-07-06, ráno)

**Cold-start perf fix + incident recovery + preloader zjednotenie — HOTOVÉ a nasadené.**
Session log: `docs/sessions/2026-07-06-migrations-perf-bad-auth-preloader.md`.
Commity: `00a2515` (migrácie mimo request path), `e98c2373` (preloadery).

- ✅ **Root cause pomalého štartu appky (~20-30s):** migrácie bežali na KAŽDOM
  cold starte `inventario-api` (14+ sekvenčných `findOne` dopytov). Fix:
  `checkPendingMigrations()` (1 dotaz, len warning log) na cold starte;
  reálne migrácie teraz bežia cez nový `POST /v1/system/migrations/run`
  (chránený `MIGRATIONS_SECRET`), spúšťaný automaticky GitHub Actions
  workflow-om (`.github/workflows/migrate-on-deploy.yml`) po úspešnom
  produkčnom deployi.
- ⚠️ **Incident počas nasadenia:** celá prod API spadla na 500 po nastavení
  `MIGRATIONS_SECRET` — nie zlá hodnota (mala 64 znakov), ale **Vercel
  aplikuje env zmeny len na nový deployment**; bežiace funkcie mali zapečenú
  staršiu nevalidnú hodnotu. Fix: ešte jeden Redeploy po uložení. Overené
  (401 namiesto 500/503 na chránených endpointoch, `get_runtime_errors`
  bez nových chýb). **Opakované poučenie** — rovnaký vzorec ako minulý
  `EMAIL_PROVIDER` incident.
- 🔶 **Bad auth (Mongo) na Preview deploymentoch:** diagnostikované (zlý
  `MONGO_URI` na Preview) — Janika nastavila Production→`inventario-prod`,
  Preview→`inventario-dev`. **Nepotvrdené na živom Preview deploymente**,
  čaká sa na ďalší dependabot PR / push mimo main.
- ✅ **Preloadery zjednotené:** `RouteProgressBar` (tenký pruh pod hlavičkou,
  nikto si ho nevšímal) → premenovaný na `GlobalFetchOverlay`, teraz
  vykresľuje novú `LoadingOverlay` (spinner + Inventario logo, vystredený
  fixný overlay). `AuthGate` používa tú istú komponentu. Vedomý trade-off:
  prekrýva aj background refetch (predtým to `RouteProgressBar` zámerne
  neriešil) — Janika zvolila jednotnosť/viditeľnosť.

**Otvorené:** potvrdiť bad auth fix na najbližšom Preview deploymente;
overiť že `migrate-on-deploy.yml` sa spustí pri najbližšom prod deployi;
`.claude-fs-probe.tmp` v koreni repa čaká na manuálne zmazanie Janikom
(sandbox `rm`/`mv`/`os.remove` blokované na úrovni mountu); zvážiť pinnutie
Vercel function regiónu bližšie k MongoDB Atlas regiónu (pozorované
`iad1`/`sfo1`/`fra1`).

---

## Aktuálny stav (2026-07-01)

**Custom `DateField` (fix orezaného kalendára) — HOTOVÉ a nasadené.** Session log:
`docs/sessions/2026-07-01-datefield-custom-picker.md`. Commit: `f481e58`.

- ✅ Nahlásený bug: natívny `<input type="date">` sa pri dlhšom formulári žiadosti
  otváral mimo viditeľnú oblasť (prekrytý tlačidlom/oknom). Nový vlastný
  `DateField.tsx` (bez novej závislosti) — `createPortal` + `position: fixed`,
  flip nahor/nadol podľa priestoru. Nasadené vo všetkých 4 miestach s natívnym
  date inputom (žiadosť, fulfil žiadosti, nový/edit majetok). Detail: ADR-0033.
- ❌ Popri tom zvážená a **zamietnutá** možnosť žiadať o výpožičku pre osobu, ktorá
  ešte nie je v systéme (nový zamestnanec) — beneficiary musí zostať existujúci
  `User`, bez výnimky. Zdokumentované ako zamietnutý ADR-0032 (referencia do
  budúcnosti, neimplementované).
- ℹ️ Commit + push tentokrát cez `Control your Mac` (osascript, Terminal na
  reálnom Macu) na Jánovu žiadosť — zmena oproti zvyčajnému git MCP postupu.

**Otvorené:** klávesnicová navigácia šípkami v `DateField` mriežke (fast-follow);
a11y audit `DateField`; živé odskúšanie flip-up v prehliadači.

---

## Aktuálny stav (2026-06-23)

**Séria Cowork opráv/vylepšení — HOTOVÉ a nasadené.** Session log:
`docs/sessions/2026-06-23-edit-user-fix-dashboard-perf-category-picker.md`. Commity:
`d084f0a`, `e55525a`, `7c7e376`, `14cf535`, `b78619d`, `26b1778`, `1e45370`, `11fed64`,
`3b0448b`, `6f30954`.

- ✅ Edit používateľa padal na 404 pre cross-tenant členov — `getById`/`update` (PATCH)
  prepnuté na membership-gated prístup + `findByIdUnscoped`/`updateByIdUnscoped`; modal
  zobrazuje chybu namiesto večného shimmeru
- ✅ Zdieľaný `Spinner`/`LoadingState` (`Spinner.tsx`) + nasadený do edit modalu a 7
  ďalších blokových loaderov
- ✅ Dashboard perf: 1 request namiesto ~10 — `GET /v1/dashboard/summary` (reuse RBAC),
  `useDashboardSummary`, indexy `{organisationId, deletedAt}`, `useMe`→`useAuth().user`
- ✅ Pre-commit hook auto-regeneruje `apps/api/openapi.json` pri zmene `apps/api/src/`
- ✅ Žiadosť: viditeľný popis príjemcu („Pre koho žiadate")
- ✅ Zoskupený autocomplete výber kategórie (`Combobox` + `groupOf`/`visibleLimit` +
  zdieľaný `buildGroupedCategoryOptions`) v žiadosti, pridaní **aj** edit formulári majetku
- ✅ `clearMfa`/`setRestriction` prepnuté na membership-gated prístup (cross-tenant 404 fix)
  — `clearMfaByIdUnscoped`/`setRestrictionByIdUnscoped` + privátny `loadTenantMember`
  (`2d55554`, `0c00469`)
- ✅ Zlúčené „Členovia" → „Používatelia": stránka `/settings/members` aj menu zrušené;
  unikátna akcia „Odobrať z organizácie" (DELETE membership, `useRemoveMembership`)
  presunutá do edit dialógu používateľa. Backend `/v1/memberships` endpointy ostávajú.
  (`f9d0fd1`)
- ✅ Offboarding UX: edit dialóg jasne odporúča deaktiváciu pri odchode (história sa
  zachová); „Odobrať z organizácie" v „danger zone" s vysvetlením + 2× potvrdenie +
  5s odpočet pred finálnym krokom. Pripomienka: používateľ sa nikde nemaže natvrdo
  (offboarding = `isActive=false`, odobratie membershipu je soft/obnoviteľné). (`2d49a10`)
- ✅ E-mail notifikácia pri zmene roly: `sendRoleChangedEmail` (email.ts) + napojenie v
  PATCH `/v1/memberships/:id` (fire-and-forget, self-zmena bez e-mailu). (`6f7dc40`)

> Pozn.: pre-commit hook spúšťa plný `turbo typecheck` cez `tsconfig.eslint.json`
> (vrátane `tests/**`) — pri pridaní metódy do `EmailService` interface treba doplniť
> aj stub v `tests/unit/email-protocol-to-sign.test.ts`. Sandbox `tsc -p tsconfig.json`
> testy nezahŕňa, preto to chytí až hook/CI; overuj cez `tsconfig.eslint.json`.

**Otvorené:** — (všetky follow-upy z tejto série uzavreté)

---

## Aktuálny stav (2026-06-15)

**Marketing screenshoty + odstránenie dema + kompletný docs sync — HOTOVÉ.** Session log:
`docs/sessions/2026-06-15-marketing-screenshots-docs-sync.md`. Commity: `c120490`, `a0764e3`,
`18401e5`, `f3508ee`, `38c62c5`, `263b74b`, `23bb589`, `eff1987`, `c420aca`, `52f0677`.

- ✅ Tenant switcher kontrast v tmavej hlavičke (`AppShell.tsx`)
- ✅ 6 reálnych screenshotov demo tenanta „ŠK Demo Inventário" → `product-screens/real_*.png`
- ✅ Nová stránka `/screenshots` (galéria + lightbox) + homepage hero pozadie (dashboard) + pás „Zo živej aplikácie" (3 browser karty)
- ✅ Odstránené `interactive-demo.html` + 6 HTML mockupov + legacy `docs/design/screens/` + `copy-product-screens.sh`
- ✅ TODO.md zosúladený — ADR-0028 (branding), ADR-0030 (auth/identity, vrátane Apple kódu), ADR-0031 (per-tenant MS OAuth) overené DONE v kóde
- ✅ Nový `docs/user-guide/reference/role-opravnenia.md` (matica oprávnení)
- ✅ Docs sync: `docs/README.md`, `architecture/README.md` + `data-model.md` (NestJS→Fastify, Next 14→15, Production LIVE), root README + ROADMAP
- ✅ Rebrand „SFZ Asset Management" → „Inventario" v 19 živých súboroch
- ✅ `docs/api/openapi.yaml` regenerovaný z kanonického `apps/api/openapi.json` (61 pathov)
- ✅ Marketing nav: orezaný prepínač jazykov opravený (`flex-shrink:0`, breakpoint 1100→1240) — `80cf7df`
- ✅ App `/loans` (Žiadosti): nadpis „Výpožičky"→„Žiadosti", stĺpec „Žiadateľ" (z `useMembers`), detail žiadosti `/loans/request/[id]` + `useLoanRequest` — `0f9fb8e`

**Otvorené:** MCP server (Slice #10, Q1 2027); drobnosti (bulk invite CSV, per-tenant email provider override, `test-jwt-loader` → `provisionUser()` migrácia). **Ops (mimo kódu):** Apple Developer creds + `APPLE_*` env; rotácia prod Mongo hesla; voliteľné vyčistenie demo dát z prod.

> Pozn.: 4× `docs/marketing-site/.fuse_hidden…` v git status sú FUSE/mount artefakty (nie naše súbory) — netreba commitovať.

---

## Aktuálny stav (2026-06-11)

**EU compliance je kompletne uzavreté** + audit eventy pre prílohy. Session log: `docs/sessions/2026-06-11-eu-compliance-p1-p2-p3-attachments-audit.md`. Commity: `c816787`, `be7ab64`, `d9b100a`, `1cfa838`, `efbddfb`. Testy 941 passed | 2 skipped; reuse lint 622/622.

- ✅ P1 audit `LOAN_PROTOCOL_SIGNED` + retencia (P2)
- ✅ P2 REUSE 3.3 (SPDX hlavičky + `.reuse/REUSE.toml`)
- ✅ P3 WCAG #1–#6 marketing site
- ✅ Audit eventy pre prílohy (`ASSET_ATTACHMENT_*`)
- ✅ Pre-GA batch 2: reuse lint v CI · EXIF strip · attachments testy · apps/web a11y
- ✅ P3 Compliance Fáza 2 — 4 dokumenty (retention schedule, infosec policy, security whitepaper, DPIA reference pack) + verejný web `/security` a `/dpia`. Session: `docs/sessions/2026-06-11-p3-compliance-docs.md`

**Pre-GA kvalita — HOTOVÉ 2026-06-11 (batch 2):** ~~`reuse lint` do CI~~ ✅ (job `reuse` cez `fsfe/reuse-action@v5` v `ci.yml`); ~~`apps/web` WCAG~~ ✅ (jsx-a11y už bol zapojený, lint čistý — `@axe-core/cli` proti deployed URL ostáva ako budúci krok); ~~integračné testy pre attachments~~ ✅ (`tests/integration/attachments.test.ts`, `@vercel/blob` mock); ~~EXIF strip~~ ✅ (`lib/strip-image-metadata.ts` pure-JS, zapojený v attachments + logo upload, unit testy).

**Otvorené (nice-to-have / pre-GA):** `@axe-core/cli` v CI proti deployed apps/web; súkromné blob URL pre citlivé doklady; Zebra ZPL test (ADR-0027); smoke + DR test; E2E protokolov s 2 účtami; `EMAIL_PROVIDER=ecomail` pre Preview; odvolať mail-tester pozvánku.

---

## Aktuálny stav (2026-06-10)

**Detail majetku — kompletná dávka HOTOVÁ a nasadená** (941/941 testov green). Detail: `docs/sessions/2026-06-10-asset-detail-fixes.md`.

- Protokol PDF: serialNumber + kategória v snapshote ✅
- `appBaseUrl` + verejný `publicAssetLookup` nastaviteľné v Organizácia → QR kódy a štítky; QR/štítky bez 409 (env/default fallback) ✅
- Audit log tab na detaile majetku (`GET /v1/assets/:id/audit`) ✅
- Prílohy + foto majetku (Vercel Blob), hlavné foto na hero karte ✅
- Auth-aware QR sken: prihlásený → interný detail; anonymný → lost&found len s kontaktom (bez identity majetku) ✅
- Opravené: PDF štítok 500 (JPEG logo), multipart double-register, prázdny QR náhľad (credentialed fetch)

**Follow-upy (nice-to-have):** ~~audit eventy pre prílohy~~ ✅ HOTOVÉ (2026-06-11), EXIF strip, súkromné blob URL pre citlivé doklady, živé odskúšanie Zebra ZPL vetvy (ADR-0027).

### ✅ Audit eventy pre prílohy — HOTOVÉ (2026-06-11)

- Nové akcie `ASSET_ATTACHMENT_ADDED` / `_REMOVED` / `_SET_PRIMARY` v `audit-log.ts` enum (prefix `ASSET_` → legalBasis `contract`).
- `attachments.routes.ts` loguje všetky 3 write operácie (POST/DELETE/PATCH primary) cez `fastify.auditLog.record` — **cieľ `entityType: 'Asset'`**, aby sa záznamy zobrazili v audit tabe detailu majetku (`GET /v1/assets/:id/audit`). Snapshot: attachmentId, originalFilename, attachmentType, mime, size.
- Doplnené do retention `CRUD_ACTIONS` (24m). Overené: tsc + eslint ✅. Pozn.: attachments modul nemá integračné testy — kandidát na doplnenie.

### ✅ E-mail notifikácie overené (2026-06-10)

- mail-tester.com: **9.3/10**, SPF + DKIM + DMARC **pass** (aligned). DNS pre `mail.inventario.estate` (SPF cez CNAME na SparkPost, DKIM `ecomail._domainkey.mail`, DMARC, tracking) je správny a publikovaný.
- **Root-cause prečo predtým maily nešli:** produkčný deployment bežal s `EMAIL_PROVIDER=stub` (`[EMAIL-STUB] Would send email` v logu) — env premenná `EMAIL_PROVIDER=ecomail` bola síce vo Verceli, ale **Vercel načíta env len pri novom deployi**. Po `vercel --prod` redeployi sa maily reálne posielajú cez Ecomail.
- Prod env (potvrdené): `EMAIL_PROVIDER=ecomail`, `EMAIL_FROM_ADDRESS=noreply@mail.inventario.estate`, `EMAIL_FROM_NAME=Inventario`, `EMAIL_REPLY_TO=support@inventario.estate`, `ECOMAIL_API_KEY` set. Mŕtva premenná `EMAIL_FROM` (appka ju nečíta) zmazaná.
- Zvyšné body v mail-testeri sú neaktívne: `FROM_FMBLA_NEWDOM28` (dočasná penalizácia za novú doménu — sama zmizne) a chýbajúci `List-Unsubscribe` (irelevantné pre transakčné maily). **Netreba riešiť.**
- TODO drobnosť: odvolať testovaciu pozvánku na `test-y0ie7157d@srv1.mail-tester.com`; zvážiť `EMAIL_PROVIDER` aj pre Preview (teraz len Production → preview deploye posielajú cez stub).

**EU compliance — VŠETKO HOTOVÉ (2026-06-11):** ~~P1 `LOAN_PROTOCOL_SIGNED`~~ ✅, ~~P2 `LOAN_PROTOCOL_CREATED` v retention~~ ✅, ~~P2 REUSE/SPDX hlavičky~~ ✅, ~~P3 WCAG marketing site~~ ✅ — viď nižšie.

### ✅ P2 REUSE 3.3 + P3 WCAG — HOTOVÉ (2026-06-11)

- **REUSE/SPDX:** Inline SPDX hlavičky doplnené do 114 zdrojových súborov (`.ts/.js/.sh/.py`, EUPL-1.2); `.reuse/REUSE.toml` pokrýva nekomentovateľné súbory (JSON/YAML/config = EUPL-1.2, .md/.cff/assety = CC-BY-4.0, .ttf = LicenseRef-DejaVu). Opravená diakritika „Jan"→„Ján" v 7 hlavičkách. **`reuse lint` = 622/622 compliant.** Pozn.: `reuse` CLI pridať do CI (`pipx install reuse` + `reuse lint`).
- **WCAG:** všetkých 6 nálezov (#1–#6) vyriešených v `docs/marketing-site/`. Detail v `docs/compliance/wcag-2.1-aa-audit.md`. Väčšina #2–#6 už bola nasadená skôr; doplnený hlavne `aria-hidden` na dekoratívne emoji (badge prvky, technology/sub-processors, interactive-demo) a aria-label na viewport tlačidlá v `demo.html`.
- Overené: shared-types + api `tsc` ✅, eslint ✅, reuse lint ✅.

### ✅ P1 + P2 audit log — HOTOVÉ (2026-06-11)

- Nová audit akcia `LOAN_PROTOCOL_SIGNED` v `audit-log.ts` enum + nový `target.entityType` `'LoanProtocol'`.
- `protocols.routes.ts` sign endpoint loguje **každý podpis zvlášť** (handover/receive) po úspešnom `repo.update`: `entityType: 'LoanProtocol'`, `legalBasis: 'contract'` (default pre LOAN\_), snapshot (protocolNumber, type, loanId, signedSide, method, transitionedToSigned), metadata (ipAddress, bothSigned, newStatus). Plugin dependency rozšírená o `'audit'`.
- Retention `CRUD_ACTIONS` doplnené o `LOAN_PROTOCOL_CREATED` **aj** `LOAN_PROTOCOL_SIGNED` (24m bucket → pseudonymizácia).
- Overené: shared-types rebuild (tsc), `tsc --noEmit` api ✅, eslint protocols+retention ✅. **Lokálne ešte spustiť:** `pnpm openapi:export` (bez nových paths, ale refresh) a `pnpm test`.

---

## Aktuálny stav (2026-06-09)

**P1 a P2 z predošlého plánu sú hotové** (overené v kóde 2026-06-09):

- BULK vs SERIALIZED odlíšenie — `TrackingModeBadge` + badge v `AssetsTable` + `quantityOnHand`. ✅
- #19 partial index `memberships_userId_organisationId_unique` s `partialFilterExpression: { deletedAt: null }` — migrácia `2026-06-07-memberships-partial-index.ts` + repository. ✅ _(potvrdiť dobehnutie na prod)_
- #18 legacy `User.roles` — `PATCH /v1/users/:id` mutuje len `isActive`, role idú cez `PATCH /v1/memberships/:id`. ✅

**Dnešná session (2026-06-09):** Ecomail spam fix (`EMAIL_FROM_ADDRESS` → `noreply@mail.inventario.estate` vo Vercel) + CI fix `attemptDomainAutoJoin` `isNew` (commit `b981e41`, nasadené). Detail: `docs/sessions/2026-06-09-ecomail-ci-fix-overview.md`.

### ✅ E-mail notifikácia „máš protokol na podpis" — HOTOVÉ (2026-06-09)

- `sendProtocolToSignEmail` pridaná do `EmailService` interface + implementácia + HTML šablóna (`apps/api/src/plugins/email.ts`)
- `notifyProtocolToSign` private helper v `LoansService` — fire-and-forget po transakcii (vzor `sendLoanRejectedEmail`)
- Zapojené na 3 miestach: `fulfilLoanRequest`, `createDirectLoan`, `returnLoan` — vždy notifikuje borrowera
- Unit testy: `tests/unit/email-protocol-to-sign.test.ts` (interface contract); testy spúšťať lokálne (`pnpm test`), sandbox blokuje esbuild/mongodb-memory-server
- Typecheck: ✅ bez chýb

### ✅ E-mail notifikácia borrowerovi pri priamej výpožičke — HOTOVÉ (2026-06-09)

- `sendDirectLoanCreatedEmail` pridaná do `EmailService` + `notifyDirectLoanCreated` helper v `LoansService`
- Zapojené v `createDirectLoan` — fire-and-forget po transakcii
- Commit `3d29301`

### Manuálne checky (P2 zvyšok)

- Overiť `pnpm openapi:export:offline` (ručne dopĺňaný openapi.json — paths /v1/protocols a POST /v1/loans/:id/protocols)
- E2E test s dvomi rôznymi účtami (manager vydá, borrower podpisuje zo svojho účtu) — overí aj Dashboard blok „Čaká na vás"

---

## EU Compliance — gaps zistené 2026-06-09

Stav preverený voči deklaráciám na inventario.estate (EUPL-1.2 · REUSE 3.3 · GDPR ready · WCAG 2.1 AA).

### ✅ P1 — Audit log: LOAN_PROTOCOL_SIGNED (HOTOVÉ 2026-06-11, viď vyššie)

`protocols.routes.ts` (POST `/v1/loans/:id/protocols/:protocolId/sign`) nemá žiadne volanie `auditLog.record`. Prechod DRAFT → SIGNED je kľúčová právna udalosť — kto, kedy, akým spôsobom potvrdil prevzatie/vrátenie majetku.

**Fix:** Pridať `LOAN_PROTOCOL_SIGNED` do `protocols.routes.ts` po úspešnom podpise (po zápise do DB), s `target.entityType: 'LoanProtocol'`, `target.entityId: protocolId`, `severity: 'INFO'`, `legalBasis: 'legitimate_interest'`. Taktiež pridať `LOAN_PROTOCOL_SIGNED` do `CRUD_ACTIONS` v `retention.service.ts`.

### ✅ P2 — Audit log: LOAN_PROTOCOL_CREATED v retention (HOTOVÉ 2026-06-11, viď vyššie)

Akcia `LOAN_PROTOCOL_CREATED` je logovaná v kóde, ale **chýba v `CRUD_ACTIONS`** zozname v `retention.service.ts` → nikdy sa nepseudonymizuje. Fix: pridať jeden riadok do `CRUD_ACTIONS` array.

### 🟡 P2 — REUSE 3.3: chýba `.reuse/` adresár a 122 súborov bez SPDX hlavičky

Web deklaruje **REUSE 3.3 compliant**, ale:

- Chýba `.reuse/dep5` alebo `.reuse/REUSE.toml` (povinný pre REUSE spec)
- 122 zdrojových súborov (z 341) nemá `SPDX-FileCopyrightText` + `SPDX-License-Identifier` hlavičku — najmä `apps/api/src/modules/audit/`, `categories/`, `locations/`, `organisations/`, `stock/`, `users/`, `loans/`, utility libs, helper súbory

**Fix:** (a) Pridať `.reuse/REUSE.toml` (alebo `dep5`) pre generované súbory a binary assets. (b) Batch-pridať SPDX hlavičky do chýbajúcich zdrojových súborov — 1-riadkový copyright + license comment. Potom spustiť `reuse lint` v CI. Súbory v `dist/` a `node_modules/` sa riešia cez `.reuse/dep5` (REUSE to predvída).

### 🟢 P3 — WCAG 2.1 AA: marketing site má 3 otvorené P1 nálezy

Podľa `docs/compliance/wcag-2.1-aa-audit.md` (audit z 17. mája 2026, plánovaný fix „Phase D"):

- **#1** SVG a emoji ikony bez `aria-hidden` (1.1.1 Non-text content)
- **#2** Chýba `<main>` landmark (1.3.1 Info and relationships)
- **#3** Link color `--brand-accent #388fc3` má kontrast ~3.5:1 voči bielej — pod AA limitom 4.5:1 (1.4.3 Contrast)

`apps/web` (aplikácia) zatiaľ bez WCAG auditu — plánovaný `eslint-plugin-jsx-a11y` + `@axe-core/cli` v CI.

### ✅ Čo je v poriadku

- GDPR Article 30 záznamy existujú (`docs/compliance/gdpr-article-30.md`)
- Retenčná politika implementovaná (`retention.service.ts`) — 3 časové pásma (24/60/84 mesiacov), pseudonymizácia (nie mazanie)
- `LOAN_PROTOCOL_CREATED` je logovaný (chýba len v retention — viď P2 vyššie)
- LICENSES/ adresár obsahuje EUPL-1.2.txt, CC-BY-4.0.txt, LicenseRef-DejaVu.txt ✅
- EUPL-1.2 licencia v existujúcich súboroch správne ✅

---

## Archív — stav (2026-06-07, koniec 2. session)

**Detail výpožičky + Preberacie protokoly UI HOTOVÉ a OTESTOVANÉ na produkcii.** Nové: `/loans/[id]` detail s protokolmi, CLICK_TO_SIGN podpis, PDF/Tlač, `/protocols` zoznam + menu (managerOnly), backend `GET /v1/protocols` + `POST /v1/loans/:id/protocols` (backfill), sign fixuje snapshot strany. Detaily: `docs/sessions/2026-06-07-loan-detail-protokoly-ui.md`.

E2E test prešiel (PROT-2026-000001 → SIGNED, PDF render OK). Pri teste opravené 2 prod bugy: (1) ProtocolCard — podpis druhej strany, keď je user oboma stranami (`f10ecdb`), (2) PDF render padal s JPEG logom tenanta — embedJpg podľa magic bytes + vercel.json includeFiles pre assets (`e9834c4`, `ed916b9`). `pnpm install` + `pnpm test` lokálne prebehli OK.

Dodatočne: PDF layout fix (sivé pásy tabuľky + čas podpisu Europe/Bratislava, `0a4952f`) a **Dashboard blok „Čaká na vás"** (`9022e83`) — akčný prehľad žiadostí na schválenie/vydanie, protokolov na podpis a výpožičiek po termíne s priamymi odkazmi; manager aj employee variant. Všetko nasadené na prode.

## ĎALŠIA SESSION — začni tu

### Protokoly — drobnosti (P2)

- Overiť `pnpm openapi:export:offline` (ručne dopĺňaný openapi.json — nové paths /v1/protocols a POST /v1/loans/:id/protocols)
- Zvážiť e-mail notifikáciu „máš protokol na podpis" (EmailService existuje)
- Test s dvomi rôznymi účtami (manager vydá, borrower podpisuje zo svojho účtu) — overí aj Dashboard blok „Čaká na vás" s reálnymi dátami

### Vizuálne odlíšenie BULK vs SERIALIZED (P1)

- V zozname majetku (`/assets`) vizuálne odlíšiť BULK položky (badge/ikona)
- Pri BULK v detaile zobraziť `quantityOnHand` prominentne

### Pre-GA cleanup

- `PATCH /v1/users/:id` — odstrániť/migrovať legacy `User.roles[]` endpoint (TODO #18)
- Smoke test + DR test

---

## Pôvodný stav (2026-06-06, koniec session — handoff do Cowork)

Testovanie formulárov na `app.inventario.estate` (SFZ tenant). Pridávanie majetku (SERIALIZED aj BULK) funguje. RECEIPT logika pri BULK create **dokončená a nasadená**. Sklad stránka funguje.

### Hotové v tejto session

- Combobox dropdown fixes, lokalita quick-create (`EXTERNAL`), Štítky→Tagy
- Číselníky: plný LocationDialog s výberom typu + Upraviť tlačidlo
- LocationType enum: `HEADQUARTERS` + `BRANCH` (migrácia `2026-06-05b`)
- Org nastavenia: inventárne číslovanie sekcia + `foundContactInfo`/`inventoryNumberFormat` v API schéme (boli stripované Zodom — preto sa neukladali)
- trackingMode SelectField + `initialQuantity` pole pre BULK
- RECEIPT pohyb pri BULK create (`assets.service.ts` + `assets.routes.ts` inject `StockMovementsRepository`)
- Stock overview fixes: `$$` premenné v `$lookup`, `$arrayElemAt` namiesto `$first`, `$ifNull` na `quantityOnHand` (legacy assety bez poľa), stringify ID v response

## ROZROBENÉ — pokračovať tu

### Stav rozrobeného Skladu (P0 — dokončiť test)

Sklad prehľad (`/stock`) sa načítava správne. Zobrazuje **1 položku**: `SFZ-2026-00002` "Predlžovací elektrický kábel, 5m", stav **Prázdne (0 ks)**.

**Prečo 0 ks:** táto BULK predlžovačka bola vytvorená _pred_ dokončením RECEIPT logiky, takže nemá žiadny RECEIPT pohyb a `quantityOnHand` bolo `undefined` (teraz sa v overview defaultuje na 0 cez `$ifNull`). Je to legacy dáta, nie bug.

**Čaká sa na test príjmu (next step):**

1. Klik na `SFZ-2026-00002` → detail (`/assets/6a241d101df5faf33798c30a`)
2. Tab **Sklad** → tlačidlo **Príjem na sklad**
3. Zadať počet (napr. 10) + lokalitu → overiť že:
   - vznikne RECEIPT záznam v `stock_movements` (kolekcia je teraz prázdna)
   - `quantityOnHand` sa nastaví na 10
   - stav v prehľade sa zmení z "Prázdne" na "V poriadku"
4. **Posledný neoverený bod:** či tab Sklad v detaile (`StockPanel`) korektne načíta pohyby pre položku s legacy `quantityOnHand`. Ak padá, skontrolovať `useStockMovements` hook + `GET /v1/stock/:itemId/movements` (rovnaký vzor legacy undefined ako pri overview).

### Pozn. pre nový BULK majetok (čistý flow)

Nové BULK položky vytvorené _po_ tejto session už dostanú RECEIPT pohyb automaticky z `initialQuantity` (minimum 1, vynútené na FE). Test: vytvoriť novú BULK položku s počtom → hneď by mala mať správny `quantityOnHand` + RECEIPT záznam.

## Ďalšie kroky (po dokončení Sklad testu)

### Vizuálne odlíšenie BULK vs SERIALIZED (P1)

- V zozname majetku (`/assets`) vizuálne odlíšiť BULK položky (badge/ikona)
- Pri BULK v detaile zobraziť `quantityOnHand` prominentne

### Pre-GA cleanup

- `PATCH /v1/users/:id` — odstrániť/migrovať legacy `User.roles[]` endpoint (TODO #18)
- Smoke test + DR test

## Referencie

- Session doc: `docs/sessions/2026-06-06-testing-forms-ciselníky-org-settings.md`
- TODO.md: #23 (RECEIPT — DONE), #18 (legacy roles endpoint)
- Detail položky predlžovačky: `/assets/6a241d101df5faf33798c30a`

## Pozn. pre Cowork prostredie

V Cowork beží terminál + filesystem priamo na disku — žiadny `copy_file_user_to_claude` workaround. `pnpm typecheck` / `pnpm test` / `pnpm build` možno spúšťať priamo. Git stále cez GitHub Desktop (GPG signing).
