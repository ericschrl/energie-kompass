import { describe, expect, it } from 'vitest';

import { openDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { syncSource } from '../src/db/repositories/sources.js';
import { SourceSeedSchema } from '../src/db/seeds.js';
import { runSource } from '../src/core/runner.js';
import type { ConnectorContext, Cursor, FetchedItem, FetchResult, SourceConnector } from '../src/core/types.js';

function testDb() {
  const db = openDb(':memory:');
  runMigrations(db);
  return db;
}

const baseSeed = {
  slug: 'test-quelle',
  name: 'Testquelle',
  institution: 'Test',
  connector: 'fake',
  sourceType: 'api' as const,
  accessType: 'public' as const,
  licence: {
    status: 'public-sector' as const,
    allowsFulltextStorage: true,
    allowsRepublication: true,
  },
};

function fakeConnector(pages: FetchedItem[][], opts: { fulltext?: boolean } = {}): SourceConnector {
  const seed = SourceSeedSchema.parse({
    ...baseSeed,
    licence: { ...baseSeed.licence, allowsFulltextStorage: opts.fulltext ?? true },
  });
  return {
    descriptor: {
      slug: seed.slug,
      name: seed.name,
      institution: seed.institution,
      sourceType: seed.sourceType,
      accessType: seed.accessType,
      licence: seed.licence,
      rateLimit: seed.rateLimit,
    },
    async fetchSince(cursor: Cursor, _ctx: ConnectorContext): Promise<FetchResult> {
      const page = Number(cursor.page ?? 0);
      return {
        items: pages[page] ?? [],
        nextCursor: { page: page + 1 },
        exhausted: page + 1 >= pages.length,
      };
    },
    normalize(item: FetchedItem) {
      const data = JSON.parse(item.payload) as { titel: string; text?: string; stand?: string };
      return [
        {
          docType: 'vorgang',
          title: data.titel,
          externalId: item.externalId,
          publishedAt: item.publishedAt,
          originalUrl: item.url,
          normalizedText: data.text ?? null,
          summary: `Zusammenfassung: ${data.titel}`,
          meta: { beratungsstand: data.stand },
        },
      ];
    },
  };
}

function item(id: string, titel: string, extra: Record<string, unknown> = {}): FetchedItem {
  return {
    externalId: id,
    url: `https://example.org/vorgang/${id}`,
    rawFormat: 'json',
    payload: JSON.stringify({ titel, ...extra }),
    publishedAt: '2026-06-10T08:00:00Z',
  };
}

describe('runner', () => {
  it('persistiert raw + normalized, schreibt Cursor und Lauf-Protokoll', async () => {
    const db = testDb();
    const seed = SourceSeedSchema.parse(baseSeed);
    syncSource(db, seed);

    const result = await runSource(db, fakeConnector([
      [item('v1', 'EnWG-Novelle'), item('v2', 'EEG-Änderung')],
      [item('v3', 'Netzentgelt-Verordnung')],
    ]));

    expect(result.status).toBe('success');
    expect(result.itemsNew).toBe(3);
    expect((db.prepare('SELECT COUNT(*) c FROM raw_documents').get() as { c: number }).c).toBe(3);
    expect((db.prepare('SELECT COUNT(*) c FROM normalized_documents').get() as { c: number }).c).toBe(3);

    const run = db.prepare('SELECT status, items_new, cursor_after FROM ingestion_runs ORDER BY id DESC').get() as Record<string, unknown>;
    expect(run.status).toBe('success');
    expect(JSON.parse(String(run.cursor_after))).toEqual({ page: 2 });

    const src = db.prepare('SELECT cursor_json FROM sources WHERE slug = ?').get('test-quelle') as { cursor_json: string };
    expect(JSON.parse(src.cursor_json)).toEqual({ page: 2 });
  });

  it('überspringt unveränderte Items als Duplikate (idempotenter Re-Run)', async () => {
    const db = testDb();
    syncSource(db, SourceSeedSchema.parse(baseSeed));
    const pages = [[item('v1', 'EnWG-Novelle')]];

    await runSource(db, fakeConnector(pages));
    // Quellen ohne Delta-API liefern dasselbe Fenster erneut → Cursor zurücksetzen.
    db.prepare('UPDATE sources SET cursor_json = NULL').run();
    const second = await runSource(db, fakeConnector(pages));

    expect(second.itemsSkippedDupe).toBe(1);
    expect(second.itemsNew).toBe(0);
    expect((db.prepare('SELECT COUNT(*) c FROM normalized_documents').get() as { c: number }).c).toBe(1);
  });

  it('legt bei inhaltlicher Änderung eine Version mit diff_note an', async () => {
    const db = testDb();
    syncSource(db, SourceSeedSchema.parse(baseSeed));

    await runSource(db, fakeConnector([[item('v1', 'EnWG-Novelle', { stand: 'Überwiesen' })]]));
    db.prepare('UPDATE sources SET cursor_json = NULL').run();
    await runSource(db, fakeConnector([[item('v1', 'EnWG-Novelle', { stand: 'Beschlussempfehlung liegt vor' })]]));

    const versions = db
      .prepare('SELECT diff_note FROM document_versions ORDER BY version_no')
      .all() as Array<{ diff_note: string }>;
    expect(versions).toHaveLength(1);
    expect(versions[0]?.diff_note).toContain('beratungsstand');
    expect(versions[0]?.diff_note).toContain('Überwiesen');

    const doc = db.prepare("SELECT json_extract(meta_json,'$.beratungsstand') s FROM normalized_documents").get() as { s: string };
    expect(doc.s).toBe('Beschlussempfehlung liegt vor');
  });

  it('erzwingt die Lizenz: kein Volltext, wenn allowsFulltextStorage=false', async () => {
    const db = testDb();
    syncSource(db, SourceSeedSchema.parse(baseSeed));

    await runSource(db, fakeConnector(
      [[item('v1', 'Paywall-Meldung', { text: 'GESCHÜTZTER VOLLTEXT' })]],
      { fulltext: false },
    ));

    const doc = db.prepare('SELECT normalized_text, summary FROM normalized_documents').get() as {
      normalized_text: string | null;
      summary: string;
    };
    expect(doc.normalized_text).toBeNull();
    expect(doc.summary).toContain('Paywall-Meldung');
  });

  it('isoliert Quellen-Fehler als error-Status statt zu werfen', async () => {
    const db = testDb();
    syncSource(db, SourceSeedSchema.parse(baseSeed));
    const broken: SourceConnector = {
      ...fakeConnector([[]]),
      async fetchSince(): Promise<FetchResult> {
        throw new Error('API nicht erreichbar');
      },
    };

    const result = await runSource(db, broken);
    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('API nicht erreichbar');
    const run = db.prepare('SELECT status FROM ingestion_runs').get() as { status: string };
    expect(run.status).toBe('error');
  });
});
