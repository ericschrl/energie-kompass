import type { DatabaseSync } from 'node:sqlite';

/**
 * Quellenübergreifende Dubletten-Erkennung (innerhalb einer Quelle greift bereits
 * UNIQUE(source_id, external_id)). Reihenfolge: canonical_url -> content_hash ->
 * title_date_hash (gleiche Meldung über zwei Feeds mit unterschiedlichen URLs).
 */
export function findCrossSourceDuplicate(
  db: DatabaseSync,
  params: {
    sourceId: number;
    canonicalUrl?: string;
    contentHash: string;
    titleDateHash: string;
  },
): number | undefined {
  const byUrl = params.canonicalUrl
    ? (db
        .prepare(
          `SELECT id FROM normalized_documents
           WHERE canonical_url = ? AND source_id != ? AND duplicate_of IS NULL
           ORDER BY id LIMIT 1`,
        )
        .get(params.canonicalUrl, params.sourceId) as { id: number } | undefined)
    : undefined;
  if (byUrl) return byUrl.id;

  const byHash = db
    .prepare(
      `SELECT id FROM normalized_documents
       WHERE content_hash = ? AND source_id != ? AND duplicate_of IS NULL
       ORDER BY id LIMIT 1`,
    )
    .get(params.contentHash, params.sourceId) as { id: number } | undefined;
  if (byHash) return byHash.id;

  const byTitleDate = db
    .prepare(
      `SELECT id FROM normalized_documents
       WHERE json_extract(meta_json, '$.title_date_hash') = ?
         AND source_id != ? AND duplicate_of IS NULL
       ORDER BY id LIMIT 1`,
    )
    .get(params.titleDateHash, params.sourceId) as { id: number } | undefined;
  return byTitleDate?.id;
}
