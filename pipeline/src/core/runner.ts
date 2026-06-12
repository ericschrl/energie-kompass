import type { DatabaseSync } from 'node:sqlite';

import { config } from '../config.js';
import { insertRaw, upsertNormalized } from '../db/repositories/documents.js';
import { bumpReliability, finishRun, openRun } from '../db/repositories/runs.js';
import { getCursor, getSourceBySlug, saveCursor } from '../db/repositories/sources.js';
import { FetchHttpClient } from './http.js';
import { createLogger } from './logger.js';
import type { ConnectorContext, Cursor, HttpClient, Logger, SourceConnector } from './types.js';

export interface RunnerOptions {
  http?: HttpClient;
  logger?: Logger;
  now?: () => Date;
  /** Schutz gegen Endlos-Paginierung / Laufzeit-Explosion pro Quelle. */
  maxPages?: number;
  maxItems?: number;
}

export interface RunOutcome {
  slug: string;
  runId?: number;
  status: 'success' | 'partial' | 'error' | 'skipped';
  itemsFetched: number;
  itemsNew: number;
  itemsUpdated: number;
  itemsSkippedDupe: number;
  errorMessage?: string;
}

/**
 * Führt einen Ingestion-Lauf für eine Quelle aus. Fehler werden isoliert:
 * diese Funktion wirft nie, damit eine kaputte Quelle den Gesamtlauf nicht stoppt.
 */
export async function runSource(
  db: DatabaseSync,
  connector: SourceConnector,
  opts: RunnerOptions = {},
): Promise<RunOutcome> {
  const slug = connector.descriptor.slug;
  const logger = opts.logger ?? createLogger(slug);
  const source = getSourceBySlug(db, slug);
  if (!source) {
    return { slug, status: 'error', itemsFetched: 0, itemsNew: 0, itemsUpdated: 0, itemsSkippedDupe: 0, errorMessage: `Quelle "${slug}" nicht in DB — npm run seed vergessen?` };
  }
  if (!source.enabled) {
    logger.info('Quelle deaktiviert, übersprungen.');
    return { slug, status: 'skipped', itemsFetched: 0, itemsNew: 0, itemsUpdated: 0, itemsSkippedDupe: 0 };
  }

  const minDelayMs =
    connector.descriptor.rateLimit.minDelayMs ??
    Math.ceil(60_000 / connector.descriptor.rateLimit.requestsPerMinute);
  const http = opts.http ?? new FetchHttpClient({ minDelayMs });
  const ctx: ConnectorContext = {
    http,
    logger,
    env: config.env,
    now: opts.now ?? (() => new Date()),
  };

  let cursor: Cursor = getCursor(db, source.id);
  const runId = openRun(db, source.id, JSON.stringify(cursor));
  const totals = { itemsFetched: 0, itemsNew: 0, itemsUpdated: 0, itemsSkippedDupe: 0, httpRequests: 0, schemaDriftEvents: 0 };
  let itemErrors = 0;
  let fatalError: string | undefined;

  const maxPages = opts.maxPages ?? 25;
  const maxItems = opts.maxItems ?? 500;

  try {
    for (let page = 0; page < maxPages && totals.itemsFetched < maxItems; page++) {
      const result = await connector.fetchSince(cursor, ctx);
      totals.itemsFetched += result.items.length;

      for (const item of result.items) {
        try {
          const raw = insertRaw(db, {
            sourceId: source.id,
            sourceSlug: slug,
            runId,
            externalId: item.externalId,
            url: item.url,
            rawFormat: item.rawFormat,
            payload: item.payload,
          });
          if (!raw.isNew) {
            totals.itemsSkippedDupe++;
            continue;
          }
          for (const input of connector.normalize(item)) {
            const res = upsertNormalized(db, {
              sourceId: source.id,
              rawDocumentId: raw.id,
              input,
              licence: connector.descriptor.licence,
              accessType: connector.descriptor.accessType,
              defaultPolicyArea: connector.descriptor.defaultPolicyArea,
              collectedAt: ctx.now().toISOString(),
            });
            if (res.outcome === 'new') totals.itemsNew++;
            else if (res.outcome === 'updated') totals.itemsUpdated++;
            else totals.itemsSkippedDupe++;
          }
        } catch (err) {
          itemErrors++;
          totals.schemaDriftEvents++;
          logger.warn(`Item übersprungen (${item.externalId ?? item.url ?? '?'}): ${(err as Error).message}`);
        }
      }

      // Cursor nur nach erfolgreich verarbeiteter Seite fortschreiben.
      cursor = result.nextCursor;
      saveCursor(db, source.id, cursor);
      if (result.exhausted) break;
    }
  } catch (err) {
    fatalError = (err as Error).message;
    logger.error(`Lauf abgebrochen: ${fatalError}`);
  }

  totals.httpRequests = http.requestCount;
  const status: 'success' | 'partial' | 'error' = fatalError
    ? totals.itemsFetched > 0 ? 'partial' : 'error'
    : itemErrors > 0 ? 'partial' : 'success';
  finishRun(db, runId, status, totals, JSON.stringify(cursor), fatalError ?? (itemErrors ? `${itemErrors} Item-Fehler` : undefined));
  bumpReliability(db, source.id, status === 'error', totals.schemaDriftEvents);
  logger.info(
    `Lauf #${runId}: ${status} — ${totals.itemsFetched} geholt, ${totals.itemsNew} neu, ${totals.itemsUpdated} aktualisiert, ${totals.itemsSkippedDupe} Duplikate`,
  );
  return { slug, runId, status, ...totals, errorMessage: fatalError };
}
