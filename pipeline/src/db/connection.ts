import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { config } from '../config.js';

let db: DatabaseSync | undefined;

export function openDb(path: string = config.dbPath): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const d = new DatabaseSync(path);
  d.exec('PRAGMA journal_mode = WAL;');
  d.exec('PRAGMA foreign_keys = ON;');
  d.exec('PRAGMA busy_timeout = 5000;');
  return d;
}

export function getDb(): DatabaseSync {
  if (!db) {
    db = openDb();
  }
  return db;
}

/** Erlaubt Tests, eine eigene (In-Memory-)DB einzusetzen. */
export function setDb(instance: DatabaseSync): void {
  db = instance;
}

export function closeDb(): void {
  db?.close();
  db = undefined;
}

export function withTransaction<T>(fn: () => T, d: DatabaseSync = getDb()): T {
  d.exec('BEGIN');
  try {
    const result = fn();
    d.exec('COMMIT');
    return result;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}
