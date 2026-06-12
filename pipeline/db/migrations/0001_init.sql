-- Energie-Kompass Monitoring-Schema (SQLite)
-- Dedup-Strategie: (1) UNIQUE(source_id, external_id) für stabile Quell-IDs,
-- (2) canonical_url quellenübergreifend, (3) content_hash (SHA-256, normalisiert).
-- Lizenz-Pflichtfelder werden vom Runner technisch durchgesetzt.

-- 1) Quellen-Registry: Cursor + Connector-Konfiguration leben hier
CREATE TABLE sources (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  institution   TEXT,
  source_type   TEXT NOT NULL CHECK (source_type IN ('api','rss','html','pdf','csv','email','manual')),
  access_type   TEXT NOT NULL CHECK (access_type IN ('public','api_key','oauth','private_email','paywalled','manual')),
  base_url      TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  schedule      TEXT NOT NULL DEFAULT 'daily',
  connector     TEXT NOT NULL,
  config_json   TEXT,
  cursor_json   TEXT,
  default_policy_area TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT
);

-- 2) Credentials: NUR Referenzen auf ENV/GitHub-Secrets, nie Klartext
CREATE TABLE source_credentials (
  id              INTEGER PRIMARY KEY,
  source_id       INTEGER NOT NULL REFERENCES sources(id),
  credential_type TEXT NOT NULL CHECK (credential_type IN ('api_key','oauth_refresh_token','basic','none')),
  env_var         TEXT,
  secret_ref      TEXT,
  valid_until     TEXT,
  notes           TEXT
);

-- 3) Lauf-Protokoll
CREATE TABLE ingestion_runs (
  id                 INTEGER PRIMARY KEY,
  source_id          INTEGER NOT NULL REFERENCES sources(id),
  started_at         TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at        TEXT,
  status             TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','partial','error')),
  cursor_before      TEXT,
  cursor_after       TEXT,
  items_fetched      INTEGER NOT NULL DEFAULT 0,
  items_new          INTEGER NOT NULL DEFAULT 0,
  items_updated      INTEGER NOT NULL DEFAULT 0,
  items_skipped_dupe INTEGER NOT NULL DEFAULT 0,
  http_requests      INTEGER NOT NULL DEFAULT 0,
  error_message      TEXT,
  log_json           TEXT
);
CREATE INDEX idx_runs_source ON ingestion_runs(source_id, started_at DESC);

-- 4) Rohdokumente (append-only)
CREATE TABLE raw_documents (
  id                INTEGER PRIMARY KEY,
  source_id         INTEGER NOT NULL REFERENCES sources(id),
  ingestion_run_id  INTEGER REFERENCES ingestion_runs(id),
  external_id       TEXT,
  original_url      TEXT,
  raw_format        TEXT NOT NULL CHECK (raw_format IN ('json','xml','html','pdf','csv','eml','txt')),
  raw_inline        TEXT,
  raw_text_location TEXT,
  content_hash      TEXT NOT NULL,
  collected_at      TEXT NOT NULL DEFAULT (datetime('now')),
  http_status       INTEGER,
  headers_json      TEXT,
  UNIQUE (source_id, external_id, content_hash)
);
CREATE INDEX idx_raw_hash ON raw_documents(content_hash);

-- 5) Normalisierte Dokumente — zentrale Tabelle mit allen Pflichtfeldern
CREATE TABLE normalized_documents (
  id               INTEGER PRIMARY KEY,
  raw_document_id  INTEGER NOT NULL REFERENCES raw_documents(id),
  source_id        INTEGER NOT NULL REFERENCES sources(id),
  external_id      TEXT,
  doc_type         TEXT NOT NULL,
  title            TEXT NOT NULL,
  author_or_institution TEXT,
  published_at     TEXT,
  collected_at     TEXT NOT NULL,
  original_url     TEXT,
  canonical_url    TEXT,
  language         TEXT NOT NULL DEFAULT 'de',
  normalized_text  TEXT,
  summary          TEXT,
  policy_area      TEXT,
  dossier_tags     TEXT,
  legal_reference  TEXT,
  licence_status   TEXT NOT NULL DEFAULT 'unknown'
                   CHECK (licence_status IN ('open','public-sector','cc-by','unknown','restricted','private-use-only')),
  access_type      TEXT NOT NULL,
  relevance_score  REAL NOT NULL DEFAULT 0,
  confidence_score REAL NOT NULL DEFAULT 0,
  citation_metadata TEXT,
  meta_json        TEXT,
  content_hash     TEXT NOT NULL,
  duplicate_of     INTEGER REFERENCES normalized_documents(id),
  enriched_at      TEXT,
  enrich_method    TEXT CHECK (enrich_method IN ('rule','llm','manual')),
  first_projected_at TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT,
  UNIQUE (source_id, external_id)
);
CREATE INDEX idx_norm_published ON normalized_documents(published_at DESC);
CREATE INDEX idx_norm_policy    ON normalized_documents(policy_area);
CREATE INDEX idx_norm_canon     ON normalized_documents(canonical_url);
CREATE INDEX idx_norm_hash      ON normalized_documents(content_hash);
CREATE INDEX idx_norm_doctype   ON normalized_documents(doc_type);

-- 6) Versionierung (Statuswechsel von Vorgängen, geänderte Seiten …)
CREATE TABLE document_versions (
  id                     INTEGER PRIMARY KEY,
  normalized_document_id INTEGER NOT NULL REFERENCES normalized_documents(id),
  version_no             INTEGER NOT NULL,
  content_hash           TEXT NOT NULL,
  title                  TEXT,
  summary                TEXT,
  normalized_text        TEXT,
  meta_json              TEXT,
  diff_note              TEXT,
  valid_from             TEXT NOT NULL,
  UNIQUE (normalized_document_id, version_no)
);

-- 7) Entitäten (Akteur-/Gesetz-/Paragraph-Erkennung)
CREATE TABLE document_entities (
  id                     INTEGER PRIMARY KEY,
  normalized_document_id INTEGER NOT NULL REFERENCES normalized_documents(id),
  entity_type            TEXT NOT NULL CHECK (entity_type IN ('person','organisation','gesetz','paragraph','fraktion','unternehmen','ort')),
  name                   TEXT NOT NULL,
  normalized_name        TEXT,
  external_ref           TEXT,
  confidence             REAL NOT NULL DEFAULT 0,
  extraction_method      TEXT CHECK (extraction_method IN ('rule','llm','source_field','manual')),
  UNIQUE (normalized_document_id, entity_type, name)
);
CREATE INDEX idx_ent_doc  ON document_entities(normalized_document_id);
CREATE INDEX idx_ent_name ON document_entities(normalized_name);

-- 8) Themen (feingranular) + Mapping auf die fixe Frontend-Taxonomie
CREATE TABLE document_topics (
  id                     INTEGER PRIMARY KEY,
  normalized_document_id INTEGER NOT NULL REFERENCES normalized_documents(id),
  topic                  TEXT NOT NULL,
  frontend_tag           TEXT CHECK (frontend_tag IN ('eeg','netz','emob','ets','markt')),
  score                  REAL NOT NULL DEFAULT 0,
  method                 TEXT CHECK (method IN ('rule','llm','manual')),
  UNIQUE (normalized_document_id, topic)
);
CREATE INDEX idx_topics_topic ON document_topics(topic);

-- 9) Dossiers (Themen-Cluster; frontend_gesetz_id verknüpft mit GESETZE.id)
CREATE TABLE dossiers (
  id                 INTEGER PRIMARY KEY,
  slug               TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  description        TEXT,
  dossier_type       TEXT NOT NULL CHECK (dossier_type IN ('gesetzgebung_de','gesetzgebung_eu','konsultation','dauerthema','akteur')),
  status             TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','beobachtung','abgeschlossen')),
  priority           TEXT CHECK (priority IN ('hoch','mittel','niedrig')),
  frontend_gesetz_id TEXT,
  dip_vorgang_id     TEXT,
  eu_procedure_ref   TEXT,
  match_rules_json   TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT
);

-- 9a) Junction Dossier <-> Dokument
CREATE TABLE dossier_documents (
  dossier_id             INTEGER NOT NULL REFERENCES dossiers(id),
  normalized_document_id INTEGER NOT NULL REFERENCES normalized_documents(id),
  match_score            REAL NOT NULL DEFAULT 0,
  matched_by             TEXT CHECK (matched_by IN ('rule','llm','manual','source_link')),
  added_at               TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (dossier_id, normalized_document_id)
);

-- 10) Lizenz-Deklaration je Quelle (aus curated/sources.seed.json gespeist)
CREATE TABLE source_licences (
  id                      INTEGER PRIMARY KEY,
  source_id               INTEGER NOT NULL UNIQUE REFERENCES sources(id),
  licence_status          TEXT NOT NULL CHECK (licence_status IN ('open','public-sector','cc-by','unknown','restricted','private-use-only')),
  licence_name            TEXT,
  licence_url             TEXT,
  allows_fulltext_storage INTEGER NOT NULL DEFAULT 0,
  allows_republication    INTEGER NOT NULL DEFAULT 0,
  attribution_required    INTEGER NOT NULL DEFAULT 0,
  attribution_text        TEXT,
  reviewed_at             TEXT,
  notes                   TEXT
);

-- 11) Zuverlässigkeit je Quelle und Monat
CREATE TABLE source_reliability (
  id                  INTEGER PRIMARY KEY,
  source_id           INTEGER NOT NULL REFERENCES sources(id),
  period              TEXT NOT NULL,
  runs_total          INTEGER NOT NULL DEFAULT 0,
  runs_failed         INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms      INTEGER,
  dupe_rate           REAL,
  schema_drift_events INTEGER NOT NULL DEFAULT 0,
  editorial_quality   REAL,
  notes               TEXT,
  UNIQUE (source_id, period)
);

-- 12) Zitate: jede nach außen gegebene Aussage ist rückverfolgbar
CREATE TABLE citations (
  id                     INTEGER PRIMARY KEY,
  normalized_document_id INTEGER NOT NULL REFERENCES normalized_documents(id),
  used_in                TEXT NOT NULL CHECK (used_in IN ('briefing','frontend_news','frontend_gesetz','frontend_termin','dossier_summary','note')),
  used_in_ref            TEXT NOT NULL,
  quote                  TEXT,
  quote_location         TEXT,
  url                    TEXT NOT NULL,
  accessed_at            TEXT NOT NULL,
  licence_status         TEXT NOT NULL,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_cit_doc ON citations(normalized_document_id);
CREATE INDEX idx_cit_used ON citations(used_in, used_in_ref);

-- 13) Manuelle Notizen/Einschätzungen
CREATE TABLE user_notes (
  id         INTEGER PRIMARY KEY,
  ref_type   TEXT NOT NULL CHECK (ref_type IN ('document','dossier','entity','source','termin')),
  ref_id     TEXT NOT NULL,
  author     TEXT NOT NULL DEFAULT 'eric',
  note       TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

-- 14) Gmail (Phase 2): NUR Metadaten, Snippets, Hashes — nie Paywall-Volltext
CREATE TABLE gmail_messages (
  id                     INTEGER PRIMARY KEY,
  message_id             TEXT NOT NULL UNIQUE,
  thread_id              TEXT,
  sender                 TEXT NOT NULL,
  subject                TEXT,
  received_at            TEXT NOT NULL,
  labels_json            TEXT,
  snippet                TEXT,
  body_hash              TEXT NOT NULL,
  extracted_urls_json    TEXT,
  newsletter_source      TEXT,
  normalized_document_id INTEGER REFERENCES normalized_documents(id),
  processed_at           TEXT
);
CREATE INDEX idx_gmail_received ON gmail_messages(received_at DESC);

-- 15) Eigene interne Zusammenfassungen je Newsletter-Meldung (Phase 2)
CREATE TABLE newsletter_summaries (
  id                     INTEGER PRIMARY KEY,
  gmail_message_id       INTEGER NOT NULL REFERENCES gmail_messages(id),
  item_index             INTEGER NOT NULL DEFAULT 0,
  title                  TEXT NOT NULL,
  summary                TEXT NOT NULL,
  topics_json            TEXT,
  source_publication     TEXT,
  original_headline_hash TEXT,
  licence_status         TEXT NOT NULL DEFAULT 'private-use-only',
  relevance_score        REAL NOT NULL DEFAULT 0,
  normalized_document_id INTEGER REFERENCES normalized_documents(id),
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Volltextsuche (FTS5, external content)
CREATE VIRTUAL TABLE documents_fts USING fts5(
  title, summary, normalized_text, legal_reference,
  content='normalized_documents', content_rowid='id',
  tokenize="unicode61 remove_diacritics 2"
);
CREATE TRIGGER trg_nd_ai AFTER INSERT ON normalized_documents BEGIN
  INSERT INTO documents_fts(rowid, title, summary, normalized_text, legal_reference)
  VALUES (new.id, new.title, new.summary, new.normalized_text, new.legal_reference);
END;
CREATE TRIGGER trg_nd_ad AFTER DELETE ON normalized_documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, summary, normalized_text, legal_reference)
  VALUES ('delete', old.id, old.title, old.summary, old.normalized_text, old.legal_reference);
END;
CREATE TRIGGER trg_nd_au AFTER UPDATE ON normalized_documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, summary, normalized_text, legal_reference)
  VALUES ('delete', old.id, old.title, old.summary, old.normalized_text, old.legal_reference);
  INSERT INTO documents_fts(rowid, title, summary, normalized_text, legal_reference)
  VALUES (new.id, new.title, new.summary, new.normalized_text, new.legal_reference);
END;

-- Auswertungs-View: alle Pflichtfelder eines Datensatzes in einer Zeile
CREATE VIEW v_documents_full AS
SELECT nd.*,
       s.slug AS source_slug, s.name AS source_name, s.source_type,
       sl.licence_name, sl.allows_fulltext_storage, sl.allows_republication, sl.attribution_text
FROM normalized_documents nd
JOIN sources s ON s.id = nd.source_id
LEFT JOIN source_licences sl ON sl.source_id = s.id;
