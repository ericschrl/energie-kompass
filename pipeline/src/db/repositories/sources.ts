import type { DatabaseSync } from 'node:sqlite';

import type { Cursor } from '../../core/types.js';
import type { SourceSeed } from '../seeds.js';

export interface SourceRow {
  id: number;
  slug: string;
  name: string;
  institution: string | null;
  source_type: string;
  access_type: string;
  enabled: number;
  connector: string;
  config_json: string | null;
  cursor_json: string | null;
  default_policy_area: string | null;
}

/** Seed -> DB-Sync (idempotent). Seeds sind die Quelle der Wahrheit für Quellen-Metadaten. */
export function syncSource(db: DatabaseSync, seed: SourceSeed): number {
  const existing = db.prepare('SELECT id FROM sources WHERE slug = ?').get(seed.slug) as
    | { id: number }
    | undefined;
  const configJson = seed.config ? JSON.stringify(seed.config) : null;

  let id: number;
  if (existing) {
    id = existing.id;
    db.prepare(
      `UPDATE sources SET name=?, institution=?, source_type=?, access_type=?, base_url=?,
       enabled=?, connector=?, config_json=?, default_policy_area=?, updated_at=datetime('now')
       WHERE id=?`,
    ).run(
      seed.name, seed.institution, seed.sourceType, seed.accessType, seed.baseUrl ?? null,
      seed.enabled ? 1 : 0, seed.connector, configJson, seed.defaultPolicyArea ?? null, id,
    );
  } else {
    const res = db.prepare(
      `INSERT INTO sources (slug, name, institution, source_type, access_type, base_url, enabled, connector, config_json, default_policy_area)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      seed.slug, seed.name, seed.institution, seed.sourceType, seed.accessType, seed.baseUrl ?? null,
      seed.enabled ? 1 : 0, seed.connector, configJson, seed.defaultPolicyArea ?? null,
    );
    id = Number(res.lastInsertRowid);
  }

  db.prepare(
    `INSERT INTO source_licences (source_id, licence_status, licence_name, licence_url,
       allows_fulltext_storage, allows_republication, attribution_required, attribution_text, reviewed_at)
     VALUES (?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(source_id) DO UPDATE SET
       licence_status=excluded.licence_status, licence_name=excluded.licence_name,
       licence_url=excluded.licence_url, allows_fulltext_storage=excluded.allows_fulltext_storage,
       allows_republication=excluded.allows_republication, attribution_required=excluded.attribution_required,
       attribution_text=excluded.attribution_text, reviewed_at=datetime('now')`,
  ).run(
    id, seed.licence.status, seed.licence.name ?? null, seed.licence.url ?? null,
    seed.licence.allowsFulltextStorage ? 1 : 0, seed.licence.allowsRepublication ? 1 : 0,
    seed.licence.attributionRequired ? 1 : 0, seed.licence.attributionText ?? null,
  );

  if (seed.credentials) {
    const cred = db.prepare('SELECT id FROM source_credentials WHERE source_id = ?').get(id) as
      | { id: number }
      | undefined;
    if (cred) {
      db.prepare('UPDATE source_credentials SET credential_type=?, env_var=?, secret_ref=? WHERE id=?').run(
        seed.credentials.type, seed.credentials.envVar, `gh-actions:${seed.credentials.envVar}`, cred.id,
      );
    } else {
      db.prepare(
        'INSERT INTO source_credentials (source_id, credential_type, env_var, secret_ref) VALUES (?,?,?,?)',
      ).run(id, seed.credentials.type, seed.credentials.envVar, `gh-actions:${seed.credentials.envVar}`);
    }
  }
  return id;
}

export function getSourceBySlug(db: DatabaseSync, slug: string): SourceRow | undefined {
  return db.prepare('SELECT * FROM sources WHERE slug = ?').get(slug) as SourceRow | undefined;
}

export function getCursor(db: DatabaseSync, sourceId: number): Cursor {
  const row = db.prepare('SELECT cursor_json FROM sources WHERE id = ?').get(sourceId) as
    | { cursor_json: string | null }
    | undefined;
  if (!row?.cursor_json) return {};
  try {
    return JSON.parse(row.cursor_json) as Cursor;
  } catch {
    return {};
  }
}

export function saveCursor(db: DatabaseSync, sourceId: number, cursor: Cursor): void {
  db.prepare("UPDATE sources SET cursor_json = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(cursor), sourceId,
  );
}
