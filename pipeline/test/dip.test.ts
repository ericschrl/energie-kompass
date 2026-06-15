import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { dipConnector, matchDossiers, type DossierRule } from '../src/connectors/dip.js';
import { openDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { insertRaw, upsertNormalized } from '../src/db/repositories/documents.js';
import { openRun } from '../src/db/repositories/runs.js';
import { syncDossier } from '../src/db/repositories/dossiers.js';
import { syncSource } from '../src/db/repositories/sources.js';
import { DossierSeedSchema, SourceSeedSchema } from '../src/db/seeds.js';
import { buildProjection } from '../src/project/generateDataJs.js';
import type { ConnectorContext, HttpClient, HttpResponse, SourceConnector, SourceDescriptor } from '../src/core/types.js';

const VORGANG_FIXTURE = readFileSync(resolve(__dirname, 'fixtures/dip/vorgang.json'), 'utf8');
const POSITION_FIXTURE = readFileSync(resolve(__dirname, 'fixtures/dip/vorgangsposition.json'), 'utf8');

const RULES: DossierRule[] = [
  { slug: 'netzentgelte', keywords: ['EnWG', 'Netzentgelt', 'Energiewirtschaftsgesetz'], patterns: [], topics: ['netz', 'netzentgelte'] },
  { slug: '14a-enwg', keywords: ['§ 14a', '14a'], patterns: [/§\s*14a/iu], topics: ['netz', '14a-enwg', 'emob'] },
];

const DESCRIPTOR: SourceDescriptor = {
  slug: 'dip', name: 'Bundestag DIP', institution: 'Deutscher Bundestag',
  sourceType: 'api', accessType: 'api_key',
  baseUrl: 'https://search.dip.bundestag.de/api/v1',
  licence: { status: 'public-sector', allowsFulltextStorage: true, allowsRepublication: true },
  rateLimit: { requestsPerMinute: 50 },
  credentials: { type: 'api_key', envVar: 'DIP_API_KEY' },
  defaultPolicyArea: 'gesetzgebung',
  config: { wahlperiode: 21, vorgangstyp: 'Gesetzgebung', keywords: ['EnWG'], maxVorgaengeProLauf: 40, maxPagesPerKeyword: 5 },
};

function fakeHttp(): HttpClient {
  let count = 0;
  const ok = (text: string): HttpResponse => ({ status: 200, ok: true, headers: new Headers(), text, buffer: Buffer.from(text) });
  return {
    get requestCount() { return count; },
    async request(url: string): Promise<HttpResponse> {
      count++;
      if (url.includes('/vorgangsposition')) return ok(POSITION_FIXTURE);
      if (url.includes('/vorgang')) {
        if (url.includes('cursor=CURSOR_PAGE2')) return ok(JSON.stringify({ documents: [], cursor: 'CURSOR_PAGE2' }));
        return ok(VORGANG_FIXTURE);
      }
      return ok(JSON.stringify({ documents: [] }));
    },
  };
}

function ctx(http: HttpClient, env: Record<string, string> = {}): ConnectorContext {
  return {
    http,
    logger: { info() {}, warn() {}, error() {} },
    env: (n) => env[n],
    now: () => new Date('2026-06-15T12:00:00+02:00'),
  };
}

const FIXED_NOW = new Date('2026-06-15T12:00:00+02:00');

function testDb() {
  const db = openDb(':memory:');
  runMigrations(db);
  return db;
}

const dipSeed = SourceSeedSchema.parse({
  slug: 'dip', name: 'Bundestag DIP', institution: 'Deutscher Bundestag', connector: 'dip',
  sourceType: 'api', accessType: 'api_key',
  licence: { status: 'public-sector', allowsFulltextStorage: true, allowsRepublication: true },
});

describe('DIP: Relevanz-Gate (matchDossiers)', () => {
  it('trifft energiepolitische Vorgänge', () => {
    const m = matchDossiers('Änderung des Energiewirtschaftsgesetzes (EnWG) – Netzentgelte und § 14a', RULES);
    expect(m.slugs).toContain('netzentgelte');
    expect(m.slugs).toContain('14a-enwg');
    expect(m.topics.find((t) => t.topic === 'netzentgelte')?.frontendTag).toBe('netz');
  });

  it('verwirft fachfremde Vorgänge', () => {
    expect(matchDossiers('Antrag: Förderung des Tierwohls in der Landwirtschaft', RULES).slugs).toEqual([]);
  });
});

describe('DIP: fetchSince', () => {
  it('überspringt sauber ohne DIP_API_KEY (kein HTTP, kein Throw)', async () => {
    const http = fakeHttp();
    const res = await dipConnector(DESCRIPTOR, { rules: RULES }).fetchSince({}, ctx(http, {}));
    expect(res.items).toEqual([]);
    expect(res.exhausted).toBe(true);
    expect(http.requestCount).toBe(0);
  });

  it('holt relevante Vorgänge + Positionen, paginiert, setzt Cursor', async () => {
    const res = await dipConnector(DESCRIPTOR, { rules: RULES }).fetchSince({}, ctx(fakeHttp(), { DIP_API_KEY: 'TESTKEY' }));
    const vorgaenge = res.items.filter((i) => i.externalId?.startsWith('dip-vorgang-'));
    const positionen = res.items.filter((i) => i.externalId?.startsWith('dip-vp-'));
    // 310001 ist relevant (→ 1 Vorgang + 2 Positionen); 310002 (Tierwohl) fällt durchs Gate.
    expect(vorgaenge.map((v) => v.externalId)).toEqual(['dip-vorgang-310001']);
    expect(positionen).toHaveLength(2);
    expect(vorgaenge[0]?.publishedAt).toBe('2026-06-12T07:00:00.000Z');
    expect(res.nextCursor.since).toBe('2026-06-12T07:00:00.000Z');
    expect(res.exhausted).toBe(true);
  });
});

describe('DIP: normalize', () => {
  const c = dipConnector(DESCRIPTOR, { rules: RULES });

  it('Vorgang → normalisiertes Dokument mit Datum, Recht, Dossiers, Topics', () => {
    const [doc] = c.normalize({
      externalId: 'dip-vorgang-310001', rawFormat: 'json',
      payload: JSON.stringify({
        kind: 'vorgang',
        vorgang: { id: '310001', titel: 'EnWG-Novelle', aktualisiert: '2026-06-12T09:00:00+02:00', datum: '2026-06-10', beratungsstand: 'Überwiesen', gesta: 'X001', vorgangstyp: 'Gesetzgebung', wahlperiode: 21 },
        match: { slugs: ['netzentgelte'], topics: [{ topic: 'netzentgelte', frontendTag: 'netz' }] },
      }),
    });
    expect(doc?.docType).toBe('vorgang');
    expect(doc?.title).toBe('EnWG-Novelle');
    expect(doc?.publishedAt).toBe('2026-06-12T07:00:00.000Z');
    expect(doc?.legalReference).toBe('GESTA X001');
    expect(doc?.dossierSlugs).toEqual(['netzentgelte']);
    expect(doc?.topics?.[0]).toEqual({ topic: 'netzentgelte', frontendTag: 'netz' });
    expect((doc?.meta as Record<string, unknown>)?.beratungsstand).toBe('Überwiesen');
  });

  it('Vorgangsposition → eigenes Dokument mit event_date', () => {
    const [doc] = c.normalize({
      externalId: 'dip-vp-770002', rawFormat: 'json',
      payload: JSON.stringify({
        kind: 'vorgangsposition', vorgangId: '310001', vorgangTitel: 'EnWG-Novelle',
        position: { id: '770002', vorgangsposition: '1. Beratung', zuordnung: 'BT', datum: '2026-06-12', fundstelle: { dokumentnummer: '21/50' } },
        match: { slugs: ['netzentgelte'], topics: [{ topic: 'netzentgelte', frontendTag: 'netz' }] },
      }),
    });
    expect(doc?.docType).toBe('vorgangsposition');
    expect(doc?.title).toContain('1. Beratung');
    expect((doc?.meta as Record<string, unknown>)?.event_date).toBe('2026-06-12T00:00:00.000Z');
  });

  it('droppt Items ohne Dossier-Treffer (defensiv)', () => {
    const out = c.normalize({
      externalId: 'dip-vorgang-x', rawFormat: 'json',
      payload: JSON.stringify({ kind: 'vorgang', vorgang: { id: 'x', titel: 'Irgendwas' }, match: { slugs: [], topics: [] } }),
    });
    expect(out).toEqual([]);
  });
});

describe('DIP: Dossier-/Topic-Linking (generischer Schreibpfad)', () => {
  it('schreibt document_topics und dossier_documents', () => {
    const db = testDb();
    const sourceId = syncSource(db, dipSeed);
    syncDossier(db, DossierSeedSchema.parse({
      slug: 'netzentgelte', title: 'Netzentgelte', dossierType: 'gesetzgebung_de', frontendGesetzId: 'netzentgelte',
      matchRules: { keywords: ['Netzentgelt'], patterns: [], topics: ['netz', 'netzentgelte'] },
    }));
    const runId = openRun(db, sourceId, '{}');
    const raw = insertRaw(db, { sourceId, sourceSlug: 'dip', runId, externalId: 'dip-vorgang-1', url: 'https://dip.bundestag.de/vorgang/1', rawFormat: 'json', payload: '{}' });
    const { id } = upsertNormalized(db, {
      sourceId, rawDocumentId: raw.id,
      input: {
        docType: 'vorgang', title: 'EnWG-Novelle', externalId: 'dip-vorgang-1',
        publishedAt: '2026-06-12T07:00:00.000Z',
        topics: [{ topic: 'netzentgelte', frontendTag: 'netz' }, { topic: 'netz', frontendTag: 'netz' }],
        dossierSlugs: ['netzentgelte'],
      },
      licence: { status: 'public-sector', allowsFulltextStorage: true, allowsRepublication: true },
      accessType: 'api_key', collectedAt: FIXED_NOW.toISOString(),
    });
    const topics = db.prepare('SELECT topic, frontend_tag FROM document_topics WHERE normalized_document_id = ? ORDER BY topic').all(id);
    expect(topics).toEqual([{ topic: 'netz', frontend_tag: 'netz' }, { topic: 'netzentgelte', frontend_tag: 'netz' }]);
    const links = db.prepare(
      `SELECT d.slug FROM dossier_documents dd JOIN dossiers d ON d.id = dd.dossier_id WHERE dd.normalized_document_id = ?`,
    ).all(id);
    expect(links).toEqual([{ slug: 'netzentgelte' }]);
  });
});

describe('DIP: NEWS-Projektion', () => {
  it('ein Vorgang erscheint als NEWS-Eintrag (Quelle Bundestag DIP)', () => {
    const db = testDb();
    const sourceId = syncSource(db, dipSeed);
    const runId = openRun(db, sourceId, '{}');
    const raw = insertRaw(db, { sourceId, sourceSlug: 'dip', runId, externalId: 'dip-vorgang-310001', url: 'https://dip.bundestag.de/vorgang/310001', rawFormat: 'json', payload: '{}' });
    upsertNormalized(db, {
      sourceId, rawDocumentId: raw.id,
      input: {
        docType: 'vorgang', title: 'EnWG-Novelle 2026: Netzentgelte', externalId: 'dip-vorgang-310001',
        publishedAt: '2026-06-15T07:00:00.000Z', summary: 'Überwiesen — Anpassungen bei Netzentgelten.',
        originalUrl: 'https://dip.bundestag.de/vorgang/310001',
      },
      licence: { status: 'public-sector', allowsFulltextStorage: true, allowsRepublication: true },
      accessType: 'api_key', collectedAt: FIXED_NOW.toISOString(),
    });
    const { data, news } = buildProjection(db, { now: FIXED_NOW });
    expect(news.usedFallback).toBe(false);
    const item = (data.NEWS as Array<Record<string, unknown>>).find((n) => n.quelle === 'Bundestag DIP');
    expect(item).toBeTruthy();
    expect(item?.quelleColor).toBe('#3f6e8c');
    expect(item?.datum).toBe('Heute, 09:00');
    expect((item?.tags as string[])).toContain('netz');
  });
});
