import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { canonicalUrl } from '../../core/canonicalUrl.js';
import { findCrossSourceDuplicate } from '../../core/dedupe.js';
import { contentHash, sha256, stableStringify, titleDateHash } from '../../core/hash.js';
import type { LicenceDeclaration, NormalizedInput, RawFormat } from '../../core/types.js';
import { config } from '../../config.js';
import { getDossierIdBySlug, linkDocumentToDossier } from './dossiers.js';

const RAW_INLINE_MAX_BYTES = 64 * 1024;

export interface InsertRawParams {
  sourceId: number;
  sourceSlug: string;
  runId: number;
  externalId?: string;
  url?: string;
  rawFormat: RawFormat;
  payload: string;
  httpStatus?: number;
}

export function insertRaw(db: DatabaseSync, p: InsertRawParams): { id: number; isNew: boolean } {
  const hash = sha256(p.payload);
  const existing = db
    .prepare(
      'SELECT id FROM raw_documents WHERE source_id = ? AND external_id IS ? AND content_hash = ?',
    )
    .get(p.sourceId, p.externalId ?? null, hash) as { id: number } | undefined;
  if (existing) return { id: existing.id, isNew: false };

  let rawInline: string | null = p.payload;
  let rawLocation: string | null = null;
  if (Buffer.byteLength(p.payload, 'utf8') > RAW_INLINE_MAX_BYTES) {
    const dir = join(config.rawStoreDir, p.sourceSlug);
    mkdirSync(dir, { recursive: true });
    const ext = p.rawFormat === 'json' ? 'json' : p.rawFormat;
    rawLocation = join(dir, `${hash}.${ext}`);
    writeFileSync(rawLocation, p.payload, 'utf8');
    rawInline = null;
  }

  const res = db
    .prepare(
      `INSERT INTO raw_documents (source_id, ingestion_run_id, external_id, original_url, raw_format,
         raw_inline, raw_text_location, content_hash, http_status)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      p.sourceId, p.runId, p.externalId ?? null, p.url ?? null, p.rawFormat,
      rawInline, rawLocation, hash, p.httpStatus ?? null,
    );
  return { id: Number(res.lastInsertRowid), isNew: true };
}

export interface UpsertParams {
  sourceId: number;
  rawDocumentId: number;
  input: NormalizedInput;
  licence: LicenceDeclaration;
  accessType: string;
  defaultPolicyArea?: string;
  collectedAt: string;
}

export type UpsertOutcome = 'new' | 'updated' | 'unchanged';

export interface NormalizedDocRow {
  id: number;
  external_id: string | null;
  title: string;
  summary: string | null;
  content_hash: string;
  meta_json: string | null;
}

export function upsertNormalized(
  db: DatabaseSync,
  p: UpsertParams,
): { id: number; outcome: UpsertOutcome; duplicateOf?: number } {
  const { input } = p;
  // Lizenz-Enforcement zentral: Volltext nur speichern, wenn die Quelle es erlaubt.
  const text = p.licence.allowsFulltextStorage ? input.normalizedText ?? null : null;
  const licenceStatus = input.licenceOverride ?? p.licence.status;
  const canon = canonicalUrl(input.originalUrl);
  // meta gehört in den Hash: Statuswechsel (z.B. DIP-beratungsstand) leben oft NUR dort
  // und müssen eine neue Version auslösen.
  const hash = contentHash(
    input.title, input.publishedAt, text ?? input.summary ?? '',
    input.legalReference, stableStringify(input.meta ?? {}),
  );
  const tdHash = titleDateHash(input.title, input.publishedAt);
  const externalId = input.externalId ?? canon ?? hash;
  const metaJson = JSON.stringify({ ...(input.meta ?? {}), title_date_hash: tdHash });

  const existing = db
    .prepare(
      'SELECT id, external_id, title, summary, content_hash, meta_json FROM normalized_documents WHERE source_id = ? AND external_id = ?',
    )
    .get(p.sourceId, externalId) as NormalizedDocRow | undefined;

  if (existing && existing.content_hash === hash) {
    return { id: existing.id, outcome: 'unchanged' };
  }

  if (existing) {
    const versionNo =
      Number(
        (db
          .prepare('SELECT COALESCE(MAX(version_no), 0) AS v FROM document_versions WHERE normalized_document_id = ?')
          .get(existing.id) as { v: number }).v,
      ) + 1;
    db.prepare(
      `INSERT INTO document_versions (normalized_document_id, version_no, content_hash, title, summary, meta_json, diff_note, valid_from)
       VALUES (?,?,?,?,?,?,?,datetime('now'))`,
    ).run(
      existing.id, versionNo, existing.content_hash, existing.title, existing.summary,
      existing.meta_json, diffNote(existing, input),
    );
    db.prepare(
      `UPDATE normalized_documents SET
         raw_document_id=?, doc_type=?, title=?, author_or_institution=?, published_at=?, collected_at=?,
         original_url=?, canonical_url=?, language=?, normalized_text=?, summary=?,
         policy_area=COALESCE(?, policy_area), legal_reference=COALESCE(?, legal_reference),
         licence_status=?, meta_json=?, content_hash=?, updated_at=datetime('now')
       WHERE id=?`,
    ).run(
      p.rawDocumentId, input.docType, input.title, input.authorOrInstitution ?? null,
      input.publishedAt ?? null, p.collectedAt, input.originalUrl ?? null, canon ?? null,
      input.language ?? 'de', text, input.summary ?? null,
      input.policyArea ?? null, input.legalReference ?? null,
      licenceStatus, metaJson, hash, existing.id,
    );
    insertEntities(db, existing.id, input);
    linkTopicsAndDossiers(db, existing.id, input);
    return { id: existing.id, outcome: 'updated' };
  }

  const duplicateOf = findCrossSourceDuplicate(db, {
    sourceId: p.sourceId,
    canonicalUrl: canon,
    contentHash: hash,
    titleDateHash: tdHash,
  });

  const res = db
    .prepare(
      `INSERT INTO normalized_documents (raw_document_id, source_id, external_id, doc_type, title,
         author_or_institution, published_at, collected_at, original_url, canonical_url, language,
         normalized_text, summary, policy_area, legal_reference, licence_status, access_type,
         meta_json, content_hash, duplicate_of)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      p.rawDocumentId, p.sourceId, externalId, input.docType, input.title,
      input.authorOrInstitution ?? null, input.publishedAt ?? null, p.collectedAt,
      input.originalUrl ?? null, canon ?? null, input.language ?? 'de',
      text, input.summary ?? null, input.policyArea ?? p.defaultPolicyArea ?? null,
      input.legalReference ?? null, licenceStatus, p.accessType,
      metaJson, hash, duplicateOf ?? null,
    );
  const id = Number(res.lastInsertRowid);
  insertEntities(db, id, input);
  linkTopicsAndDossiers(db, id, input);
  return { id, outcome: 'new', duplicateOf };
}

/** Generischer Schreibpfad für document_topics + dossier_documents (z.B. aus dem DIP-Connector). */
function linkTopicsAndDossiers(db: DatabaseSync, docId: number, input: NormalizedInput): void {
  if (input.topics?.length) {
    const stmt = db.prepare(
      `INSERT INTO document_topics (normalized_document_id, topic, frontend_tag, score, method)
       VALUES (?,?,?,?,'rule')
       ON CONFLICT(normalized_document_id, topic) DO UPDATE SET
         frontend_tag=excluded.frontend_tag, score=MAX(score, excluded.score)`,
    );
    for (const t of input.topics) stmt.run(docId, t.topic, t.frontendTag ?? null, t.score ?? 0.5);
  }
  if (input.dossierSlugs?.length) {
    for (const slug of input.dossierSlugs) {
      const dossierId = getDossierIdBySlug(db, slug);
      if (dossierId) linkDocumentToDossier(db, dossierId, docId, 0.7, 'rule');
    }
  }
}

function insertEntities(db: DatabaseSync, docId: number, input: NormalizedInput): void {
  if (!input.entities?.length) return;
  const stmt = db.prepare(
    `INSERT INTO document_entities (normalized_document_id, entity_type, name, normalized_name, external_ref, confidence, extraction_method)
     VALUES (?,?,?,?,?,1.0,'source_field')
     ON CONFLICT(normalized_document_id, entity_type, name) DO UPDATE SET
       normalized_name=excluded.normalized_name, external_ref=excluded.external_ref`,
  );
  for (const e of input.entities) {
    stmt.run(docId, e.entityType, e.name, e.normalizedName ?? e.name, e.externalRef ?? null);
  }
}

/** Kurzbeschreibung der Änderung für document_versions (Statuswechsel sind das Wichtigste). */
function diffNote(oldRow: NormalizedDocRow, input: NormalizedInput): string {
  const notes: string[] = [];
  let oldMeta: Record<string, unknown> = {};
  try {
    oldMeta = oldRow.meta_json ? (JSON.parse(oldRow.meta_json) as Record<string, unknown>) : {};
  } catch {
    /* alte meta_json unlesbar -> nur Feldvergleiche */
  }
  const newMeta = input.meta ?? {};
  for (const key of ['beratungsstand', 'frist_bis', 'event_date']) {
    const before = oldMeta[key];
    const after = newMeta[key];
    if (before !== after && (before !== undefined || after !== undefined)) {
      notes.push(`${key}: ${String(before ?? '–')} → ${String(after ?? '–')}`);
    }
  }
  if (oldRow.title !== input.title) notes.push('titel geändert');
  if ((oldRow.summary ?? '') !== (input.summary ?? '')) notes.push('inhalt aktualisiert');
  return notes.join('; ') || 'inhalt aktualisiert';
}
