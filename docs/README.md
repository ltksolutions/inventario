# Dokumentácia projektu

Tento adresár obsahuje všetku projektovú dokumentáciu. Dokumentácia je verzovaná spolu s kódom – akákoľvek zmena prechádza cez Pull Request.

## Štruktúra

```
docs/
├── functional-spec.md          # Funkčná špecifikácia (hlavný dokument)
├── TODO.md                      # Implementačný backlog (čo treba dorobiť)
├── architecture/               # Architektonické dokumenty
│   ├── README.md               # Prehľad architektúry + tech rozhodnutia
│   ├── data-model.md           # MongoDB kolekcie a vzťahy
│   └── mcp-server.md           # Špecifikácia MCP servera (Slice #10)
├── api/
│   ├── openapi.yaml            # OpenAPI 3.1 špecifikácia
│   └── README.md               # Pravidlá API designu
├── decisions/                  # Architecture Decision Records (ADR, 30+)
│   ├── README.md
│   ├── template.md             # Šablóna pre nové ADR
│   └── 00xx-*.md               # jednotlivé rozhodnutia
├── user-guide/                 # Používateľská príručka (getting-started, how-to, reference, use-cases)
├── compliance/                 # GDPR (ROPA, DPA, DPIA), retencia, security/privacy, sub-procesori
├── milestones/                 # Slice-by-slice milestone dokumenty
├── sessions/                   # Pracovné session plány + denné súhrny (NEXT.md = aktuálny stav)
├── marketing-site/             # inventario.estate (statický web) + /screenshots
└── assets/                     # Brand assety, obrázky
```

## Konvencie

- **Markdown** ako primárny formát, s podporou Mermaid diagramov.
- **Diagramy** prednostne v Mermaid (renderované priamo v GitHube/GitLabe). Pre zložité diagramy (C4) možno použiť PlantUML alebo Draw.io (uložené aj ako SVG/PNG do `assets/`).
- **Slovenčina** v dokumentoch, **angličtina** v identifikátoroch, kóde a OpenAPI.
- Každý dokument má v hlavičke: verziu, status, dátum poslednej aktualizácie.

## Live dokumenty vs. archivované

Dokumenty v `docs/` sú **live** – aktualizujú sa s vývojom projektu. Konkrétne snapshoty pre formálne schválenia (napr. „verzia odovzdaná vedeniu") sa exportujú ako PDF do priečinka `docs/releases/` (pridáme podľa potreby).
