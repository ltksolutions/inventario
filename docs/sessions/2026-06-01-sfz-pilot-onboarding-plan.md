<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Plán — SFZ pilot onboarding

**Dátum:** 2026-06-01
**Model:** Claude Opus 4.8 (strategický plán)
**Status:** návrh — pred realizáciou prejsť a potvrdiť

---

## Východiská (z analýzy kódu, nie z dohadov)

Pred plánovaním som prešiel `registration.routes.ts` a `oauth.routes.ts`. Dôležité zistenie:

**Self-serve registračný flow už existuje a je hotový.** `POST /v1/auth/register` aj OAuth callback vytvoria org + ADMIN usera + membership + DPA súhlas. Multi-tenant Microsoft je správne nastavený (`MicrosoftEntraId('organizations', ...)` — prijme akékoľvek pracovné konto, nie len jeden konkrétny Entra tenant). Google funguje. Email s verifikáciou funguje. **Apple vracia 503** (neimplementované).

Z toho plynie: "komplikované na Entra" nie je o chýbajúcom kóde. Je to o **konfigurácii a overení** — či sú OAuth credentials nastavené na prod a či flow reálne dobehne od kliknutia po prihlásenie. Plán je preto postavený na overovaní, nie na novom vývoji.

### Zámer (potvrdené s Janom)

- **Vznik tenanta:** self-serve registráciou cez email / Google / Microsoft pracovné konto (nie manuálny admin create)
- **Dáta:** zmiešané — zopár reálnych položiek majetku na overenie, nie celý sklad naraz
- **Používateľ v pilote:** 1 človek, technicky zdatný admin

---

## Fáza 0 — Overenie predpokladov (PRED kontaktom so SFZ)

Cieľ: uistiť sa, že self-serve flow reálne funguje end-to-end, než pozveme reálneho človeka. Lacné teraz, drahé keď to padne pred zákazníkom.

### 0.1 Audit prod konfigurácie OAuth

Skontrolovať vo Vercel → inventario-api → Environment Variables, či sú nastavené:

- `OAUTH_STATE_SECRET` (min 32 chars) — bez neho sa OAuth routes vôbec nezaregistrujú
- `OAUTH_REDIRECT_BASE_URL` — napr. `https://api.inventario.estate/v1/auth/callback`
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`
- `MICROSOFT_CLIENT_ID` + `MICROSOFT_CLIENT_SECRET`
- `FRONTEND_BASE_URL` — `https://app.inventario.estate`
- `EMAIL_PROVIDER` = `ecomail` (alebo `resend`) + príslušný API key — inak verifikačný email nedôjde

**Ako overiť že OAuth je naozaj zapnutý:** server pri štarte loguje `OAUTH_STATE_SECRET / OAUTH_REDIRECT_BASE_URL not set — OAuth routes skipped.` ak chýbajú. Skontrolovať Vercel Runtime Logs, alebo otestovať `GET /v1/auth/login/microsoft` — ak vráti redirect na login.microsoftonline.com, je to OK; ak 404/503, chýba konfig.

### 0.2 Provider-side redirect URI

V Google Cloud Console aj v Azure App Registration musí byť redirect URI presne:

- `https://api.inventario.estate/v1/auth/callback/google`
- `https://api.inventario.estate/v1/auth/callback/microsoft`

Toto je častý dôvod prečo OAuth padne až v callbacku — provider odmietne mismatched URI. Overiť pred testom.

### 0.3 Testovacia registrácia na vlastnom konte

Než pozveme SFZ, prejsť celý flow sám s čistým testovacím kontom (napr. súkromný Gmail alebo testovací email):

1. `/register` na `app.inventario.estate` → vyplniť org „Test Org", email, vybrať Microsoft/Google
2. Prejsť OAuth súhlasom
3. Overiť redirect na `/onboarding`
4. Overiť že vznikol org + ADMIN user + membership (Atlas / `GET /v1/me`)
5. Pre email variant: overiť že príde verifikačný email a link funguje

**Ak čokoľvek padne tu, STOP** — opraviť pred SFZ. Toto je celý zmysel Fázy 0.

### 0.4 Rozhodnutie o Apple

Apple Sign-In vracia 503. Pre SFZ pilot (1 admin, Microsoft/Google/email stačí) **nie je blocker**. Rozhodnutie: Apple odložiť, na `/register` ho buď skryť alebo nechať s jasnou hláškou „čoskoro". Neriešiť teraz.

---

## Fáza 1 — Príprava tenanta (deň onboardingu)

### 1.1 Spôsob vzniku — dve cesty, vybrať jednu

**Cesta A (preferovaná, self-serve):** SFZ admin si sám prejde `/register` s pracovným kontom `inventario@futbalsfz.sk`. Výhoda: testuje reálny flow ktorý budú používať aj ďalší tenanti. Nevýhoda: ak flow nie je 100% hladký, prvý dojem trpí.

**Cesta B (asistovaná):** Ty prejdeš registráciu spolu s ním (screen share / osobne), alebo ho pozveš cez existujúci invite flow. Bezpečnejšie pre prvý dojem.

> **Odporúčanie:** Cesta A, ale s tebou „po ruke" (call/osobne). Tým otestuješ reálny flow a zároveň zachytíš problém v momente keď nastane. Po úspešnom pilote sa Cesta A stane plne samoobslužnou.

### 1.2 Po registrácii — základná konfigurácia orgu

Nový org vznikne s rozumnými defaultmi (`plan: FREE`, `memberJoinPolicy: INVITE_ONLY`, všetky auth providery povolené). Po prihlásení admin nastaví:

- Org displayName / branding (ak treba odlíšiť od „compatible with sportup.sk")
- `inventoryNumberFormat` — formát inventárnych čísel SFZ (ADR-0021)
- Voliteľne `foundContactInfo` + `publicAssetLookup` ak chcú QR scan funkciu
- Taxonómia: auto-seed default typov/podmienok/kategórií prebehne automaticky (single source of truth v `taxonomy-defaults.ts`) — admin ich len prispôsobí

---

## Fáza 2 — Prvé reálne dáta (overovací beh)

Cieľ: dokázať že systém zvládne reálny majetok SFZ, bez tlaku na úplnosť.

### 2.1 Zopár reálnych položiek

Admin pridá 5–10 reálnych kusov majetku — naprieč rôznymi kategóriami (napr. športové vybavenie, IT, kancelária). Overiť:

- Vytvorenie assetu + auto-generovanie inventárneho čísla
- Priradenie kategórie / lokality / typu / stavu
- QR kód na detaile (ADR-0021) — vygenerovať, vytlačiť jeden štítok, naskenovať
- Verejný scan (ak zapnutý `publicAssetLookup`)

### 2.2 Jeden výpožičkový cyklus (ak relevantné pre SFZ)

Ak SFZ majetok požičiava (čo je pravdepodobné — športové vybavenie klubom), prejsť jeden cyklus: request → approve → pickup → return. Overí to loans state machine na reálnom prípade.

> **Pozn.:** preberacie protokoly (PDF, ADR-0022) ešte nie sú implementované. Ak SFZ trvá na podpísanom protokole pri výpožičke, je to signál prioritizovať #7 hneď po pilote. Pilot to ukáže — preto sa loans testuje.

---

## Fáza 3 — Feedback a vyhodnotenie

### 3.1 Štruktúrovaný feedback

Po týždni-dvoch reálneho používania zachytiť:

- Čo chýbalo / čo bolo mätúce v onboardingu
- Či `inventoryNumberFormat` sedí ich konvencii
- Či loans flow zodpovedá ich reálnemu procesu
- Či potrebujú preberacie protokoly (→ priorita #7)
- Výkon / rýchlosť na reálnom objeme dát

### 3.2 Rozhodovacie body po pilote

- **Apple Sign-In** — pýtal niekto? Ak nie, ostáva odložené.
- **PDF protokoly (#7)** — pilot ukázal potrebu? → ďalšia veľká feature.
- **Onboarding UX** — treba sprievodcu (wizard) po prvom prihlásení, alebo stačí prázdny dashboard + dokumentácia?
- **Multi-user** — pilot bol 1 admin; kedy pozvať ďalších členov SFZ (invite flow už existuje, K13/K18).

---

## Čo NIE je v rozsahu pilotu

Vedome odložené, aby pilot neutopil v scope:

- Apple Sign-In (503, neblokuje)
- PDF preberacie protokoly (#7 — pilot rozhodne o priorite)
- Bulk import majetku cez CSV (P4 #13)
- Pokročilé onboarding wizardy
- Druhý tenant / multi-tenant load test (email_unique fix už odblokoval, ale reálny druhý tenant až po pilote)

---

## Zhrnutie postupnosti

```
Fáza 0 (pred SFZ)   → over OAuth konfig + redirect URI + testovacia registrácia na vlastnom konte
       ↓ (ak zelené)
Fáza 1 (deň D)      → SFZ self-serve register (Cesta A, ty po ruke) + základná konfig orgu
       ↓
Fáza 2 (overenie)   → 5–10 reálnych položiek + QR scan + jeden loans cyklus
       ↓
Fáza 3 (1–2 týždne) → feedback → rozhodnutia (Apple? PDF protokoly? wizard? multi-user?)
```

**Kritický gate:** Fáza 0.3 (testovacia registrácia). Ak self-serve flow nedobehne hladko na vlastnom konte, nepozývaj SFZ — najprv oprav. Všetko ostatné je už v kóde hotové; pilot je o overení a vzťahu, nie o vývoji.

---

## Otvorené otázky na Jana (pred Fázou 1)

1. **Branding** — má pilot org vyzerať SFZ-špecificky, alebo generický Inventario s „compatible with sportup.sk"?
2. **Loans v pilote** — požičiava SFZ majetok externe (kluby), alebo je to čisto interná evidencia? Určuje či Fáza 2.2 je relevantná.
3. **Termín** — kedy reálne chceš spustiť? Fáza 0 je ~pol dňa práce.
