# Energie-Kompass Pipeline

Quellenbasierte Monitoring-Pipeline für Energiepolitik. Sammelt öffentliche Quellen
(DIP, Lobbyregister, Behörden-RSS, Bundesrat, EUR-Lex, Fachpresse), normalisiert,
dedupliziert, reichert per Regeln + Claude API an, clustert nach Dossiers und erzeugt:

- `../src/data/data.js` — die vom (unveränderten) Frontend erwarteten Datenstrukturen
- `../briefings/YYYY-MM-DD.md` — tägliches quellenbasiertes Briefing mit Links/Zitaten

## Architektur

```
Quellen → fetchSince(cursor) → raw_documents → normalize() → normalized_documents
        → enrich (Regeln + Claude) → document_topics/entities → dossiers
        → project (DB + curated/*.json) → src/data/data.js
        → brief                         → briefings/YYYY-MM-DD.md
```

- **Storage:** SQLite über Nodes eingebautes `node:sqlite` (kein natives Modul nötig).
  DB-Datei wird **nicht** committet (Repo ist public); in CI via Actions-Cache persistiert.
- **Lizenz-Enforcement im Code:** `allows_fulltext_storage`/`allows_republication` je Quelle
  steuern Runner und Projektion. `private-use-only`-Inhalte landen nie in committeten Dateien.
- **Kuratierte Inhalte** (Ansprechpartner, Positionen, Notizen, Farben) leben versioniert in
  `curated/*.json` und werden bei der Projektion mit den Pipeline-Daten gemerged.

## Befehle

```bash
npm ci                 # Abhängigkeiten
npm run migrate        # Schema anlegen/aktualisieren
npm run seed           # Quellen/Dossiers aus curated/ in die DB synchen
npm run ingest         # alle aktivierten Quellen einsammeln (oder: npm run ingest -- dip)
npm run enrich         # Regeln + optional Claude: Tags/Summary/Relevanz/Entitäten
npm run cluster        # Dokumente den Dossiers zuordnen
npm run project        # src/data/data.js neu generieren
npm run brief          # briefings/YYYY-MM-DD.md erzeugen
npm run daily          # alles oben in Reihenfolge (täglicher Lauf)
npm run status         # letzte ingestion_runs je Quelle
npm test               # Golden-/Smoke-/Connector-Tests
```

## Secrets / ENV

Siehe `.env.example`. Für GitHub Actions als Repository-Secrets anlegen:
`DIP_API_KEY`, `ANTHROPIC_API_KEY`. Ohne Keys läuft die Pipeline degradiert weiter
(DIP übersprungen bzw. nur regelbasierte Anreicherung).

## Neue Quelle anlegen

RSS-Quellen brauchen keinen Code: Eintrag in `curated/sources.seed.json` mit
`connector: "rss"`, Feed-URL in `config.feedUrl` und Lizenz-Deklaration genügt.
API-/HTML-Quellen: Connector in `src/connectors/` implementieren (Interface
`SourceConnector` in `src/core/types.ts`) und in `src/connectors/registry.ts` registrieren.
