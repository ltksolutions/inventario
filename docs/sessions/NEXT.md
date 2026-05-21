# NEXT — čo robiť v ďalšej session

## Stav: Slice #6c K17/K19/K20 DOKONČENÉ, K17.5 commit pripravený, K18 design hotový (2026-05-20)

Cookie-based auth je end-to-end funkčné. Entra Bearer path je preč.
Email provider abstrakcia (Ecomail + Resend + stub) je implementovaná
a čaká na finálny commit. Architektúrny plán pre K18 invite flow je
v `docs/sessions/2026-05-20-slice-6c-k18-design.md`.

### Čo bolo urobené dnes (2026-05-20)

- **K17** Entra Bearer cutover — `auth.ts` čisto cookie, 21
  integration test súborov prepísaných z Bearer na cookie, plugin
  order opravený (inventarioJwt pred auth)
- **K19** Silent token refresh — `api-client.ts` middleware zachytí
  401, zavolá `/v1/auth/refresh`, retry. Singleton promise proti
  concurrent refresh.
- **K20** Chýbajúce auth stránky — `/register/verify-email`,
  `/forgot-password`, `/reset-password`
- **K17.5** Platform email provider abstrakcia — Ecomail.cz +
  Resend.com + stub. Nodemailer/SMTP plne odstránené.
- **K18 design** — kompletný architektúrny plán v
  `docs/sessions/2026-05-20-slice-6c-k18-design.md`

Detailný session log: `docs/sessions/2026-05-20-night-slice-6c-progress.md`

---

## ⚠️ Pred ďalšou session

1. **Overiť commit K17.5** — súbory na disku sú pripravené, pre-commit
   hook (eslint + typecheck) musí prejsť. Ak commit ešte nebol urobený:

   ```
   feat(api): platform email provider abstraction — ecomail + resend + stub
   ```

   (detailný body v session messages)

2. **Prepnúť model na Sonnet 4.6** pred štartom K18 implementácie.
   K18 je CRUD endpoints + frontend forms = Sonnet territory.
   Strategické rozhodnutia sú uzavreté v design dokumente.

---

## Ďalší krok: Slice #6c K18 — Invite flow

### Vstupný bod pre Sonnet session

Otvoriť `docs/sessions/2026-05-20-slice-6c-k18-design.md` ako prompt
context. Dokument obsahuje:

- Scope summary + out-of-scope list
- 5 kľúčových architektúrnych rozhodnutí (s reasoning)
- Data model — reuse existujúceho `User` documentu (žiadna nová collection)
- API endpoint contracts (request/response shapes)
- Audit events list
- Test plan (~30 nových testov, cieľ ~290 total)
- Implementation breakdown na 7 sub-slíc

### Plán implementácie (3 sessions)

**Session 1 — Backend (K18.1–K18.4):**

- K18.1: `POST/GET/DELETE /v1/invitations` + `Organisation.settings.invitations.enforceAllowedDomains` flag + audit events
- K18.2: `GET /v1/auth/invitations/:token` + `POST /v1/auth/accept-invitation` (password path)
- K18.3: OAuth state extension (`invitationToken` v signed state) + accept via existing OAuth callbacks
- K18.4: `sendInvitationEmail` template + HTML
- ~30 nových integration testov

**Session 2 — Frontend (K18.5–K18.6):**

- K18.5: `/accept-invite` public page (preview + password form + OAuth buttons)
- K18.6: `/settings/invitations` admin page (send form + pending list + revoke)

**Session 3 — Wrap-up (K18.7 + K21):**

- K18.7: Milestone doc `docs/milestones/slice-6c-k18-invitations.md`
- K21: Slice #6c celkový milestone doc (auth migration story od #6a po K18)

---

## Po Slice #6c → Pilot tenant onboarding

Slice #6c uzatvára auth migráciu. Ďalej:

- **Pilot tenant onboarding** — onboard prvý reálny tenant (SFZ).
  `Organisation.settings` config (allowedDomains, brandKit, plan),
  prvý ADMIN user, sandbox dáta na overenie loans flow end-to-end.
- **DPIA finalizácia** — Data Protection Impact Assessment dokument
  pred pilotom (compliance pre EUPL/GDPR open-source distribúciu).

---

## Poznámky / odložené veci

- **Cross-tenant invites** — užívateľ existujúci v inom tenante
  pozvaný do druhého tenantu. Vyžaduje refactor
  `User.organisationId: string` na User ↔ Organisation many-to-many
  (Memberships table). Vlastný slice, nie v K18.
- **Email change v user profile** — invitee chce zmeniť email po
  accepte z osobného na firemný. Separátny feature s vlastným email
  verification flow. Nie v K18.
- **Per-tenant email provider override** — každý tenant si nastaví
  vlastný Ecomail/Resend account v `Organisation.settings.email`.
  Pridá sa keď nastúpi prvý tenant ktorý si to bude vyžadovať
  (white-label so „From: noreply@sfz.sk").
- **Apple Sign-In (K4)** — čaká na Apple Developer account. ~2h práce
  keď bude pripravený (arctic provider + callback handler).
- **Per-email exception list** pre domain policy — `Organisation.settings.invitations.exceptions: string[]`. Umožní pozvať konkrétne emaily mimo whitelistu bez vypnutia `enforceAllowedDomains`.
  Pridá sa keď SFZ pilot reálne narazí na externých dodávateľov.

---

## Šablóna pre zajtrajší štart

```
Pokračujeme v Slice #6c — implementácia K18 invite flow.

Najprv overiť že K17.5 commit (email provider abstrakcia) prešiel.
Ak nie, spustiť pre-commit + commit s message:
  feat(api): platform email provider abstraction — ecomail + resend + stub

Potom otvoriť docs/sessions/2026-05-20-slice-6c-k18-design.md ako
plán a začať K18.1: backend POST/GET/DELETE /v1/invitations +
enforceAllowedDomains flag + audit events.

Model: Sonnet 4.6 (CRUD endpoints + tests).
```
