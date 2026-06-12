import { getDb } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { lastRuns } from './db/repositories/runs.js';
import { formatOutcomes, ingestAll, syncSeeds } from './ingest.js';

const [, , command, ...args] = process.argv;

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
      const db = getDb();
      runMigrations(db);
      syncSeeds(db);
      const outcomes = await ingestAll(db, args[0]);
      console.log(`Ingestion (${outcomes.length} Quellen):\n${formatOutcomes(outcomes)}`);
      return outcomes.some((o) => o.status === 'error') ? 1 : 0;
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
    case 'enrich':
    case 'cluster':
    case 'project':
    case 'brief':
    case 'daily':
      console.error(`Befehl "${command}" ist noch nicht implementiert.`);
      return 1;
    default:
      console.error(
        'Verwendung: tsx src/index.ts <migrate|seed|ingest [slug]|enrich|cluster|project|brief|daily|status>',
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
