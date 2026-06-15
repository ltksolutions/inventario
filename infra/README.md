# Lokálna infraštruktúra

Tento adresár obsahuje konfiguráciu pre lokálne dev prostredie Inventario.

## Štart

```bash
# Z koreňa repa
docker compose -f infra/docker-compose.yml up -d
```

## Čo sa spustí

| Služba            | Port              | Web UI                | Účel                           |
| ----------------- | ----------------- | --------------------- | ------------------------------ |
| **MongoDB**       | 27017             | –                     | Hlavná databáza                |
| **Mongo Express** | 8081              | http://localhost:8081 | Web UI pre prehliadanie DB     |
| **MailHog**       | 1025 (SMTP), 8025 | http://localhost:8025 | Fake SMTP server pre e-maily   |
| **MinIO**         | 9000 (API), 9001  | http://localhost:9001 | S3-kompatibilný object storage |

## Predvolené prihlasovacie údaje

> ⚠️ **Tieto údaje sú LEN pre lokálny vývoj!** Nikdy ich nepoužívaj v produkcii.

- **MongoDB**: `admin` / `changeme-local-only`
- **MinIO**: `minioadmin` / `changeme-local-only`

Údaje môžeš prepísať cez environment premenné v `.env` súbore v koreni repa.

## Predvolené MinIO buckety

Pri prvom štarte sa automaticky vytvoria:

- `sfz-asset-attachments` – nahrané prílohy (fotky, dokumenty)
- `sfz-asset-protocols` – generované PDF protokoly o odovzdaní/vrátení

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
