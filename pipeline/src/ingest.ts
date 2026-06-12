import type { DatabaseSync } from 'node:sqlite';

import { createConnector } from './core/registry.js';
import { runSource, type RunOutcome } from './core/runner.js';
import { descriptorFromSeed, loadDossierSeeds, loadSourceSeeds } from './db/seedLoader.js';
import { syncDossier } from './db/repositories/dossiers.js';
import { syncSource } from './db/repositories/sources.js';

// Connector-Selbstregistrierung (Seiteneffekt-Import).
import './connectors/index.js';

/** curated/*.seed.json → DB synchronisieren. Gibt Anzahl (Quellen, Dossiers) zurück. */
export function syncSeeds(db: DatabaseSync): { sources: number; dossiers: number } {
  const sources = loadSourceSeeds();
  for (const seed of sources) syncSource(db, seed);
  const dossiers = loadDossierSeeds();
  for (const seed of dossiers) syncDossier(db, seed);
  return { sources: sources.length, dossiers: dossiers.length };
}

/** Alle (oder eine) aktivierte(n) Quelle(n) einsammeln. Fehler bleiben quellen-isoliert. */
export async function ingestAll(db: DatabaseSync, onlySlug?: string): Promise<RunOutcome[]> {
  const seeds = loadSourceSeeds().filter((s) => (onlySlug ? s.slug === onlySlug : true));
  if (onlySlug && seeds.length === 0) {
    throw new Error(`Quelle "${onlySlug}" nicht in curated/sources.seed.json gefunden.`);
  }
  const outcomes: RunOutcome[] = [];
  for (const seed of seeds) {
    if (!seed.enabled) {
      outcomes.push({ slug: seed.slug, status: 'skipped', itemsFetched: 0, itemsNew: 0, itemsUpdated: 0, itemsSkippedDupe: 0 });
      continue;
    }
    let outcome: RunOutcome;
    try {
      const connector = createConnector(seed.connector, descriptorFromSeed(seed));
      outcome = await runSource(db, connector);
    } catch (err) {
      outcome = {
        slug: seed.slug, status: 'error',
        itemsFetched: 0, itemsNew: 0, itemsUpdated: 0, itemsSkippedDupe: 0,
        errorMessage: (err as Error).message,
      };
    }
    outcomes.push(outcome);
  }
  return outcomes;
}

export function formatOutcomes(outcomes: RunOutcome[]): string {
  const lines = outcomes.map((o) => {
    const stats = `${o.itemsFetched} geholt, ${o.itemsNew} neu, ${o.itemsUpdated} aktualisiert, ${o.itemsSkippedDupe} dupe`;
    return `  ${o.status.padEnd(7)} ${o.slug.padEnd(22)} ${stats}${o.errorMessage ? ` — ${o.errorMessage}` : ''}`;
  });
  return lines.join('\n');
}
