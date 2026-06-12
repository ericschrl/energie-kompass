import type { DatabaseSync } from 'node:sqlite';

export interface RunTotals {
  itemsFetched: number;
  itemsNew: number;
  itemsUpdated: number;
  itemsSkippedDupe: number;
  httpRequests: number;
  schemaDriftEvents: number;
}

export function openRun(db: DatabaseSync, sourceId: number, cursorBefore: string): number {
  const res = db
    .prepare('INSERT INTO ingestion_runs (source_id, cursor_before) VALUES (?, ?)')
    .run(sourceId, cursorBefore);
  return Number(res.lastInsertRowid);
}

export function finishRun(
  db: DatabaseSync,
  runId: number,
  status: 'success' | 'partial' | 'error',
  totals: RunTotals,
  cursorAfter: string,
  errorMessage?: string,
): void {
  db.prepare(
    `UPDATE ingestion_runs SET finished_at=datetime('now'), status=?, cursor_after=?,
     items_fetched=?, items_new=?, items_updated=?, items_skipped_dupe=?, http_requests=?, error_message=?
     WHERE id=?`,
  ).run(
    status, cursorAfter, totals.itemsFetched, totals.itemsNew, totals.itemsUpdated,
    totals.itemsSkippedDupe, totals.httpRequests, errorMessage ?? null, runId,
  );
}

/** Monatsstatistik je Quelle fortschreiben (source_reliability). */
export function bumpReliability(
  db: DatabaseSync,
  sourceId: number,
  failed: boolean,
  driftEvents: number,
  period = new Date().toISOString().slice(0, 7),
): void {
  db.prepare(
    `INSERT INTO source_reliability (source_id, period, runs_total, runs_failed, schema_drift_events)
     VALUES (?,?,1,?,?)
     ON CONFLICT(source_id, period) DO UPDATE SET
       runs_total = runs_total + 1,
       runs_failed = runs_failed + excluded.runs_failed,
       schema_drift_events = schema_drift_events + excluded.schema_drift_events`,
  ).run(sourceId, period, failed ? 1 : 0, driftEvents);
}

export function lastRuns(db: DatabaseSync, limit = 20): Array<Record<string, unknown>> {
  return db
    .prepare(
      `SELECT r.id, s.slug, r.started_at, r.finished_at, r.status,
              r.items_fetched, r.items_new, r.items_updated, r.items_skipped_dupe, r.error_message
       FROM ingestion_runs r JOIN sources s ON s.id = r.source_id
       ORDER BY r.id DESC LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;
}
