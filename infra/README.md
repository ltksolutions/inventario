# Lokálna infraštruktúra

Tento adresár obsahuje konfiguráciu pre lokálne dev prostredie Inventario.

## Štart

```bash
# Z koreňa repa
docker compose -f infra/docker-compose.yml up -d
```

## Čo sa spustí

| Služba            | Port              | Web UI                | Účel                         |
| ----------------- | ----------------- | --------------------- | ---------------------------- |
| **MongoDB**       | 27017             | –                     | Hlavná databáza              |
| **Mongo Express** | 8081              | http://localhost:8081 | Web UI pre prehliadanie DB   |
| **MailHog**       | 1025 (SMTP), 8025 | http://localhost:8025 | Fake SMTP server pre e-maily |

## Predvolené prihlasovacie údaje

> ⚠️ **Tieto údaje sú LEN pre lokálny vývoj!** Nikdy ich nepoužívaj v produkcii.

- **MongoDB**: `admin` / `changeme-local-only`

Údaje môžeš prepísať cez environment premenné v `.env` súbore v koreni repa.

## Object storage tu nie je

Prílohy a logá tenantov idú do **Vercel Blob** (`@vercel/blob`, token
`BLOB_READ_WRITE_TOKEN`) — viď `apps/api/src/modules/attachments/`.
Lokálny vývoj proti nemu potrebuje ten token, nie kontejner.

MinIO tu bežal do 2026-09-01 ako S3-kompatibilná náhrada, ale žiadny kód
ho nepoužíval — buckety `sfz-asset-attachments` a `sfz-asset-protocols`
sa vytvárali naprázdno. Ak by sa object storage niekedy vracal k S3,
konfigurácia je v git histórii.

## Bežné príkazy

```bash
# Stop, ale zachovať dáta
docker compose -f infra/docker-compose.yml down

# Stop + vymazať dáta (čistý reset)
docker compose -f infra/docker-compose.yml down -v

# Logy
docker compose -f infra/docker-compose.yml logs -f mongodb

# Pripojenie k Mongo cez shell
docker exec -it sfz-mongodb mongosh -u admin -p changeme-local-only

# Reštart jednej služby
docker compose -f infra/docker-compose.yml restart mongodb
```

## Mongo init skripty

Adresár `mongo-init/` (TODO: vytvoriť) obsahuje JavaScript súbory, ktoré sa spustia
pri prvom štarte MongoDB containera. Sem patria:

- Vytvorenie databázy `sfz_asset_management`
- Vytvorenie indexov (textový search, unique constraints)
- Vytvorenie `$jsonSchema` validátorov (generovaných z `packages/shared-types/`)
- Seed dát pre dev/test prostredie

## Produkcia

V produkcii **nepoužívame docker-compose**. Pre produkčné deploy:

- **MongoDB** → MongoDB Atlas (managed, podľa ADR-0003)
- **Object storage** → Azure Blob Storage alebo AWS S3
- **E-maily** → SendGrid, AWS SES alebo Microsoft Graph API
- **Aplikácie** → Azure App Service / Kubernetes (TBD, viď ADR)
