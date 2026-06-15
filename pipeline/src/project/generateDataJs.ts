import { writeFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import { config } from '../config.js';
import { withTransaction } from '../db/connection.js';
import { berlinDayKey, serializeDataJs } from './format.js';
import { loadOverlays, type Overlays } from './overlays.js';
import { projectGesetze } from './mappers/gesetze.js';
import { projectNews, type NewsProjection } from './mappers/news.js';
import { projectTermine } from './mappers/termine.js';

export interface ProjectionResult {
  content: string;
  data: {
    GESETZE: unknown[];
    NEWS: unknown[];
    TERMINE: unknown[];
    STAKEHOLDER: unknown[];
    KONTAKTE: unknown[];
  };
  news: NewsProjection;
}

/** Reine Projektion (ohne Seiteneffekte) — testbar mit In-Memory-DB und beliebigem curated/-Dir. */
export function buildProjection(
  db: DatabaseSync,
  opts: { now?: Date; overlays?: Overlays } = {},
): ProjectionResult {
  const now = opts.now ?? new Date();
  const overlays = opts.overlays ?? loadOverlays();

  const news = projectNews(db, overlays, now);
  const data = {
    GESETZE: projectGesetze(db, overlays, news.docIdToNewsId, news.usedFallback),
    NEWS: news.items as unknown[],
    TERMINE: projectTermine(db, overlays, now) as unknown[],
    STAKEHOLDER: overlays.stakeholder,
    KONTAKTE: overlays.kontakte,
  };
  return { content: serializeDataJs(data), data, news };
}

/**
 * Projektion schreiben + Zustand persistieren: src/data/data.js überschreiben,
 * first_projected_at setzen und je projizierter DB-News eine citations-Zeile anlegen.
 */
export function writeProjection(
  db: DatabaseSync,
  opts: { now?: Date; path?: string } = {},
): { path: string; result: ProjectionResult } {
  const now = opts.now ?? new Date();
  const path = opts.path ?? config.dataJsPath;
  const result = buildProjection(db, { now });

  writeFileSync(path, result.content, 'utf8');

  if (result.news.projectedDocs.length > 0) {
    const dayKey = berlinDayKey(now);
    const nowIso = now.toISOString();
    withTransaction(() => {
      const markFirst = db.prepare(
        'UPDATE normalized_documents SET first_projected_at = ? WHERE id = ? AND first_projected_at IS NULL',
      );
      const cite = db.prepare(
        `INSERT INTO citations (normalized_document_id, used_in, used_in_ref, url, accessed_at, licence_status)
         SELECT ?, 'frontend_news', ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM citations WHERE normalized_document_id = ? AND used_in = 'frontend_news' AND used_in_ref = ?
         )`,
      );
      for (const d of result.news.projectedDocs) {
        if (d.firstProjection) markFirst.run(nowIso, d.docId);
        const ref = `data.js:${d.newsId}@${dayKey}`;
        cite.run(d.docId, ref, d.url, nowIso, d.licence, d.docId, ref);
      }
    }, db);
  }

  return { path, result };
}
