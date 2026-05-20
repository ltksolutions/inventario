<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# DNS setup pre `inventario.estate`

> **Cieľ:** Nasmerovať `inventario.estate` a subdomény na Vercel hosting.
> **Predpokladaná dĺžka:** 15–30 minút setup + 5–60 minút DNS propagácia
> **Status:** Aktívny (migrované z `inventario.sportup.sk` — máj 2026)

---

## 📋 Prehľad domén

| Doména                   | Vercel projekt        | Účel                                    |
| ------------------------ | --------------------- | --------------------------------------- |
| `inventario.estate`      | marketing-site        | Marketing landing page (redirect → www) |
| `www.inventario.estate`  | marketing-site        | Marketing landing page                  |
| `app.inventario.estate`  | asset-management-web  | Next.js frontend                        |
| `api.inventario.estate`  | asset-management-api  | Fastify REST API                        |
| `docs.inventario.estate` | asset-management-docs | Nextra dokumentácia                     |

---

## 🎯 Krok 1 — DNS záznamy

Pridaj tieto záznamy u registrátora / v Cloudflare:

```
# Marketing site
Type: CNAME   Name: www       Value: cname.vercel-dns.com   TTL: Auto
Type: CNAME   Name: @         Value: cname.vercel-dns.com   TTL: Auto
  (niektorí registrátori nepodporujú CNAME na apex — použi A: 76.76.21.21)

# App frontend
Type: CNAME   Name: app       Value: cname.vercel-dns.com   TTL: Auto

# API backend
Type: CNAME   Name: api       Value: cname.vercel-dns.com   TTL: Auto

# Dokumentácia
Type: CNAME   Name: docs      Value: cname.vercel-dns.com   TTL: Auto
```

> **Cloudflare users:** Proxy status = **DNS only** (sivé oblako) — nie Proxied.
> Vercel má vlastný CDN a potrebuje priamy prístup pre SSL overenie.

---

## 🎯 Krok 2 — Vercel projekty — pridaj domény

### Project: `asset-management-api` (Fastify)

Settings → Domains → Add: `api.inventario.estate`

Aktualizuj aj **Environment Variables**:

```
FRONTEND_BASE_URL       = https://app.inventario.estate
OAUTH_REDIRECT_BASE_URL = https://api.inventario.estate/v1/auth/callback
CORS_ORIGINS            = https://app.inventario.estate
EMAIL_FROM              = Inventario <noreply@inventario.estate>
```

### Project: `asset-management-web` (Next.js)

Settings → Domains → Add: `app.inventario.estate`

Aktualizuj **Environment Variables**:

```
NEXT_PUBLIC_API_BASE_URL = https://api.inventario.estate
```

### Project: `asset-management-docs` (Nextra)

Settings → Domains → Add: `docs.inventario.estate`

### Project: `inventario-marketing` (Marketing site)

Settings → Domains → Add: `www.inventario.estate`, `inventario.estate`

---

## 🎯 Krok 3 — OAuth redirect URIs

### Google Cloud Console

https://console.cloud.google.com → APIs & Services → Credentials → OAuth 2.0 Client

**Authorized redirect URIs** — pridaj:

```
https://api.inventario.estate/v1/auth/callback/google
```

### Microsoft Azure (Entra ID)

https://portal.azure.com → App registrations → SFZ API / Inventario API

**Redirect URIs** — pridaj:

```
https://api.inventario.estate/v1/auth/callback/microsoft
```

> Staré `inventario.sportup.sk` URI môžeš nechať aktívne počas prechodu alebo odstrániť po migrácii.

---

## ⏳ Overenie DNS propagácie

```bash
# Skontroluj všetky subdomény
dig app.inventario.estate CNAME +short
# Expected: cname.vercel-dns.com.

dig api.inventario.estate CNAME +short
# Expected: cname.vercel-dns.com.

dig www.inventario.estate CNAME +short
# Expected: cname.vercel-dns.com.
```

Online: https://www.whatsmydns.net/#CNAME/api.inventario.estate

---

## 🧪 Finálna verifikácia

```bash
# API health check
curl -I https://api.inventario.estate/health
# HTTP/2 200

# Frontend
curl -I https://app.inventario.estate
# HTTP/2 200

# SSL certifikát
echo | openssl s_client -connect api.inventario.estate:443 2>/dev/null \
  | openssl x509 -noout -issuer -dates
# Issuer: Let's Encrypt | platnosť 90 dní od dnešného dátuma
```

---

## 🔄 Migrácia z `inventario.sportup.sk`

Staré domény môžeš nechať v Vercel a nastaviť 301 redirect na nové:

- `app.inventario.sportup.sk` → `app.inventario.estate`
- `api.inventario.sportup.sk` → `api.inventario.estate`

Alebo ich jednoducho odstrániť z Vercel projects — záleží na tom, či máš existujúcich používateľov.

---

## 🆘 Troubleshooting

### "Invalid Configuration" vo Vercel

1. `dig api.inventario.estate CNAME +short` — overí DNS
2. Ak vracia `cname.vercel-dns.com.` ale Vercel stále červený → počkaj 5–15 min
3. Vercel UI → Domain → Refresh

### SSL "Pending"

- DNS musí propagovať pred SSL vystavením
- Cloudflare proxy (oranžové oblako) blokuje Let's Encrypt → prepni na DNS only

### Apex doména CNAME problem

Niektorí registrátori nepodporujú CNAME na `@` (root). Použi A záznam:

```
Type: A   Name: @   Value: 76.76.21.21
```

---

**Last updated:** 20. máj 2026 — Migrácia na inventario.estate
