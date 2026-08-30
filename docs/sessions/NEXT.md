# NEXT

## Aktuálny stav (2026-08-30) — Atlas náklady + zrušený keep-warm cron — HOTOVÉ

Session log: `docs/sessions/2026-08-30-atlas-naklady-keep-warm-cron.md`.

Janika nahlásila nárast Atlas nákladov na projekte `inventario.estate`
(24,56 → 68,26 USD) pri ~4 MB dát a vystopovala to ku keep-warm cronu
`GET /health/ready` `*/4 * * * *` (commit `8a91c32`).

- ✅ **Cron zrušený** — `apps/api/vercel.json`. Nie ako úspora, ale preto,
  že je zbytočný: pôvodnú príčinu (jedna teplá inštancia = 1 request
  naraz) vyriešil Fluid Compute (`b07cabc`, zapnutý 2,5 h po crone).
  Komentár v `health.routes.ts` prepísaný na historickú poznámku.
  Endpoint `/health/ready` ostáva (deploy verifikácia, uptime monitoring).
- ✅ **Skutočná príčina nákladov nájdená** — Atlas Cost Explorer rozpad
  podľa clustera ukázal, že `inventario-prod` je plochý (8,06 → 7,54) a
  celý nárast +43,70 USD je cluster **`inventario-dev`** (9,65 → 60,72).
  60,72 USD je nad stropom Flexu (~30 USD) → takmer isto dedikovaný M10.

- ✅ **Overené v Atlase** — `inventario-dev` je **M10**, 3-node replica set,
  Encrypted Storage + Backups Active, a je **úplne prázdny** (20 kolekcií,
  0 dokumentov). Dedikovaný cluster sa nedá zmenšiť späť na Flex/Free.
  Rozdiel „dev má 2 GB, prod 3,6 MB" je len rôzna metrika (_Disk Usage_
  vrátane oplogu/journalu vs _Data Size_), nie reálne dáta.
- ✅ **Ostré dáta sú na `inventario-prod`** — overené tromi spôsobmi
  (obsah, živá prevádzka do 29. 8., a produkčný endpoint vracia org `_id`
  z tohto clustera). Na dev nesedíme.
- ✅ **Mŕtve CI secrets upratané** — `ci.yml` už nenastavuje
  `MONGO_URI_TEST` / `ENTRA_*_TEST`; `tests/setup.ts` MONGO_URI aj tak
  bezpodmienečne prepíše na in-memory replica set.

**Rozhodnutia (Janika):** `inventario-dev` **zmazať bez náhrady** (žiadny
M0 ani Flex) — vedomý dôsledok je, že Preview deploye `inventario-api`
prestanú nabíehať. `apps/api/.env.local` **ostáva namierený na produkciu**
(vedome prijaté riziko, nie otvorený bod).

**Otvorené (mimo kódu, Janika):** zmazať `inventario-dev` v Atlase
(`mongodump` netreba, nie je čo zálohovať); zmazať repo secrets
`MONGO_URI_TEST` / `ENTRA_API_CLIENT_ID_TEST` / `ENTRA_TENANT_ID_TEST`;
vyriešiť Preview `MONGO_URI` vo Verceli (ukazuje na mŕtvy cluster);
prekontrolovať `contineo.app` (11,50 → 65,20 — rovnaký M10 podpis).

**Otvorené (kód, samostatné rozhodnutie):** `if: github.actor !=
'dependabot[bot]'` v `ci.yml` už nemá opodstatnenie (testy nepotrebujú
žiadne secrets) — dá sa zrušiť, aby dependabot PR bežali aj testami.

**Zálohovanie produkcie (dodatok 2 v session logu):** `inventario-prod` je
Flex → zálohy sú **8 denných snapshotov**, bez vlastnej politiky, bez
on-demand snapshotov a **bez Point-in-Time restore** (ten je až od M10).
Reálne RPO až 24 h. Vedome ponechané na Flexe (M10 by stálo tých istých
~58 USD/mes.). **Otvorené:** overiť v Atlas → Backup, že snapshoty naozaj
existujú; spraviť DR test (restore nanečisto — stály otvorený bod od júna);
skontrolovať, či `docs/compliance/` netvrdí o zálohovaní viac, než Flex
reálne poskytuje.

**Otvorené (kód, ak sa vráti pomalý preloader):** obmedziť
`GlobalFetchOverlay` len na kritické requesty; presunúť `ensureIndexes()`
mimo cold-startu (vzor ako migrácie, `00a2515`); zvážiť vypnutie Swaggeru
v produkcii.

---

## Aktuálny stav (2026-07-16) — ADR-0036 „Vrátiť od osoby" (čiastočné + cross-loan vrátenie) — HOTOVÉ

Session log: `docs/sessions/2026-07-16-adr-0036-vratenie-od-osoby.md`.

Popri dvoch menších opravách (zamenené titulky HANDOVER/RETURN v tlačovom
PDF protokole, placeholder text v žiadosti o výpožičku) implementované
celé ADR-0036: nová doplnková cesta „Vrátiť majetok" na detaile osoby —
vráti ľubovoľnú podmnožinu kusov, aj cez viaceré `Loan`-y naraz, jedným
konsolidovaným RETURN protokolom. Nový stav `LoanStatus.
PARTIALLY_RETURNED`. **Pôvodné tlačidlo „Vrátiť" na detaile jednej
výpožičky ostáva bezo zmeny** (explicitná Janikina korekcia) — čisto
doplnková feature.

K1–K8 hotové: shared-types schémy, `loans.service.
listBorrowedItemsForBorrower`/`returnItemsForBorrower`, dva nové
endpointy (`GET /v1/users/:id/borrowed-items`,
`POST /v1/users/:id/return-items`), frontend hooky +
`ReturnFromPersonModal.tsx`, integračné testy (napísané, staticky
overené — vitest v sandboxe nejde spustiť), ADR-0036 → Accepted, user-
guide addendum. Commit `5b3a967` (main), pushnuté — pri commite husky
hook na Janikinom Macu automaticky prerátal `apps/api/openapi.json`.

Janika lokálne potvrdila „all green" (`pnpm install`, `generate:api-
types`, `pnpm test`, `pnpm typecheck`, `pnpm lint`).

**Otvorené (nice-to-have, nie blocker):** v `apps/web/src/lib/api-
hooks.ts` je dočasné pretypovanie `apiClient.GET/POST` pre
`useBorrowerBorrowedItems`/`useReturnItemsFromBorrower` (kým `api-
types.ts` nepoznalo nové endpointy) — teraz po `generate:api-types` sa
môže zrušiť, je to len úklid, nie funkčná zmena.

---

## Aktuálny stav (2026-07-15, deviate pokračovanie) — ADR-0035 Fáza 2: F8 docs — HOTOVÉ, Fáza 2 KOMPLETNÁ

Session log: `docs/sessions/2026-07-15-adr-0035-faza-2-f8-docs.md`.

Janika lokálne potvrdila F7 ("testy ok"). F8: nový how-to návod
`docs/user-guide/how-to/vlastna-domena-prihlasenie.md` (predpoklady,
kroky nastavenia domény v appke/DNS/aktivácia na našej strane, možné
problémy), doplnený do how-to indexu, ADR-0035 status na „Fáza 2
kompletná“. **TODO #26 úplne uzavreté.**

Po overení F7 Janika poslala UX feedback (screenshoty z
`majetok.futbalsfz.sk`) — ukázalo sa, že testovala **predchádzajúci
(starší) production deploy**, nie F4–F7 (Vercel build bežal ešte ~51s
po pushi F7 commitov, ona testovala v tomto okne). Content zo
screenshotov („Vitajte späť“ s „Vytvoriť novú organizáciu“ a
nefiltrované `/login`) zodpovedá starému `AuthGate`/`LoginScreen`
správaniu (pred F4), nie novej `/tenant-login` stránke (F6) — overené
cez Vercel MCP (`get_deployment` na najnovšom `production` deploymente:
`githubCommitSha: 5c2db50...`, `readyState: READY`). Janike treba
napovedať znova otestovať na aktuálnom deployi (hard refresh) skôr než
sa rieši jej návrh na zlúčenie do jednej „welcome“ obrazovky s krátkym
popisom služby — väčšina jej pripomienok (extra register button,
nefiltrované metódy po kliku) by už mala byť vyriešená samotným F6, len
chýba krátky popis služby na `/tenant-login` — to je menší návrh na
zváženie, nie bug.

**Otvorené:** čaká sa na Janikino retestovanie na aktuálnom deployi a
rozhodnutie o malom UX doplnku (popis služby na `/tenant-login`).

---

## Aktuálny stav (2026-07-15, ôsme pokračovanie) — ADR-0035 Fáza 2: F7 end-to-end testy F4–F6 — HOTOVÉ

Session log: `docs/sessions/2026-07-15-adr-0035-faza-2-f7-testy.md`.

Po overení F6 (Janika lokálne, all green) pokračovanie do F7. Objavené:
`apps/web` nemalo žiadnu vitest infra (len placeholder `test` skript).
Vyjasnené s Janikou (AskUserQuestion) — zvolila postaviť infra teraz.

- ✅ **F7a** — `apps/web/vitest.config.ts` (nový), `vitest` devDependency
  - `test`/`test:watch` skripty, `apps/web/tests/unit/middleware.test.ts`
    (9 testov — host routing, cache, fail-closed).
- ✅ **F7b** — `dynamic-cors.test.ts` rozšírený o end-to-end blok cez
  skutočný `app.inject` s `Origin` hlavičkou (nielen priame volanie
  resolvera) — CORS hlavičky, statický zoznam, preflight OPTIONS.

`eslint`/`prettier` čisté. `tsc` na `apps/web` zlyháva na chýbajúcom
`vitest` module (nová devDependency, žiadny `pnpm install` v sandboxe) —
**očakávané**, Janika musí najprv `pnpm install`.

**Otvorené:** F8 (user-guide docs, zatvoriť TODO #26). Čaká na Janikino
potvrdenie po `pnpm install` + otestovaní F7.

---

## Aktuálny stav (2026-07-15, siedme pokračovanie) — ADR-0035 Fáza 2: F6 /tenant-login stránka — HOTOVÉ

Session log: `docs/sessions/2026-07-15-adr-0035-faza-2-f6-tenant-login.md`.

Po overení F5 (Janika lokálne, 63/63 testov po oprave Zod poradia)
pokračovanie do F6. Vopred vyjasnené s Janikou (AskUserQuestion): (1) F6a
doplní `slug` do login-context response pre OAuth hint, (2) nová
samostatná stránka so zdieľanou logikou (nie rozšírenie LoginPage.tsx).

Mimoriadka: Janika nahlásila Zebra tlač "Load failed" v Safari —
diagnostikované ako mixed-content blok (`http://localhost:9100` z HTTPS
stránky), Safari nikdy neboli zohľadnená. Janika rozhodla nič v kóde
nemeniť, len odporúčať Chrome/Edge.

- ✅ **F6a** — `slug` doplnené do `login-context` response
  (`public-login-context.routes.ts`), nový test.
- ✅ **F6b** — zdieľaná logika vytiahnutá z `LoginPage.tsx` do
  `useOrgAwareLogin` hooku + `OrgAwareLoginForm` komponenty +
  `loginErrorMessages.ts`. `LoginPage.tsx` je teraz tenký wrapper.
- ✅ **F6c** — nová `/tenant-login` stránka (`TenantLoginPage.tsx` +
  `app/tenant-login/page.tsx`), číta `?domain=`, po úspešnom prihlásení
  plná navigácia na `app.inventario.estate`.

`tsc`/`eslint`/`prettier` čisté na celom F6 changesete. `vitest` v
sandboxe sa nedá spustiť (známy limit) — Janika spustí lokálne.

**Otvorené:** F7–F8 (end-to-end testy F4–F6, docs). Čaká na Janikino
potvrdenie po otestovaní F6a.

---

## Aktuálny stav (2026-07-15, šieste pokračovanie) — ADR-0035 Fáza 2: F5 UI vlastná doména — HOTOVÉ

Session log: `docs/sessions/2026-07-15-adr-0035-faza-2-f5-vlastna-domena-ui.md`.

Po overení F4 (Janika lokálne, 9/9 testov) pokračovanie do F5. Počas
implementácie objavený konflikt s existujúcim kódom (`customDomain` bol
zámerne platform-operator-only) — vyjasnené s Janikou cez AskUserQuestion,
odpoveď: **"Tenant ADMIN sám v /settings/auth"**.

- ✅ **Backend** — `customDomain` presunuté do
  `UpdateOwnOrganisationBodySchema` (FQDN regex, lowercase), kolízny
  check v `updateCurrent()` (400 pri kolízii s iným tenantom).
- ✅ **Frontend** — nová karta „Vlastná doména pre prihlásenie“ v
  `AuthSettingsContent.tsx` (stavový badge, validácia, DNS návod).
- ✅ 7 nových integration testov v `organisations.test.ts` (PATCH
  /current blok).

`tsc`/`eslint`/`prettier` čisté. `vitest` v sandboxe sa nedá spustiť
(známy limit) — Janika spustí lokálne.

**Otvorené:** F6–F8 (`/tenant-login` stránka, e2e testy, docs). Bez F6 je
F4 middleware stále no-op v praxi (rewrite cieli na stránku, ktorá ešte
neexistuje). Čaká na Janikino potvrdenie po otestovaní F5.

---

## Aktuálny stav (2026-07-15, piate pokračovanie) — ADR-0035 Fáza 2: F4 custom domain middleware + dynamický CORS — HOTOVÉ

Session log: `docs/sessions/2026-07-15-adr-0035-faza-2-f4-custom-domain-cors.md`.

Po overení Fázy 1 (Janika lokálne, 12/12 testov) pokračovanie do Fázy 2:

- ✅ **F4a** — dynamický CORS (`modules/organisations/dynamic-cors.ts`) —
  vlastná doména organizácie môže robiť `credentials: 'include'` fetch na
  API, overí sa proti `customDomain` v DB (https-only, presná zhoda,
  fail-closed, 60s cache).
- ✅ **F4b** — `apps/web/middleware.ts` (Next.js Edge Middleware) —
  host-aware rewrite na `/tenant-login` pre registrovanú vlastnú doménu,
  404 pre neznámu, redirect na `app.inventario.estate` pre iné cesty.
  Zatiaľ no-op (žiadna org nemá `customDomain` nastavený, F5 ešte nie je).
- Nezávislá bezpečnostná revízia (Opus subagent) — "safe to ship with
  minor fixes", všetky should-fix položky opravené (rate-limit
  keyGenerator per (IP, cieľ), https+port strict check).
- Nový `apps/api/tests/integration/dynamic-cors.test.ts` — jednotkové
  testy resolvera.

`tsc`/`eslint`/`prettier` čisté. `vitest` v sandboxe nedá spustiť (známy
limit) — Janika spustí lokálne.

**Manuálny krok pre Janiku** (mimo kódu): pridať `majetok.futbalsfz.sk`
k projektu **`inventario-app`** cez Vercel dashboard — nemám na to MCP
nástroj.

**Otvorené:** F5–F8 (UI vlastná doména, `/tenant-login` stránka, e2e
testy, docs). Čaká na Janikino potvrdenie po otestovaní F4.

---

## Aktuálny stav (2026-07-15, štvrté pokračovanie) — ADR-0035 Fáza 1: org-aware /login — HOTOVÉ

Session log: `docs/sessions/2026-07-15-adr-0035-faza-1-org-aware-login.md`.

Janika navrhla mikro-stránku prihlásenia na vlastnej doméne organizácie
(napr. `majetok.futbalsfz.sk`). Spísané ako
`docs/decisions/0035-tenant-custom-domain-login.md` (dvojfázový plán),
po schválení ("poďme do toho") implementovaná Fáza 1 (F1–F3):

- ✅ **F1** — nový verejný endpoint `GET /v1/public/organisations/login-context`
  (slug alebo domain, whitelist poli, rate-limited, no-oracle 404).
- ✅ **F2** — `LoginPage.tsx` číta `?org=<slug>`, filtruje metódy podľa
  `allowedAuthProviders`, zobrazí branding organizácie (logo + farby cez
  existujúci `buildBrandStyle`, ADR-0028). Bez `?org=` žiadna regresia.
- ✅ **F3** — integračné testy pre F1 (happy path, validation, privacy).

`tsc`/`eslint`/`prettier` čisté. `vitest` v sandboxe nedá spustiť (známy
limit) — Janika spustí lokálne.

**Otvorené:** Fáza 2 (ADR-0035 F4–F8) — vlastná doména, host-aware
middleware, dynamický CORS. Nezačaté, čaká na ďalšiu session.

---

## Aktuálny stav (2026-07-15, tretie pokračovanie) — login stránka ignoruje allowedAuthProviders — ZAEVIDOVANÉ (bez fixu)

Janika nahlásila: nastavila pre organizáciu „Slovenský futbalový zväz“ len
Microsoft prihlásenie (`/settings/auth`), ale `/login` aj tak zobrazuje
všetky ostatné možnosti (email/heslo, Google, passkey).

Diagnostika (bez zásahu do kódu, len prieskum): `/login`
(`LoginPage.tsx`) je jedna globálna, tenant-agnostická stránka — nevie,
ku ktorej organizácii prihlasujúci sa užívateľ patrí, takže zobrazí všetko.
Backend gate (`email-auth.routes.ts:433`, `oauth.routes.ts:660-676`) reálne
zamietne nepovolenú metódu pri pokuse o prihlásenie — nejde teda o
bezpečnostnú dieru, len o zavádzajúce UI. Presne toto riziko predpokladá
ADR-0031 (sekcia 4 + „Riziká“) — backend má pripravený `?org=<slug>` hint,
frontend ho ale nikde nepoužíva.

Janika skúšala len plain `/login`, videla nesprávne tlačidlá, neklikala
na ne — rozhodla sa zatiaľ **len zaevidovať ako známy problém**, nie riešiť
teraz. Zapísané do `docs/TODO.md` položka #26 (P2, s možnými riešeniami
z ADR-0031: `?org=` hint / email-first / subdoména).

**Otvorené:** bez zmeny kódu, čaká na rozhodnutie, kedy sa tým riadkom
zaoberať (nie blocker pre pilot).

---

## Aktuálny stav (2026-07-15, pokračovanie) — cleanup „Osoby" + oprava CI — HOTOVÉ

Session log: `docs/sessions/2026-07-15-cleanup-osoby-a-ci-fix.md`.

Janika potvrdila `/users` v produkcii (ADMIN aj ASSET_MANAGER) a dáva
pokyn na cleanup (task #35).

- ✅ **Cleanup, presné skope po overení** — pôvodný plán chýbal jeden
  detail: `usePersonsDirectory()`/`PersonSummary`/`GET /v1/users/directory`
  (list) má druhého volajúceho — filter "Osoba" na stránke Audit log.
  Zmazané len skutočne mŕtve časti: `PersonsContent.tsx`,
  `PersonDetailContent.tsx`, `usePerson()` (jednotné číslo) +
  `GET /v1/users/directory/:id`. List route + `usePersonsDirectory`
  ostávajú, komentované prečo.
- ✅ **CI fix (GH Actions #365/#366)** — 2 existujúce testy
  (`users-get.test.ts`, `users-list.test.ts`) overovali starý
  ASSET_MANAGER-orezaný tvar bez `firstName`/`lastName` — chýbajúci krok
  z K1 (task #37), ktoré tento tvar zámerne rozšírilo pre detail stránku.
  Testy aktualizované.

`tsc`/`eslint`/`prettier` čisté. `vitest` v sandboxe nedá spustiť —
autoritatívne overenie je CI na GitHub po pushi.

**Otvorené:** sledovať zelený CI beh, overiť Vercel deploy READY.

---

## Aktuálny stav (2026-07-15) — pomalé prekliky Používatelia → detail → majetok — FIX NASADENÝ

Session log: `docs/sessions/2026-07-15-pomale-prekliky-fluid-compute.md`.

Janika nahlásila hneď po nasadení detailu používateľa: každý preklik
Používatelia → detail používateľa → detail majetku trval 2s+, tretie kliknutie
(na majetok) trvalo vyše 10s.

- ✅ **Diagnostikované** — Vercel runtime logy ukazujú rýchly backend
  (280–970 ms vnútri Fastify). Reálna príčina: každá stránka posiela 2–3
  súbežné API volánia naraz (detail používateľa: user+loans; detail
  majetku: asset+attachments+qr) a bez Fluid Compute obslúži jedna teplá
  inštancia len 1 request naraz — zvyšok dostane studený štart, ktorý sa
  vo Fastify `responseTime` vôbec neukáže.
- ✅ **Fluid Compute zapnuté** — `apps/api/vercel.json`: `"fluid": true`
  (per-deployment, stačí commit, žiadny zásah v dashboarde).
- ✅ **MongoDB index doplnený** — `organisationId_borrowerId_createdAt` na
  `loans`. `explain()` v produkcii ukazoval COLLSCAN pre `borrowerId` filter
  - `createdAt` sort — presne tento nový query pattern zaviedla stránka
    `/users/[id]`; neskálovalo by to s rastúcim počtom výpožičiek.

**Otvorené:** subjektívne overiť o pár dní, či sa prekliky citateľne
zrýchlili. Ak nie: ďalší krok (známy, zatiaľ odložený) je obmedziť
`GlobalFetchOverlay` len na kritické requesty namiesto blokovania celej
obrazovky pri každom paralelnom volání.

---

## Aktuálny stav (2026-07-14, pokračovanie) — detail + editácia používateľa — K1–K4 HOTOVÉ

Session log: `docs/sessions/2026-07-14-detail-editacia-pouzivatela.md`.

Janikin nápad: zo zoznamu `/users` doplniť pre ADMIN aj ASSET_MANAGER možnosť
otvoriť detail používateľa (všetok vypožičaný majetok, aj minulý) a pre ADMIN
navyše možnosť editovať Meno, Priezvisko a email.

Rozhodnuté (AskUserQuestion, 3 kolá, vrátane jedného kola spresnenia po prvom
návrhu): **dva samostatné UI povrchy**, nie jeden dialóg so všetkým.

- ✅ **K1 backend** — `PATCH /v1/users/:id` rozšírený o `firstName`,
  `lastName`, `email` (email len pri `LOCAL` účte, ináč 400; duplicita v rámci
  org → 400 cez E11000). `displayName` sa auto-derivuje. `toManagerShape()`
  (ASSET_MANAGER výrez) rozšírený o `firstName`/`lastName`.
- ✅ **K2a frontend — editačný modál** (`UserEditDialog.tsx`, len ADMIN) —
  kompletne prerobený: bez výpožičiek, s Meno/Priezvisko/Email poliami.
- ✅ **K2b frontend — nová stránka** `/users/[id]` (`UserDetailContent.tsx`,
  ASSET_MANAGER + ADMIN, read-only) — hlavička + zoznam majetku (aktívny hore,
  vrátený dole) s dátumami a priamym linkom na detail majetku. V zozname:
  meno = link na detail, ceruzka (len ADMIN) = otvorí editačný modál.
- ✅ **K3 testy** — nové integračné testy pre firstName/lastName/email PATCH
  (happy path, duplicita 400, OAuth guardrail 400). `tsc`/`eslint`/`prettier`
  čisté v sandboxe.
- ✅ **K4 docs** — `role-opravnenia.md` rozšírený (footnote 6 + poznámka o
  LOCAL-only zmene emailu).

**Dôležité pre task cleanup (Zlúčenie Osoby+Používatelia, nižšie):**
`UserEditDialog.tsx` **zostáva aktuálne používaný** (ADMIN editačný modál) —
NEPRIDÁVAŤ ho na zoznam na zmazanie.

**Otvorené:** commit + push (git MCP), lokálne spustiť
`pnpm --filter api test tests/integration/users-patch.test.ts`, overiť Vercel
deploy oboch projektov READY a UI manuálne (ADMIN detail+edit, ASSET_MANAGER
len detail).

---

## Aktuálny stav (2026-07-14, pokračovanie) — zlúčenie „Osoby" + „Používatelia" — K1–K4 HOTOVÉ, K5 (cleanup) ČAKÁ NA POTVRDENIE

Session log: `docs/sessions/2026-07-14-zlucenie-osoby-pouzivatelia.md`.

Janikov nápad: zlúčiť menu „Osoby" (ASSET_MANAGER, read-only adresár) a
„Používatelia" (ADMIN, plná administrácia) — obe čítali tú istú `users`
kolekciu, len s iným RBAC a výrezom polí.

Rozhodnuté (AskUserQuestion, 3 kolá): jedna stránka `/users` („Používatelia"),
obsah podľa role; detail osoby pre ASSET_MANAGER nahradený doterajším edit
dialógom (read-only) s presunutou sekciou výpožičiek; nepoužité súbory zmazať
až po Janikinom overení (task cleanup, NIE hneď).

- ✅ **K1 backend** — `GET /v1/users` a `GET /v1/users/:id`: RBAC rozšírené na
  ASSET_MANAGER+ADMIN, nová `toManagerShape()` (odlišná od zamrznutej legacy
  `toDirectoryShape()`) trimuje odpoveď pre ASSET_MANAGER (bez MFA/GDPR/admin
  metadát). ADMIN nezmenene. Zápisové cesty (`PATCH`) ostávajú ADMIN-only.
- ✅ **K2 frontend** — `/persons` a `/persons/[id]` teraz len `redirect('/users')`.
  `UserEditDialog` dostal `canEdit` prop (read-only pre ASSET_MANAGER) + novú
  sekciu „Výpožičky tejto osoby" portovanú z `PersonDetailContent.tsx` (pre
  oboch). `AppShell` nav: `/users` z `adminOnly` na `managerOnly`, `/persons`
  odkaz zrušený.
- ✅ **K3 testy** — opravený existujúci RBAC test (ASSET_MANAGER 403→200),
  nové testy na presný trimmed/plný tvar pre `GET /v1/users` a `/v1/users/:id`.
- ✅ **K4 docs** — `role-opravnenia.md` aktualizovaný (matrica + footnote).
- **Zámerne nezmazané** (task cleanup, čaká na Janikino overenie v UI a
  explicitné potvrdenie — org pravidlo „nikdy nemazať bez povolenia"):
  `PersonsContent.tsx`, `PersonDetailContent.tsx`, `usePersonsDirectory`/
  `usePerson` v `api-hooks.ts`, backend `/v1/users/directory*` routes +
  `toDirectoryShape`/schémy.

✅ **Nasadené a overené** — commity `6c87197`/`099e3c5`/`d2300b8`. Pri
push viacerých commitov naraz sa odhalil a opravil samostatný bug: Vercel
`ignoreCommand` (`HEAD^ HEAD`) videl len posledný (docs) commit a preskočil
build API — oprava `73ae0f4` (`VERCEL_GIT_PREVIOUS_SHA` namiesto `HEAD^`,
pozri session log). Po redeployi potvrdené `GET /openapi.json` → „List users
(manager)" pre `/v1/users`, oba projekty READY, žiadne nové runtime chyby.

**Otvorené:** Janika overí `/users` ako ADMIN aj ako ASSET_MANAGER (test účet)
v UI a dá pokyn na cleanup (task #35).

---

## Aktuálny stav (2026-07-14, pokračovanie) — pomalý preloader po nečinnosti — DIAGNOSTIKOVANÉ + FIX NASADENÝ

Session log: `docs/sessions/2026-07-14-pomaly-preloader-po-necinnosti.md`. Commit `8a91c32`.

Janika: po 2-3 min nečinnosti sa preloader (napr. na Majetok) točí ešte 5-10+s
po tom, čo sú dáta na pozadí už viditeľné (aj na iných stránkach — Žiadosti,
Používatelia).

- ✅ **Root cause potvrdený z Vercel runtime logov:** po nečinnosti dopadne
  aspoň jeden z paralelných requestov na studenú serverless instanciu
  (~10-12s boot: Node proces + Mongo TLS handshake + plugin chain), zatiaľ
  čo ostatné dopadnú na teplú (~0,3-1s). `GlobalFetchOverlay` čaká na
  všetky requesty naraz, takže visí dlho, aj keď väčšina dát je už na
  obrazovke. Región Vercel vs. Atlas sa ukázal ako nesúvisiaci — funkcia je
  už fixovaná na jeden región (`iad1`).
- ✅ **staleTime 5 min** pre kategórie/lokality/stavy majetku/organizáciu
  (`api-hooks.ts`, `organisations-hooks.ts`) — `members` (beneficiary
  picker) zámerne vynechané, kvôli ADR-0034 (predpripravený člen musí byť
  hneď použiteľný).
- ✅ **Vercel Cron keep-warm** na `GET /health/ready` každé 4 min
  (`apps/api/vercel.json`) — existujúci endpoint, pingne aj Mongo.
- Nasadené, oba deploy `READY`, žiadne nové runtime chyby.

**Otvorené:** subjektívne overiť o pár dní, či sa frekvencia zlepšila. Ak
pretrváva: zvážiť obmedzenie overlay len na kritické requesty (väčšia UX
zmena, vedomne odložené).

---

## Aktuálny stav (2026-07-14, pokračovanie) — ADR-0034: predpríprava budúceho používateľa — K1–K5 HOTOVÉ, K6 čiastočne

Session log: `docs/sessions/2026-07-14-adr-0034-predpripravit-buduceho-pouzivatela.md`.
ADR: `docs/decisions/0034-domain-restricted-pre-provisioned-members.md`. Commity:
`b2b2555` (ADR), `ff0df47` (K1–K4: schema, endpoint, `hasLoggedIn`, UI + bugfix
ASSET_MANAGER prístupu na stránke Pozvánky), `6d5e388` (K5: testy).

Janikov návrh: správca majetku vie vopred pridať budúceho zamestnanca so známou
firemnou e-mailovou adresou (organizácia s `DOMAIN_RESTRICTED` + `autoJoinDomains`),
aby mu mohol schváliť a pripraviť výbavu ešte pred nástupom.

- ✅ **Nový endpoint `POST /v1/memberships/pre-provisioned`** (ASSET_MANAGER/ADMIN) —
  vytvorí `User` + `Membership` (ACTIVE, EMPLOYEE) pre zadanú firemnú adresu.
  Znovupoužité bez zmeny: `attemptDomainAutoJoin` (merge pri prvom SSO prihlásení) a
  `assertBeneficiaryIsActiveMember` (gatekeeper v žiadostiach o výpožičku).
- ✅ **UI** — sekcia „Pridať budúceho používateľa" na stránke Pozvánky, odznak
  „Očakáva nástup" v zozname Používatelia namiesto dátumu prihlásenia.
- ✅ **Bug fix mimo rozsahu, nájdený počas práce:** stránka Pozvánky gatovala
  prístup len na ADMIN, hoci `POST /v1/invitations` už dnes povoľuje aj
  ASSET_MANAGER — opravené novým `useCanManageMembers()` hookom.
- ✅ **Testy (K5)** — RBAC, validácie, merge test (`attemptDomainAutoJoin`), happy-path
  beneficiary. `tsc`/`eslint` čisté v sandboxe, lokálne `pnpm test` **všetko
  zelené** (Janika potvrdila).
- ⚠️ **K6 čiastočne hotové:** user-guide návod
  (`docs/user-guide/how-to/pridat-buduceho-pouzivatela.md`) a tento session doc
  hotové. **OpenAPI export + `api-types.ts` regen ostal ako lokálny krok** —
  sandbox nemá funkčný natívny `esbuild` binár pre `tsx` (rovnaký dôvod ako
  `vitest` v K5). Príkazy v session logu vyššie.

**Otvorené:** lokálny `pnpm --filter @inventario/api openapi:export:offline` +
`pnpm --filter web generate:api-types` + commit; report „predpripravení členovia
bez prihlásenia > 90 dní" pre ADMIN (zvážiť neskôr, nie súčasť K1–K6).

---

## Aktuálny stav (2026-07-14) — QR obrázok s logom, dependabot PR, prod incident, Zebra UI + záložky — VŠETKO HOTOVÉ

Session log: `docs/sessions/2026-07-14-qr-obrazok-dependabot-incident-zebra-ui.md`.
Commity: `654d9d2` (QR obrázok s logom), `c048a64`/`6b82884`/`6f1d26a`/`7b0c54d`
(dependabot PR #9–#12), `5e40c25` (incident fix), `480586c` (ADR-0027 write path),
`014f0b7` (Zebra návod), `9261a99` (Zebra UI prepínač), `0b29eef` (záložky
v Nastaveniach), `54d6e67` (Zebra návod aktualizovaný na UI riešenie).

- ✅ **QR obrázok s logom a textom — nasadené.** `GET /v1/assets/:id/qr`
  vracia kompozitný PNG/SVG (logo + inventárne číslo + názov) namiesto
  holého QR kódu, cez `@napi-rs/canvas`.
- ✅ **4 dependabot PR zlúčené** (#9–#12), vrátane opravy `format:check`
  po prettier bumpe.
- ✅ **INCIDENT vyriešený (`5e40c25`).** `@fastify/cookie` 11.1.1 (PR #12)
  pritiahol ESM-only `cookie@2.0.1` → plný výpadok API na produkcii
  (`ERR_REQUIRE_ESM` na každom cold starte). Pripnuté na presnú `11.0.2`.
  **Trvalé poučenie:** po každom npm/yarn dependabot merge overiť
  `get_runtime_logs` na produkcii do 1–2 minút, nielen CI status.
- ✅ **ADR-0027 gap doplnený (`480586c`).** `labelPrinting.mode` nemal
  žiadny write path — PATCH `/v1/organisations/current` ho ticho
  stripoval. Celá ZEBRA_ZPL vetva bola napriek hotovému backendu/frontendu
  v produkcii nedosiahnuteľná. Opravené, integračný test doplnený.
- ✅ **Zebra UI prepínač (`9261a99`) + záložky v Nastaveniach (`0b29eef`)
  — nasadené.** `/settings/organisation` má teraz bežný prepínač na
  Zebra ZPL tlač (štruktúrované polia, nie Swagger) a sekcie od
  "Základné údaje" po koniec sú na desktope v 5 záložkách (mobile pod
  sebou ako doteraz).
- ✅ **Zebra návod aktualizovaný (`54d6e67`)** na nové UI riešenie.

**Otvorené:** živý test na hardvéri (ZD420 + Browser Print) — softvérová
blokačka je odstránená, ale fyzický test (QR čitateľnosť, diakritika,
sýtosť) ešte neprebehol. Návod: `docs/user-guide/how-to/vytlacit-qr-kody-zebra.md`.

---

## Aktuálny stav (2026-07-07) — číselník Tagov + Audit log pre správcov — OBOJE HOTOVÉ

Session log: `docs/sessions/2026-07-07-tagy-ciselnik-audit-log.md`. Commity:
`17ce25e`/`7b76b2bf` (Tagy backend/frontend), `310ae5b`/`08abcd7` (Audit
log backend/frontend).

- ✅ **Číselník "Tagy" — nasadené.** Nová záložka v Číselníky: zoznam
  tagov s počtom použitia, premenovanie (server zlúči duplicity),
  mazanie zo všetkého majetku. RBAC výnimka: mazanie tu ASSET_MANAGER+ADMIN
  (nie len ADMIN ako pri Kategóriách/Lokalitách).
- ✅ **Audit log pre správcov — nasadené.** Nová stránka `/audit-log` +
  menu položka (managerOnly). Tenant-wide, filtrovateľné (akcia, typ
  entity, osoba, dátumový rozsah), stránkované, len prehľadávanie
  (žiadny export v v1). RBAC: ASSET_MANAGER + ADMIN (rozšírené na
  žiadosť Janiky, pôvodne plánované len ADMIN).
- ✅ Tenant scoping oboch featur overený a zdokumentovaný na výslovnú
  žiadosť Janiky (`tenantFilter`/`organisationId` filter v oboch
  repozitároch + existujúci globálny cache-invalidate pri prepnutí
  tenanta na frontende).
- ✅ **Dodatočný bug fix (`db15c3c`), nasadené.** Filtre v Audit logu
  (napr. `entityType=Membership`, konkrétna osoba) hádzali 500 —
  37 legacy `audit_logs` dokumentov z júna 2026 (10 typov akcií) malo
  starší tvar bez `at`/`description`/`actor.displayName`/
  `actor.accountType`. Opravené defenzívnym `toEntryResponse()` pri
  čítaní (fallbacky), historické dáta NEDOTKNUTÉ — audit log je
  append-only, viď zásada nižšie.

**Dôležitá trvalá zásada (Janika, 2026-07-07):** Audit log sa nikdy
nemení ani nemaže z aplikačnej úrovne — ani pri oprave bugov s tvarom
starých záznamov. Riešenie je vždy na strane čítania (response
mapovanie/fallbacky), nikdy backfill/update/delete v `audit_logs`
kolekcii. Zapísané do trvalej pamäte.

**Otvorené:** živé odskúšanie filtrov na produkcii po tomto fixe;
budúci CSV export z Audit logu (zámerne mimo v1).

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
