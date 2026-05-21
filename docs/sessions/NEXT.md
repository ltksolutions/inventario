# NEXT — čo robiť v ďalšej session

## Stav: Slice #7 TOTP MFA DOKONČENÝ (2026-05-21)

480 testov. Email-password users môžu aktivovať TOTP MFA v
`/settings/security`. Login flow vracia 202 + mfaSessionToken keď
je MFA aktívne, frontend zbiera TOTP/recovery code na `/login/mfa`.

Milestone doc: `docs/milestones/slice-7-totp-mfa.md`

---

## Ďalší krok: Pilot tenant onboarding (SFZ)

Auth + security feature set je kompletný pre pilot. Pred onboardingom
prvého reálneho tenanta:

### Checklist pred pilotom

1. **DPIA finalizácia** — Data Protection Impact Assessment pre GDPR/EUPL.
   Odporúčaný model: **Opus 4.7** (strategický compliance dokument).

2. **SFZ tenant konfigurácia:**
   - `autoJoinDomains: ['futbalsfz.sk', 'sfzmarketing.sk']`
   - `settings.invitations.enforceAllowedDomains: true`
   - `settings.mfa.policy: 'OPTIONAL'` (odporúčame, nie REQUIRED pre štart)
   - `allowedAuthProviders: ['MICROSOFT', 'EMAIL']` (SFZ používa M365)

3. **Prvý ADMIN user** — pozvánka na Ján Letko email cez `/settings/invitations`

4. **Sandbox dáta** — seed aktív, kategórií a lokácií pre demo

5. **Env vars na Vercel prod** — `MFA_SECRET_ENCRYPTION_KEY`, `ECOMAIL_API_KEY`

---

## Odložené veci (prioritizované)

### Priorita HIGH (pred pilotom alebo hneď po)

- **K18.3 OAuth invite accept** — invitee klikne "Prijať s Google/MS" na
  `/accept-invite`. Rozšírenie `oauth-state.ts` o `invitationToken` +
  úprava OAuth callback handleru. ~2–3h práce. Sonnet 4.6.

- **K18.7 + K21 Milestone docs** — K18 invite flow milestone + Slice #6c
  celkový milestone. Haiku 4.5, ~30 min.

### Priorita MEDIUM (po pilote)

- **Passkeys / WebAuthn (Slice #8)** — moderný passwordless login
  (Touch ID, Face ID, Windows Hello). Knižnice: `@simplewebauthn/server`
  - `@simplewebauthn/browser`. Nová `passkeys` kolekcia. Registration +
    authentication ceremony. ~2–3 dni práce. Opus 4.7 pre architektonický
    návrh, Sonnet pre implementáciu.

- **MFA REQUIRED policy enforcement** — ak `org.settings.mfa.policy === 'REQUIRED'`
  a user nemá MFA, forced setup po úspešnom logine. ~2h, Sonnet 4.6.

- **Admin MFA reset** — ADMIN môže deaktivovať MFA konkrétnemu userovi
  cez `/settings/users/:id` panel. Emergency path keď user stratí
  authenticator + recovery codes. ~1h, Sonnet 4.6.

- **Cross-tenant invites** — User ↔ Organisation many-to-many refactor
  (Memberships table). Vlastný slice, Opus 4.7 pre design.

- **Email change v user profile** — separate verification flow.

- **Per-tenant email provider override** — `Organisation.settings.email`.

- **Apple Sign-In (K4)** — čaká na Apple Developer account.

- **Per-email exception list** pre invitation domain policy —
  `Organisation.settings.invitations.exceptions: string[]`.

---

## Model routing pripomienka

| Task                                         | Model      |
| -------------------------------------------- | ---------- |
| DPIA, Passkeys architektura, pilot stratégia | Opus 4.7   |
| CRUD endpoints, tests, frontend pages, debug | Sonnet 4.6 |
| Milestone docs, scoped edits, cleanups       | Haiku 4.5  |
