import { describe, expect, it } from 'vitest';

import { openDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { insertRaw, upsertNormalized } from '../src/db/repositories/documents.js';
import { openRun } from '../src/db/repositories/runs.js';
import { syncDossier } from '../src/db/repositories/dossiers.js';
import { syncSource } from '../src/db/repositories/sources.js';
import { loadDossierSeeds } from '../src/db/seedLoader.js';
import { SourceSeedSchema } from '../src/db/seeds.js';
import { buildProjection } from '../src/project/generateDataJs.js';
import {
  deriveLegislationSignals, detectAction, sourceTyp,
} from '../src/project/legislationSignals.js';
import { projectGesetze } from '../src/project/mappers/gesetze.js';
import { loadOverlays, type Overlays } from '../src/project/overlays.js';

const NOW = new Date('2026-06-16T12:00:00+02:00');
const LICENCE = { status: 'public-sector' as const, allowsFulltextStorage: true, allowsRepublication: true };

type Gesetz = {
  id: string; name: string; letzteAktion: string; news: string[];
  prioritaet: string; ressort: string; positionen: unknown[];
  ansprechpartner: { ministerium: unknown[]; bundestag: unknown[] };
  quelle: { url: string | null; datum: string | null; typ: string } | null;
};

function source(slug: string, name: string, connector: 'dip' | 'rss', accessType: 'api_key' | 'public') {
  return SourceSeedSchema.parse({
    slug, name, institution: name, connector,
    sourceType: connector === 'dip' ? 'api' : 'rss', accessType, licence: LICENCE,
  });
}

/** In-Memory-DB mit den REALEN kuratierten Dossiers (inkl. Pins aus #9 + gmodg-Umwidmung #10). */
function setup() {
  const db = openDb(':memory:');
  runMigrations(db);
  for (const seed of loadDossierSeeds()) syncDossier(db, seed);
  const sources = new Map<string, number>();
  const runs = new Map<number, number>();
  const add = (srcSlug: string, srcName: string, connector: 'dip' | 'rss', input: Record<string, unknown>): number => {
    let sid = sources.get(srcSlug);
    if (sid === undefined) {
      sid = syncSource(db, source(srcSlug, srcName, connector, connector === 'dip' ? 'api_key' : 'public'));
      sources.set(srcSlug, sid);
      runs.set(sid, openRun(db, sid, '{}'));
    }
    const raw = insertRaw(db, {
      sourceId: sid, sourceSlug: srcSlug, runId: runs.get(sid)!, externalId: String(input.externalId),
      url: String(input.originalUrl ?? 'https://example.org/x'), rawFormat: 'json', payload: '{}',
    });
    return upsertNormalized(db, {
      sourceId: sid, rawDocumentId: raw.id, input: input as never,
      licence: LICENCE, accessType: connector === 'dip' ? 'api_key' : 'public', collectedAt: NOW.toISOString(),
    }).id;
  };
  return { db, add };
}

function gesetze(db: ReturnType<typeof setup>['db']): Gesetz[] {
  return buildProjection(db, { now: NOW }).data.GESETZE as Gesetz[];
}

// ── DIP-Pins für EEG (331000) und Netzpaket (332638): belegte Vorgangspositionen ──
function seedEegDip(add: ReturnType<typeof setup>['add']): void {
  add('dip', 'Bundestag DIP', 'dip', {
    docType: 'vorgang', title: 'EEG-Novelle 2026', externalId: 'dip-vorgang-331000',
    publishedAt: '2026-06-05T07:00:00.000Z', originalUrl: 'https://dip.bundestag.de/vorgang/331000',
    dossierSlugs: ['eeg-novelle'], meta: { beratungsstand: 'Überwiesen' },
  });
  add('dip', 'Bundestag DIP', 'dip', {
    docType: 'vorgangsposition', title: '1. Beratung (BT)', externalId: 'dip-vp-eeg-1',
    publishedAt: '2026-06-15T08:00:00.000Z', dossierSlugs: ['eeg-novelle'],
    meta: { positionstyp: '1. Beratung', zuordnung: 'BT', vorgang_id: '331000', event_date: '2026-06-15T08:00:00.000Z' },
  });
}

function seedNetzpaketDip(add: ReturnType<typeof setup>['add']): void {
  add('dip', 'Bundestag DIP', 'dip', {
    docType: 'vorgang', title: 'EnWG-Novelle Netzanschluss', externalId: 'dip-vorgang-332638',
    publishedAt: '2026-03-20T07:00:00.000Z', originalUrl: 'https://dip.bundestag.de/vorgang/332638',
    dossierSlugs: ['netzausbau'], meta: { beratungsstand: 'Den Ausschüssen zugewiesen' },
  });
  // Aussagekräftige Position …
  add('dip', 'Bundestag DIP', 'dip', {
    docType: 'vorgangsposition', title: 'Überweisung (BT)', externalId: 'dip-vp-netz-1',
    publishedAt: '2026-04-28T08:00:00.000Z', dossierSlugs: ['netzausbau'],
    meta: { positionstyp: 'Überweisung', zuordnung: 'BT', vorgang_id: '332638', event_date: '2026-04-28T08:00:00.000Z' },
  });
  // … und eine JÜNGERE Position OHNE positionstyp (der bisherige „(BR)"-Bug): muss übersprungen werden.
  add('dip', 'Bundestag DIP', 'dip', {
    docType: 'vorgangsposition', title: '(BR)', externalId: 'dip-vp-netz-2',
    publishedAt: '2026-05-02T08:00:00.000Z', dossierSlugs: ['netzausbau'],
    meta: { positionstyp: '', zuordnung: 'BR', vorgang_id: '332638', event_date: '2026-05-02T08:00:00.000Z' },
  });
}

describe('deriveLegislationSignals – Hilfsfunktionen', () => {
  it('detectAction erkennt Kabinettsbeschlüsse, sonst nichts (kein Raten)', () => {
    expect(detectAction('Bundeskabinett beschließt Gebäudemodernisierungsgesetz')).toBe('Kabinettsbeschluss');
    expect(detectAction('Kabinettsbeschluss zum Energiewirtschaftsgesetz')).toBe('Kabinettsbeschluss');
    expect(detectAction('BNetzA stellt Überlegungen zur Netzentgeltreform vor')).toBeNull();
    expect(detectAction('Irgendeine Pressemitteilung')).toBeNull();
  });

  it('sourceTyp ordnet Quellen ihrem Typ zu', () => {
    expect(sourceTyp('Bundeswirtschaftsministerium')).toBe('BMWE');
    expect(sourceTyp('Bundesnetzagentur')).toBe('BNetzA');
    expect(sourceTyp('Bundesregierung')).toBe('Bundesregierung');
    expect(sourceTyp('Bundestag DIP')).toBe('DIP');
  });
});

describe('GESETZE-Projektion: belegte Signale statt 2024-Demo', () => {
  // Test 1 + Test 2
  it('Test 1/2: gemergte Pins aus #9 erscheinen; eeg heißt „EEG-Novelle 2026" mit DIP-Stand', () => {
    const { db, add } = setup();
    seedEegDip(add);
    const eeg = gesetze(db).find((g) => g.id === 'eeg-2024')!;
    expect(eeg.name).toBe('EEG-Novelle 2026');
    expect(eeg.letzteAktion).toBe('1. Beratung (BT) – 15.06.2026'); // aus DIP 331000, nicht Overlay/2024
    expect(eeg.quelle).toEqual({ url: 'https://dip.bundestag.de/vorgang/331000', datum: '2026-06-15', typ: 'DIP' });
    expect(eeg.letzteAktion).not.toMatch(/2024/);
  });

  // Test 3
  it('Test 3: netzpaket.letzteAktion kommt aus DIP 332638 – aussagekräftiges Label statt „(BR)"', () => {
    const { db, add } = setup();
    seedNetzpaketDip(add);
    const netz = gesetze(db).find((g) => g.id === 'netzpaket')!;
    expect(netz.letzteAktion).toBe('Überweisung (BT) – 28.04.2026'); // jüngere leere Position übersprungen
    expect(netz.letzteAktion).not.toContain('(BR)');
    expect(netz.quelle?.typ).toBe('DIP');
    expect(netz.quelle?.url).toBe('https://dip.bundestag.de/vorgang/332638');
    expect(netz.letzteAktion).not.toMatch(/2024/);
  });

  // Test 4
  it('Test 4: gmodg wird als „Gebäudemodernisierungsgesetz" ausgegeben', () => {
    const { db } = setup();
    const gmodg = gesetze(db).find((g) => g.id === 'gmodg')!;
    expect(gmodg.name).toBe('Gebäudemodernisierungsgesetz');
  });

  // Test 5
  it('Test 5: gmodg.letzteAktion stammt aus belegtem BMWE-Signal vom 13.05.2026', () => {
    const { db, add } = setup();
    const url = 'https://www.bundeswirtschaftsministerium.de/test-gebaeudemodernisierungsgesetz.html';
    add('rss-bmwe', 'Bundeswirtschaftsministerium', 'rss', {
      docType: 'pressemitteilung',
      title: 'Neue Weichenstellung für den Gebäudebereich – Bundeskabinett beschließt Gebäudemodernisierungsgesetz',
      externalId: 'bmwe-gmodg-1', publishedAt: '2026-05-13T09:00:00.000Z', originalUrl: url,
      dossierSlugs: ['genehmigungsmodernisierung'],
    });
    const gmodg = gesetze(db).find((g) => g.id === 'gmodg')!;
    expect(gmodg.letzteAktion).toBe('Kabinettsbeschluss 13.05.2026');
    expect(gmodg.quelle).toEqual({ url, datum: '2026-05-13', typ: 'BMWE' });
  });

  // Test 6
  it('Test 6: alte 2024-Overlay-Werte verlieren gegen ein neueres belegtes 2026-Signal', () => {
    const { db, add } = setup();
    const ov: Overlays = {
      gesetze: {
        gmodg: {
          name: 'Gebäudemodernisierungsgesetz', kurz: 'GebMoG', beschreibung: 'kuratiert',
          ressort: 'BMWE', referat: 'k. A.', prioritaet: 'mittel', tags: ['markt'],
          ansprechpartner: { ministerium: [], bundestag: [] }, positionen: [],
          fallback: {
            phase: 0, phasen: [{ label: 'Kabinett', datum: 'Mai 2024', status: 'active' }],
            letzteAktion: 'Eckpunkte veröffentlicht April 2024', // ALTER 2024-Wert
            naechsterSchritt: 'Referentenentwurf erwartet 2024', news: [],
          },
        },
      },
      stakeholder: [], kontakte: [], newsFallback: [], termineManual: [], quelleColors: {},
    } as unknown as Overlays;
    add('rss-bmwe', 'Bundeswirtschaftsministerium', 'rss', {
      docType: 'pressemitteilung', title: 'Bundeskabinett beschließt Gebäudemodernisierungsgesetz',
      externalId: 'bmwe-gmodg-2', publishedAt: '2026-05-13T09:00:00.000Z',
      originalUrl: 'https://www.bundeswirtschaftsministerium.de/x.html',
      dossierSlugs: ['genehmigungsmodernisierung'],
    });
    const g = (projectGesetze(db, ov, new Map(), true) as Gesetz[])[0]!;
    expect(g.letzteAktion).toBe('Kabinettsbeschluss 13.05.2026'); // 2026-Signal gewinnt
    expect(g.letzteAktion).not.toMatch(/2024/);
  });

  // Test 7
  it('Test 7: GESETZE.news enthält nur existierende NEWS-IDs, dedupliziert, neueste zuerst', () => {
    const { db, add } = setup();
    // drei verknüpfte EEG-Dokumente unterschiedlichen Datums; eines wird NICHT auf eine News-ID gemappt
    const dipId = add('dip', 'Bundestag DIP', 'dip', {
      docType: 'vorgang', title: 'EEG-Novelle 2026', externalId: 'dip-vorgang-331000',
      publishedAt: '2026-06-15T07:00:00.000Z', dossierSlugs: ['eeg-novelle'], meta: { beratungsstand: 'Überwiesen' },
    });
    const rssNew = add('rss-bmwe', 'Bundeswirtschaftsministerium', 'rss', {
      docType: 'pressemitteilung', title: 'EEG: Ausschreibung gestartet', externalId: 'rss-eeg-neu',
      publishedAt: '2026-06-16T07:00:00.000Z', dossierSlugs: ['eeg-novelle'],
    });
    const rssOld = add('rss-bmwe', 'Bundeswirtschaftsministerium', 'rss', {
      docType: 'pressemitteilung', title: 'EEG: ältere Meldung', externalId: 'rss-eeg-alt',
      publishedAt: '2026-06-01T07:00:00.000Z', dossierSlugs: ['eeg-novelle'],
    });
    // rssOld bewusst NICHT mappen → darf nicht als tote ID auftauchen
    const map = new Map<number, string>([[rssNew, 'news-1'], [dipId, 'news-2']]);
    const eeg = (projectGesetze(db, loadOverlays(), map, false) as Gesetz[]).find((g) => g.id === 'eeg-2024')!;
    expect(eeg.news).toEqual(['news-1', 'news-2']); // neueste (kleinster Index) zuerst, dedupliziert
    expect(eeg.news).not.toContain(undefined);
    expect(map.has(rssOld)).toBe(false);
  });

  // Test 8
  it('Test 8: politische Felder bleiben kuratiert – auch bei vorhandenem Signal', () => {
    const { db, add } = setup();
    seedEegDip(add);
    const eeg = gesetze(db).find((g) => g.id === 'eeg-2024')!;
    const ovEeg = loadOverlays().gesetze['eeg-2024']!;
    expect(eeg.prioritaet).toBe(ovEeg.prioritaet);
    expect(eeg.ressort).toBe(ovEeg.ressort);
    expect(eeg.positionen).toEqual(ovEeg.positionen);
    expect(eeg.ansprechpartner).toEqual(ovEeg.ansprechpartner);
  });

  // Test 9
  it('Test 9: ohne Signale bricht nichts – kuratierter 2026-Stand mit Provenienz', () => {
    const { db } = setup(); // Dossiers vorhanden, aber KEINE Dokumente/Signale
    const g = gesetze(db);
    expect(g).toHaveLength(5);
    const eeg = g.find((x) => x.id === 'eeg-2024')!;
    expect(eeg.letzteAktion).toBe('1. Beratung (BT) – 11.06.2026'); // Overlay-Floor (belegt, kein 2024)
    expect(eeg.quelle?.typ).toBe('DIP');
    for (const card of g) {
      expect(typeof card.letzteAktion).toBe('string');
      expect(card.letzteAktion).not.toMatch(/2024/);
    }
  });
});

describe('deriveLegislationSignals: ungepinnte Dossiers ziehen keine falschen DIP-Treffer', () => {
  it('netzentgelte (ohne Pin) bekommt kein DIP-Signal aus lose verknüpften Vorgängen', () => {
    const { db, add } = setup();
    // EnWG-naher DIP-Vorgang lose an netzentgelte gehängt – darf NICHT als letzteAktion erscheinen.
    add('dip', 'Bundestag DIP', 'dip', {
      docType: 'vorgang', title: 'Irgendein EnWG-Vorgang', externalId: 'dip-vorgang-999999',
      publishedAt: '2026-06-10T07:00:00.000Z', dossierSlugs: ['netzentgelte'], meta: { beratungsstand: 'Überwiesen' },
    });
    const signals = deriveLegislationSignals(db);
    // netzentgelte hat keinen Pin und keine eindeutige offizielle Aktion → kein abgeleitetes Signal
    expect(signals.has('netzentgelte')).toBe(false);
    const netzentg = gesetze(db).find((g) => g.id === 'netzentgelte')!;
    expect(netzentg.letzteAktion).not.toMatch(/Überwiesen/);
    expect(netzentg.quelle?.typ).toBe('BNetzA'); // kuratierter BNetzA-Stand bleibt
  });
});
