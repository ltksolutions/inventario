<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Vlastná Microsoft aplikácia — nastavenie

Tento návod popisuje, ako nastaviť vlastnú Azure App Registration pre
Microsoft prihlásenie členov organizácie v Inventario (ADR-0031).

## Kedy to potrebujem?

Štandardne Inventario používa platformovú Microsoft aplikáciu LTK Solutions
pre všetkých tenantov. Vlastná aplikácia je vhodná ak:

- Vaše IT oddelenie vyžaduje admin consent v rámci vlastného Azure adresára.
- Chcete mať audit Microsoft prihlásení vo svojom Azure Portal.
- Chcete izolovať bezpečnostné incidenty — kompromitácia secretu jedného
  tenanta neovplyvní ostatných.

## Postup v Azure Portal

1. Prihláste sa na [portal.azure.com](https://portal.azure.com).

2. Prejdite na **Entra ID → App registrations → New registration**.

3. Vyplňte:
   - **Name**: ľubovoľný (napr. `Inventario – Slovenský futbalový zväz`)
   - **Supported account types**: _Accounts in this organizational directory only_
     (pre firemné kontá), alebo _Accounts in any organizational directory_
     (pre viacero adresárov / partnerov)
   - **Redirect URI**: Web →
     ```
     https://api.inventario.estate/v1/auth/callback/microsoft
     ```

4. Po vytvorení si poznačte **Application (client) ID** z Overview.

5. Prejdite na **Certificates & secrets → New client secret**:
   - Vyberte platnosť (odporúčame 24 mesiacov).
   - Poznačte si **Value** — viditeľný len raz po vytvorení.

## Nastavenie v Inventario

1. Prihláste sa ako Administrátor organizácie.
2. Otvorte **Nastavenia → Prihlasovanie a domény** (`/settings/auth`).
3. V sekcii **Microsoft aplikácia (vlastná)** kliknite **Nastaviť vlastnú aplikáciu**.
4. Vyplňte:
   - **App (client) ID**: hodnota z Azure Portal → Overview
   - **Client secret**: hodnota z Certificates & secrets (len pri prvom nastavení
     alebo rotácii — spätne nie je viditeľný)
   - **Tenant mode**: vyberte podľa potreby
5. Kliknite **Uložiť nastavenia**.

## Rotácia client secret

Keď vyprší platnosť secretu v Azure:

1. V Azure Portal vytvorte nový client secret.
2. V Inventario (`/settings/auth`) kliknite **Upraviť aplikáciu**.
3. Zadajte nový secret do poľa **Client secret** (existujúci clientId ponechajte).
4. Uložte — starý secret bude prepísaný.

> **Tip:** Nastavte si pripomienku 30 dní pred vypršaním platnosti secretu.

## Odstránenie vlastnej aplikácie

Kliknite **Odstrániť vlastnú aplikáciu** v sekcii Microsoft aplikácia.
Po uložení sa Microsoft prihlásenie vráti na platformovú aplikáciu Inventario.

## Bezpečnostné poznámky

- Client secret sa ukladá **zašifrovaný** (AES-256-GCM) — nie je nikdy
  uložený v plaintexte ani vrátený cez API.
- Po uložení nie je secret spätne viditeľný — uchovajte si ho na bezpečnom
  mieste pred uložením.
- Vlastná app izoluje blast-radius: kompromitácia platformového secretu
  neovplyvní vašich členov a naopak.
