# curated/ — handgepflegte Daten (Quelle der Wahrheit)

Diese Dateien werden versioniert und beim Generieren mit den Pipeline-Daten gemerged.
**Hier** pflegen, nie in `src/data/data.js` (wird überschrieben).

| Datei | Inhalt |
|---|---|
| `sources.seed.json` | Quellen-Registry: Connector, URLs/Queries, Rate-Limits, **Lizenz-Deklaration je Quelle** (steuert technisch, ob Volltexte gespeichert bzw. Inhalte veröffentlicht werden dürfen). `config.verifyUrl: true` = Feed-/Endpunkt-URL beim ersten Live-Lauf verifizieren. |
| `dossiers.seed.json` | Themen-Dossiers mit Match-Regeln (Keywords/Regex/Topics). `frontendGesetzId` verknüpft ein Dossier mit einer GESETZE-Karte im Frontend. |
| `gesetze.overlay.json` | Kuratierte Basisfelder je GESETZE-Karte (Name, Beschreibung, Ansprechpartner, Positionen) + `fallback` (Phasen/letzte Aktion/nächster Schritt/News-Refs), solange keine Pipeline-Daten vorliegen. |
| `stakeholder.overlay.json` | STAKEHOLDER 1:1 (Pipeline verifiziert später `lobbyregister_id`/`vollname`). |
| `kontakte.json` | KONTAKTE 1:1 (reines Passthrough). |
| `termine.manual.json` | Manuell gepflegte Termine (Parlamentsabende, eigene Treffen). Felder wie TERMINE im Frontend, zusätzlich `datumIso` (`YYYY-MM-DD`). |
| `news.fallback.json` | Legacy-/Fallback-News — werden NUR projiziert, solange die Datenbank keine echten News liefert (verhindert leere UI vor dem ersten Ingestion-Lauf). |
| `quelle-colors.json` | Quellname → Hex-Farbe für den News-Monitor (`_default` als Fallback). |
| `tag-rules.json` | Keyword-/Regex-Regeln → Topics, Frontend-Tags (`eeg|netz|emob|ets|markt`), Relevanz-Basiswerte. |
