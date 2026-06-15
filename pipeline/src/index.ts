import { writeDailyBriefing } from './brief/dailyBriefing.js';
import { getDb } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { lastRuns } from './db/repositories/runs.js';
import { formatOutcomes, ingestAll, syncSeeds } from './ingest.js';
import { formatProbeResults, probeFeeds } from './probe.js';
import { writeProjection } from './project/generateDataJs.js';
import { writeBriefingsIndex } from './project/briefingsIndex.js';

const [, , command, ...args] = process.argv;

function prepared() {
  const db = getDb();
  runMigrations(db);
  syncSeeds(db);
  return db;
}

async function main(): Promise<number> {
  switch (command) {
    case 'migrate': {
      const applied = runMigrations();
      console.log(applied.length ? `Migrationen angewendet: ${applied.join(', ')}` : 'Schema aktuell.');
      return 0;
    }
    case 'seed': {
      const db = getDb();
      runMigrations(db);
      const { sources, dossiers } = syncSeeds(db);
      console.log(`Seeds synchronisiert: ${sources} Quellen, ${dossiers} Dossiers.`);
      return 0;
    }
    case 'ingest': {
      const outcomes = await ingestAll(prepared(), args[0]);
      console.log(`Ingestion (${outcomes.length} Quellen):\n${formatOutcomes(outcomes)}`);
      return outcomes.some((o) => o.status === 'error') ? 1 : 0;
    }
    case 'project': {
      const { path, result } = writeProjection(prepared());
      console.log(
        `data.js generiert: ${path}\n` +
          `  GESETZE ${result.data.GESETZE.length} | NEWS ${result.data.NEWS.length}` +
          `${result.news.usedFallback ? ' (Fallback — DB noch ohne News)' : ''} | ` +
          `TERMINE ${result.data.TERMINE.length} | STAKEHOLDER ${result.data.STAKEHOLDER.length} | ` +
          `KONTAKTE ${result.data.KONTAKTE.length}`,
      );
      return 0;
    }
    case 'brief': {
      const { path, neueMeldungen } = writeDailyBriefing(prepared());
      console.log(`Briefing geschrieben: ${path} (${neueMeldungen} neue Meldungen)`);
      const idx = writeBriefingsIndex();
      console.log(`Briefing-Index: ${idx.path} (${idx.count} Briefings)`);
      return 0;
    }
    case 'daily': {
      // Tageslauf: einsammeln → data.js generieren → Briefing.
      // Ingestion-Fehler (z. B. offline) stoppen die Generierung NICHT —
      // die Projektion fällt dann auf Fallback-/Bestandsdaten zurück.
      const db = prepared();
      const outcomes = await ingestAll(db);
      console.log(`Ingestion:\n${formatOutcomes(outcomes)}`);
      const { path, result } = writeProjection(db);
      console.log(`data.js generiert: ${path} (NEWS ${result.data.NEWS.length}${result.news.usedFallback ? ', Fallback' : ''})`);
      const brief = writeDailyBriefing(db);
      console.log(`Briefing: ${brief.path} (${brief.neueMeldungen} neue Meldungen)`);
      const idx = writeBriefingsIndex();
      console.log(`Briefing-Index: ${idx.path} (${idx.count} Briefings)`);
      return 0;
    }
    case 'status': {
      const db = getDb();
      runMigrations(db);
      const runs = lastRuns(db);
      if (runs.length === 0) {
        console.log('Noch keine Ingestion-Läufe.');
        return 0;
      }
      for (const r of runs) {
        console.log(
          `#${r.id} ${String(r.slug).padEnd(22)} ${r.status}  ${r.started_at} → ${r.finished_at ?? '…'}  ` +
            `${r.items_fetched} geholt / ${r.items_new} neu / ${r.items_updated} akt. / ${r.items_skipped_dupe} dupe` +
            (r.error_message ? `  — ${r.error_message}` : ''),
        );
      }
      return 0;
    }
    case 'probe': {
      // Reine Verifikation von Feed-URLs — schreibt nichts, berührt die DB nicht.
      const results = await probeFeeds();
      console.log(formatProbeResults(results));
      return results.some((r) => r.isFeed && (r.itemCount ?? 0) > 0) ? 0 : 1;
    }
    case 'enrich':
    case 'cluster':
      console.error(`Befehl "${command}" ist für eine spätere Ausbaustufe vorgesehen (LLM-/Regel-Anreicherung, Dossier-Clustering).`);
      return 1;
    default:
      console.error(
        'Verwendung: tsx src/index.ts <migrate|seed|ingest [slug]|project|brief|daily|status|probe>',
      );
      return command ? 1 : 0;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
