import type { DatabaseSync } from 'node:sqlite';

import type { DossierSeed } from '../seeds.js';

export interface DossierRow {
  id: number;
  slug: string;
  title: string;
  dossier_type: string;
  status: string;
  priority: string | null;
  frontend_gesetz_id: string | null;
  dip_vorgang_id: string | null;
  eu_procedure_ref: string | null;
  match_rules_json: string | null;
}

/** Seed → DB-Sync (idempotent). */
export function syncDossier(db: DatabaseSync, seed: DossierSeed): number {
  const matchRules = JSON.stringify(seed.matchRules);
  const existing = db.prepare('SELECT id FROM dossiers WHERE slug = ?').get(seed.slug) as
    | { id: number }
    | undefined;
  if (existing) {
    db.prepare(
      `UPDATE dossiers SET title=?, description=?, dossier_type=?, status=?, priority=?,
       frontend_gesetz_id=?, dip_vorgang_id=?, eu_procedure_ref=?, match_rules_json=?, updated_at=datetime('now')
       WHERE id=?`,
    ).run(
      seed.title, seed.description ?? null, seed.dossierType, seed.status, seed.priority ?? null,
      seed.frontendGesetzId ?? null, seed.dipVorgangId ?? null, seed.euProcedureRef ?? null,
      matchRules, existing.id,
    );
    return existing.id;
  }
  const res = db.prepare(
    `INSERT INTO dossiers (slug, title, description, dossier_type, status, priority,
       frontend_gesetz_id, dip_vorgang_id, eu_procedure_ref, match_rules_json)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    seed.slug, seed.title, seed.description ?? null, seed.dossierType, seed.status,
    seed.priority ?? null, seed.frontendGesetzId ?? null, seed.dipVorgangId ?? null,
    seed.euProcedureRef ?? null, matchRules,
  );
  return Number(res.lastInsertRowid);
}

export function listDossiers(db: DatabaseSync): DossierRow[] {
  return db.prepare('SELECT * FROM dossiers ORDER BY slug').all() as unknown as DossierRow[];
}

export function getDossierIdBySlug(db: DatabaseSync, slug: string): number | undefined {
  const row = db.prepare('SELECT id FROM dossiers WHERE slug = ?').get(slug) as { id: number } | undefined;
  return row?.id;
}

/** Dokument ↔ Dossier verknüpfen (idempotent; bester Score gewinnt). */
export function linkDocumentToDossier(
  db: DatabaseSync,
  dossierId: number,
  documentId: number,
  matchScore: number,
  matchedBy: 'rule' | 'llm' | 'manual' | 'source_link',
): void {
  db.prepare(
    `INSERT INTO dossier_documents (dossier_id, normalized_document_id, match_score, matched_by)
     VALUES (?,?,?,?)
     ON CONFLICT(dossier_id, normalized_document_id) DO UPDATE SET
       match_score = MAX(match_score, excluded.match_score),
       matched_by = CASE WHEN excluded.match_score > match_score THEN excluded.matched_by ELSE matched_by END`,
  ).run(dossierId, documentId, matchScore, matchedBy);
}
