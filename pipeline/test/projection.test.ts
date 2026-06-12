import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { openDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { openRun } from '../src/db/repositories/runs.js';
import { insertRaw, upsertNormalized } from '../src/db/repositories/documents.js';
import { syncSource } from '../src/db/repositories/sources.js';
import { SourceSeedSchema } from '../src/db/seeds.js';
import { buildProjection } from '../src/project/generateDataJs.js';
import {
  formatNewsDatum, formatTerminTagMonat, formatUhrzeit, serializeDataJs,
} from '../src/project/format.js';
import { klassifiziereTermin, projectTermine } from '../src/project/mappers/termine.js';
import type { Overlays } from '../src/project/overlays.js';

const FIXED_NOW = new Date('2026-06-12T12:00:00+02:00');
const FRONTEND_TAGS = new Set(['eeg', 'netz', 'emob', 'ets', 'markt']);
const TERMIN_TYPEN = new Set(['anhörung', 'frist', 'treffen', 'ausschuss']);

function testDb() {
  const db = openDb(':memory:');
  runMigrations(db);
  return db;
}

function loadVmData(code: string): Record<string, unknown[]> {
  const result = vm.runInNewContext(
    `${code};({ GESETZE, NEWS, TERMINE, STAKEHOLDER, KONTAKTE })`,
    {},
  ) as Record<string, unknown[]>;
  // Re-Realm: vm-Objekte haben fremde Prototypen — für deepEqual normalisieren.
  return JSON.parse(JSON.stringify(result)) as Record<string, unknown[]>;
}

const legacy = loadVmData(readFileSync(resolve(__dirname, 'fixtures/legacy-data.js'), 'utf8'));

describe('Golden: Projektion ohne DB-Daten reproduziert den Legacy-Stand', () => {
  const { content, data, news } = buildProjection(testDb(), { now: FIXED_NOW });
  const generated = loadVmData(content);

  it('nutzt den News-Fallback, solange die DB leer ist', () => {
    expect(news.usedFallback).toBe(true);
  });

  it('GESETZE feldweise identisch (inkl. nächsterSchritt, \\n-Labels, Positionen)', () => {
    expect(generated.GESETZE).toEqual(legacy.GESETZE);
  });

  it('NEWS identisch (Quelle, Farbe, Datum-Strings, gelesen-Flags)', () => {
    expect(generated.NEWS).toEqual(legacy.NEWS);
  });

  it('STAKEHOLDER und KONTAKTE identisch (inkl. Typ-Quirks)', () => {
    expect(generated.STAKEHOLDER).toEqual(legacy.STAKEHOLDER);
    expect(generated.KONTAKTE).toEqual(legacy.KONTAKTE);
  });

  it('TERMINE leer (Legacy-Termine von 2024 sind abgelaufen, keine neuen bekannt)', () => {
    expect(data.TERMINE).toEqual([]);
  });
});

describe('vm-Smoke: generierte data.js erfüllt den Frontend-Vertrag', () => {
  const { content } = buildProjection(testDb(), { now: FIXED_NOW });

  it('ist gültiges Script mit den 5 globalen Konstanten', () => {
    const d = loadVmData(content);
    for (const key of ['GESETZE', 'NEWS', 'TERMINE', 'STAKEHOLDER', 'KONTAKTE']) {
      expect(Array.isArray(d[key]), key).toBe(true);
    }
  });

  it('Umlaut-Property bleibt roh (kein \\uXXXX-Escape), UTF-8, kein BOM', () => {
    expect(content).toContain('"nächsterSchritt"');
    expect(content).not.toContain('\\u00e4');
    expect(content.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('jede GESETZE.news-Referenz existiert in NEWS; Tags in fixer Taxonomie', () => {
    const d = loadVmData(content);
    const newsIds = new Set((d.NEWS as Array<{ id: string }>).map((n) => n.id));
    for (const g of d.GESETZE as Array<{ id: string; news: string[]; tags: string[]; phase: number; phasen: Array<{ status: string }> }>) {
      for (const ref of g.news) expect(newsIds.has(ref), `${g.id} → ${ref}`).toBe(true);
      for (const t of g.tags) expect(FRONTEND_TAGS.has(t), `${g.id} tag ${t}`).toBe(true);
      // Legacy-Daten halten "phase == Index der active-Phase" nicht strikt ein (gmodg);
      // Vertrag ist nur: phase im Bereich, höchstens eine active-Phase.
      expect(g.phase).toBeGreaterThanOrEqual(0);
      expect(g.phase).toBeLessThan(g.phasen.length);
      expect(g.phasen.filter((p) => p.status === 'active').length).toBeLessThanOrEqual(1);
    }
    for (const n of d.NEWS as Array<{ id: string; datum: string; tags: string[]; gelesen: unknown }>) {
      expect(n.datum).toMatch(/^(Heute|Gestern), \d{2}:\d{2}$|^\d{2}\.\d{2}\.\d{4}$/);
      expect(typeof n.gelesen).toBe('boolean');
      for (const t of n.tags) expect(FRONTEND_TAGS.has(t)).toBe(true);
    }
  });
});

describe('Format-Helfer (Europe/Berlin)', () => {
  it('formatNewsDatum: Heute/Gestern/Datum in Berliner Zeit', () => {
    expect(formatNewsDatum('2026-06-12T06:30:00Z', FIXED_NOW)).toBe('Heute, 08:30');
    expect(formatNewsDatum('2026-06-11T20:15:00Z', FIXED_NOW)).toBe('Gestern, 22:15');
    expect(formatNewsDatum('2026-06-01T08:00:00Z', FIXED_NOW)).toBe('01.06.2026');
  });

  it('Mitternachts-Kante: 23:30 UTC ist am Folgetag in Berlin', () => {
    expect(formatNewsDatum('2026-06-11T22:30:00Z', FIXED_NOW)).toBe('Heute, 00:30');
  });

  it('formatTerminTagMonat liefert zero-padded Tag + deutsches Kürzel', () => {
    expect(formatTerminTagMonat('2026-07-02')).toEqual({ tag: '02', monat: 'Jul' });
    expect(formatTerminTagMonat('2026-03-15')).toEqual({ tag: '15', monat: 'Mär' });
  });

  it('formatUhrzeit: HH:MM Uhr bzw. ganztägig', () => {
    expect(formatUhrzeit('2026-06-20T10:00:00+02:00')).toBe('10:00 Uhr');
    expect(formatUhrzeit('2026-06-20')).toBe('ganztägig');
  });

  it('serializeDataJs hält Umlaute roh und escapet eingebettete Newlines', () => {
    const out = serializeDataJs(
      { GESETZE: [{ 'nächsterSchritt': 'Prüfung', phasen: [{ label: 'Referenten-\nentwurf' }] }], NEWS: [], TERMINE: [], STAKEHOLDER: [], KONTAKTE: [] },
      FIXED_NOW,
    );
    expect(out).toContain('"nächsterSchritt": "Prüfung"');
    expect(out).toContain('Referenten-\\nentwurf');
  });
});

describe('NEWS aus der DB (sobald Ingestion lief)', () => {
  function seedDocs(db: ReturnType<typeof testDb>) {
    const seed = SourceSeedSchema.parse({
      slug: 'rss-test',
      name: 'Bundesnetzagentur',
      institution: 'Bundesnetzagentur',
      connector: 'rss',
      sourceType: 'rss',
      accessType: 'public',
      licence: { status: 'public-sector', allowsFulltextStorage: true, allowsRepublication: true },
    });
    const sourceId = syncSource(db, seed);
    const runId = openRun(db, sourceId, '{}');
    const docs = [
      { id: 'a', title: 'Festlegung zu Netzentgelten veröffentlicht', published: '2026-06-12T07:00:00Z' },
      { id: 'b', title: 'Ausschreibung Windenergie an Land gestartet', published: '2026-06-11T15:00:00Z' },
      { id: 'c', title: 'Monitoringbericht Ladeinfrastruktur', published: '2026-06-01T09:00:00Z' },
    ];
    for (const d of docs) {
      const raw = insertRaw(db, {
        sourceId, sourceSlug: 'rss-test', runId, externalId: d.id,
        url: `https://example.org/${d.id}`, rawFormat: 'json', payload: JSON.stringify(d),
      });
      upsertNormalized(db, {
        sourceId, rawDocumentId: raw.id,
        input: {
          docType: 'pressemitteilung', title: d.title, externalId: d.id,
          publishedAt: d.published, originalUrl: `https://example.org/${d.id}`,
          summary: `${d.title} — Kurzfassung.`,
        },
        licence: seed.licence, accessType: 'public', collectedAt: FIXED_NOW.toISOString(),
      });
    }
    return sourceId;
  }

  it('verdrängt den Fallback, formatiert Datum/Farbe/Tags und ist ungelesen', () => {
    const db = testDb();
    seedDocs(db);
    const { data, news } = buildProjection(db, { now: FIXED_NOW });
    expect(news.usedFallback).toBe(false);
    const items = data.NEWS as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      id: 'news-1',
      quelle: 'Bundesnetzagentur',
      quelleColor: '#004B87',
      datum: 'Heute, 09:00',
      gelesen: false,
    });
    expect(items[1]?.datum).toBe('Gestern, 17:00');
    expect(items[2]?.datum).toBe('01.06.2026');
    expect((items[0]?.tags as string[])).toContain('netz');
    // GESETZE.news verweist im DB-Modus nur auf real verknüpfte Dokumente (MVP: leer)
    const gesetze = data.GESETZE as Array<{ news: string[] }>;
    for (const g of gesetze) expect(g.news).toEqual([]);
  });

  it('gelesen wird true, sobald die erste Projektion >24h zurückliegt', () => {
    const db = testDb();
    seedDocs(db);
    db.prepare('UPDATE normalized_documents SET first_projected_at = ?').run('2026-06-10T08:00:00Z');
    const { data } = buildProjection(db, { now: FIXED_NOW });
    for (const n of data.NEWS as Array<{ gelesen: boolean }>) expect(n.gelesen).toBe(true);
  });
});

describe('TERMINE-Mapper', () => {
  const overlays: Overlays = {
    gesetze: {}, stakeholder: [], kontakte: [], newsFallback: [], quelleColors: {},
    termineManual: [
      { datumIso: '2026-07-02', titel: 'Frist: Stellungnahme Netzentgelt-Festlegung', ort: 'Schriftlich an BNetzA', typ: 'frist', gesetze_ref: 'netzentgelte' },
      { datumIso: '2026-06-20T10:00:00+02:00', titel: 'Anhörung im Wirtschaftsausschuss', ort: 'Bundestag, Berlin', typ: 'anhörung', gesetze_ref: null },
      { datumIso: '2026-01-01', titel: 'Vergangener Termin', ort: 'nirgends', typ: 'treffen', gesetze_ref: null },
    ],
  };

  it('filtert Vergangenes, sortiert, zero-padded Tag, korrekte Formate', () => {
    const termine = projectTermine(testDb(), overlays, FIXED_NOW);
    expect(termine).toHaveLength(2);
    expect(termine[0]).toEqual({
      tag: '20', monat: 'Jun', titel: 'Anhörung im Wirtschaftsausschuss', ort: 'Bundestag, Berlin',
      typ: 'anhörung', gesetze_ref: null, uhrzeit: '10:00 Uhr',
    });
    expect(termine[1]).toMatchObject({ tag: '02', monat: 'Jul', typ: 'frist', uhrzeit: 'ganztägig' });
    for (const t of termine) expect(TERMIN_TYPEN.has(t.typ)).toBe(true);
  });

  it('klassifiziert Termin-Typen auf die 4 CSS-Werte (mit Umlaut)', () => {
    expect(klassifiziereTermin('Öffentliche Anhörung EnWG')).toBe('anhörung');
    expect(klassifiziereTermin('Frist: Stellungnahme bis 30.06.')).toBe('frist');
    expect(klassifiziereTermin('2./3. Lesung im Plenum')).toBe('ausschuss');
    expect(klassifiziereTermin('Hintergrundgespräch BDEW')).toBe('treffen');
  });
});
