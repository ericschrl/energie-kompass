import { runMigrations } from './db/migrate.js';

const [, , command, ...args] = process.argv;

async function main(): Promise<number> {
  switch (command) {
    case 'migrate': {
      const applied = runMigrations();
      console.log(applied.length ? `Migrationen angewendet: ${applied.join(', ')}` : 'Schema aktuell.');
      return 0;
    }
    case 'seed':
    case 'ingest':
    case 'enrich':
    case 'cluster':
    case 'project':
    case 'brief':
    case 'daily':
    case 'status':
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
