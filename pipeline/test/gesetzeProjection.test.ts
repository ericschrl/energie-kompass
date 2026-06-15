import { describe, expect, it } from 'vitest';

import { openDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { insertRaw, upsertNormalized } from '../src/db/repositories/documents.js';
import { openRun } from '../src/db/repositories/runs.js';
import { syncDossier } from '../src/db/repositories/dossiers.js';
import { syncSource } from '../src/db/repositories/sources.js';
import { DossierSeedSchema, SourceSeedSchema } from '../src/db/seeds.js';
import { projectGesetze } from '../src/project/mappers/gesetze.js';
import type { Overlays } from '../src/project/overlays.js';

const NOW = '2026-06-15T12:00:00.000Z';
const LICENCE = { status: 'public-sector' as const, allowsFulltextStorage: true, allowsRepublication: true };

const source = SourceSeedSchema.parse({
  slug: 'dip', name: 'Bundestag DIP', institution: 'Deutscher Bundestag', connector: 'dip',
  sourceType: 'api', accessType: 'api_key', licence: LICENCE,
});

function overlays(): Overlays {
  return {
    gesetze: {
      'eeg-2024': {
        name: 'EEG-Novelle 2024', kurz: 'EEG', beschreibung: 'Beschreibung bleibt kuratiert',
        ressort: 'BMWK', referat: 'IVB5', prioritaet: 'hoch', tags: ['eeg'],
        ansprechpartner: { ministerium: [{ name: 'Dr. Kurat' }], bundestag: [] },
        positionen: [{ akteur: 'BDEW', typ: 'Verband', position: 'pro', kommentar: 'kuratiert' }],
        fallback: {
          phase: 3,
          phasen: [{ label: '1. Lesung', datum: 'Jun 2024', status: 'active' }],
          letzteAktion: 'Kabinettsbeschluss 15.05.2024',
          naechsterSchritt: '1. Lesung im Bundestag – 20.06.2024',
          news: ['news-fallback'],
        },
      },
    },
    stakeholder: [], kontakte: [], newsFallback: [], termineManual: [], quelleColors: {},
  } as unknown as Overlays;
}

function setup() {
  const db = openDb(':memory:');
  runMigrations(db);
  const sourceId = syncSource(db, source);
  const runId = openRun(db, sourceId, '{}');
  const add = (input: Record<string, unknown>) => {
    const raw = insertRaw(db, { sourceId, sourceSlug: 'dip', runId, externalId: String(input.externalId), url: 'https://dip.bundestag.de/x', rawFormat: 'json', payload: '{}' });
    return upsertNormalized(db, { sourceId, rawDocumentId: raw.id, input: input as never, licence: LICENCE, accessType: 'api_key', collectedAt: NOW }).id;
  };
  return { db, add };
}

describe('GESETZE-Projektion: news aus DIP/RSS', () => {
  it('referenziert nur verknüpfte, existierende NEWS-IDs', () => {
    const { db, add } = setup();
    syncDossier(db, DossierSeedSchema.parse({ slug: 'eeg-novelle', title: 'EEG', dossierType: 'gesetzgebung_de', frontendGesetzId: 'eeg-2024', matchRules: { keywords: ['EEG'], patterns: [], topics: ['eeg'] } }));
    const dipId = add({ docType: 'vorgang', title: 'EEG-Novelle (DIP)', externalId: 'dip-vorgang-1', publishedAt: '2026-06-14T07:00:00.000Z', dossierSlugs: ['eeg-novelle'] });
    const rssId = add({ docType: 'rss_article', title: 'EEG: BMWE-Meldung', externalId: 'rss-1', publishedAt: '2026-06-13T07:00:00.000Z', dossierSlugs: ['eeg-novelle'] });
    const unmappedId = add({ docType: 'vorgang', title: 'EEG-Randvorgang', externalId: 'dip-vorgang-2', publishedAt: '2026-06-12T07:00:00.000Z', dossierSlugs: ['eeg-novelle'] });

    const docIdToNewsId = new Map<number, string>([[dipId, 'news-1'], [rssId, 'news-2']]); // unmappedId fehlt bewusst
    const gesetze = projectGesetze(db, overlays(), docIdToNewsId, false) as Array<{ id: string; news: string[] }>;
    const eeg = gesetze.find((g) => g.id === 'eeg-2024')!;
    expect([...eeg.news].sort()).toEqual(['news-1', 'news-2']); // DIP + RSS
    expect(eeg.news).not.toContain(undefined);
    expect(docIdToNewsId.has(unmappedId)).toBe(false);
  });

  it('nutzt im Fallback-Modus die kuratierten News-Referenzen', () => {
    const { db } = setup();
    syncDossier(db, DossierSeedSchema.parse({ slug: 'eeg-novelle', title: 'EEG', dossierType: 'gesetzgebung_de', frontendGesetzId: 'eeg-2024', matchRules: { keywords: ['EEG'], patterns: [], topics: ['eeg'] } }));
    const gesetze = projectGesetze(db, overlays(), new Map(), true) as Array<{ id: string; news: string[] }>;
    expect(gesetze[0]!.news).toEqual(['news-fallback']);
  });
});

describe('GESETZE-Projektion: letzteAktion nur via dipVorgangId-Pin', () => {
  it('leitet letzteAktion aus dem gepinnten Vorgang (jüngste Vorgangsposition) ab', () => {
    const { db, add } = setup();
    syncDossier(db, DossierSeedSchema.parse({ slug: 'eeg-novelle', title: 'EEG', dossierType: 'gesetzgebung_de', frontendGesetzId: 'eeg-2024', dipVorgangId: '310001', matchRules: { keywords: ['EEG'], patterns: [], topics: ['eeg'] } }));
    add({ docType: 'vorgang', title: 'EEG-Novelle', externalId: 'dip-vorgang-310001', publishedAt: '2026-06-10T07:00:00.000Z', dossierSlugs: ['eeg-novelle'], meta: { beratungsstand: 'Überwiesen' } });
    add({ docType: 'vorgangsposition', title: '1. Beratung: EEG-Novelle', externalId: 'dip-vp-77', publishedAt: '2026-06-12T08:00:00.000Z', dossierSlugs: ['eeg-novelle'], meta: { positionstyp: '1. Beratung', zuordnung: 'BT', vorgang_id: '310001', event_date: '2026-06-12T08:00:00.000Z' } });

    const g = (projectGesetze(db, overlays(), new Map(), false) as Array<{ id: string; letzteAktion: string }>)[0]!;
    expect(g.letzteAktion).toBe('1. Beratung (BT) – 12.06.2026');
  });

  it('fällt auf Beratungsstand des Vorgangs zurück, wenn keine Position vorliegt', () => {
    const { db, add } = setup();
    syncDossier(db, DossierSeedSchema.parse({ slug: 'eeg-novelle', title: 'EEG', dossierType: 'gesetzgebung_de', frontendGesetzId: 'eeg-2024', dipVorgangId: '310001', matchRules: { keywords: ['EEG'], patterns: [], topics: ['eeg'] } }));
    add({ docType: 'vorgang', title: 'EEG-Novelle', externalId: 'dip-vorgang-310001', publishedAt: '2026-06-10T07:00:00.000Z', dossierSlugs: ['eeg-novelle'], meta: { beratungsstand: 'Dem Bundesrat zugeleitet' } });
    const g = (projectGesetze(db, overlays(), new Map(), false) as Array<{ letzteAktion: string }>)[0]!;
    expect(g.letzteAktion).toBe('Dem Bundesrat zugeleitet – 10.06.2026');
  });

  it('ohne dipVorgangId bleibt die kuratierte letzteAktion erhalten (auch bei Keyword-Treffern)', () => {
    const { db, add } = setup();
    // Dossier OHNE Pin; ein lose per Keyword verknüpfter Vorgang darf nichts überschreiben.
    syncDossier(db, DossierSeedSchema.parse({ slug: 'eeg-novelle', title: 'EEG', dossierType: 'gesetzgebung_de', frontendGesetzId: 'eeg-2024', matchRules: { keywords: ['EEG'], patterns: [], topics: ['eeg'] } }));
    add({ docType: 'vorgang', title: 'Irgendein EEG-naher Vorgang', externalId: 'dip-vorgang-999', publishedAt: '2026-06-14T07:00:00.000Z', dossierSlugs: ['eeg-novelle'], meta: { beratungsstand: 'Überwiesen' } });
    const g = (projectGesetze(db, overlays(), new Map(), false) as Array<{ letzteAktion: string }>)[0]!;
    expect(g.letzteAktion).toBe('Kabinettsbeschluss 15.05.2024');
  });

  it('lässt kuratierte Felder (Positionen, Priorität, Ansprechpartner, Beschreibung) unangetastet', () => {
    const { db } = setup();
    syncDossier(db, DossierSeedSchema.parse({ slug: 'eeg-novelle', title: 'EEG', dossierType: 'gesetzgebung_de', frontendGesetzId: 'eeg-2024', dipVorgangId: '310001', matchRules: { keywords: ['EEG'], patterns: [], topics: ['eeg'] } }));
    const g = (projectGesetze(db, overlays(), new Map(), false) as Array<Record<string, unknown>>)[0]!;
    expect(g.prioritaet).toBe('hoch');
    expect(g.beschreibung).toBe('Beschreibung bleibt kuratiert');
    expect((g.positionen as unknown[]).length).toBe(1);
    expect((g.ansprechpartner as { ministerium: unknown[] }).ministerium.length).toBe(1);
    expect(g.phase).toBe(3);
    expect(g['nächsterSchritt']).toBe('1. Lesung im Bundestag – 20.06.2024');
  });
});
