import type { DatabaseSync } from 'node:sqlite';

import { formatDatumKurz } from './format.js';
import type { GesetzQuelle } from './overlays.js';

/**
 * Strukturierte Ableitung von Gesetzgebungs-Signalen je Frontend-Gesetz.
 *
 * Quellen & Priorität (Regel 1 aus dem Auftrag):
 *   1. gepinnter DIP-Vorgang (Vorgangsposition > Beratungsstand)
 *   2. eindeutig gematchte offizielle Quelle mit Datum (BMWE/BReg-Kabinettsbeschluss)
 *   3. (Fallback in der Projektion) kuratierter Overlay-Wert
 *
 * Rein deterministisch und regelbasiert: keine LLM-Erfindung, kein freies
 * Markdown-Parsing. Jedes Signal trägt seine Provenienz (URL/Datum/Quellentyp).
 * Alte 2024-Overlay-Werte können so von neueren belegten Signalen verdrängt
 * werden, ohne dass politische Felder (Priorität, Positionen, Ansprechpartner,
 * Ressort) jemals automatisch erzeugt werden.
 */
export interface LegislationSignal {
  letzteAktion: string;
  quelle: GesetzQuelle;
}

const DIP_VORGANG_URL = (vid: string): string => `https://dip.bundestag.de/vorgang/${vid}`;

function isoDay(iso: string | null | undefined): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/** Quellentyp aus dem Quellen-/Institutionsnamen ableiten (für die Provenienz). */
export function sourceTyp(name: string): string {
  const n = name.toLowerCase();
  if (/bundeswirtschaft|bmwe|bmwk/.test(n)) return 'BMWE';
  if (/bundesnetzagentur|bnetza/.test(n)) return 'BNetzA';
  if (/bundesregierung|bundeskanzler|breg/.test(n)) return 'Bundesregierung';
  if (/bundestag|dip/.test(n)) return 'DIP';
  return name;
}

/**
 * Erkennt eindeutige, belegte Gesetzgebungs-Aktionen in offiziellen PM-Titeln.
 * Bewusst eng gehalten (kein Raten): nur klar benannte Verfahrensschritte.
 */
export function detectAction(title: string): string | null {
  const t = title.toLowerCase();
  if (/kabinett\s+beschließt|bundeskabinett\s+beschließt|kabinettsbeschluss|vom\s+kabinett\s+beschlossen/.test(t)) {
    return 'Kabinettsbeschluss';
  }
  return null;
}

/**
 * DIP-Signal eines gepinnten Vorgangs.
 * Bevorzugt die jüngste *aussagekräftige* Vorgangsposition (nicht-leerer
 * positionstyp – verhindert nichtssagende Labels wie „(BR)"), sonst den
 * Beratungsstand des Vorgangs.
 */
function dipSignal(db: DatabaseSync, vid: string): LegislationSignal | null {
  const pos = db
    .prepare(
      `SELECT json_extract(meta_json,'$.positionstyp') AS typ,
              json_extract(meta_json,'$.zuordnung')   AS zuord,
              COALESCE(json_extract(meta_json,'$.event_date'), published_at) AS d,
              original_url AS url
       FROM normalized_documents
       WHERE doc_type='vorgangsposition'
         AND json_extract(meta_json,'$.vorgang_id') = ?
         AND duplicate_of IS NULL
         AND TRIM(COALESCE(json_extract(meta_json,'$.positionstyp'),'')) <> ''
         AND COALESCE(json_extract(meta_json,'$.event_date'), published_at) IS NOT NULL
       ORDER BY d DESC LIMIT 1`,
    )
    .get(vid) as { typ: string | null; zuord: string | null; d: string | null; url: string | null } | undefined;
  if (pos && pos.d) {
    const label = [pos.typ, pos.zuord ? `(${pos.zuord})` : ''].filter(Boolean).join(' ');
    return {
      letzteAktion: `${label} – ${formatDatumKurz(pos.d)}`,
      quelle: { url: pos.url ?? DIP_VORGANG_URL(vid), datum: isoDay(pos.d), typ: 'DIP' },
    };
  }
  const v = db
    .prepare(
      `SELECT json_extract(meta_json,'$.beratungsstand') AS stand, published_at AS d, original_url AS url
       FROM normalized_documents
       WHERE doc_type='vorgang' AND external_id = ? AND duplicate_of IS NULL LIMIT 1`,
    )
    .get(`dip-vorgang-${vid}`) as { stand: string | null; d: string | null; url: string | null } | undefined;
  if (v && v.stand) {
    return {
      letzteAktion: v.d ? `${v.stand} – ${formatDatumKurz(v.d)}` : v.stand,
      quelle: { url: v.url ?? DIP_VORGANG_URL(vid), datum: isoDay(v.d), typ: 'DIP' },
    };
  }
  return null;
}

/**
 * Offizielles Signal für ein Dossier ohne DIP-Pin: jüngste verknüpfte
 * Pressemitteilung/RSS-Meldung mit eindeutig benannter Aktion (z. B.
 * Kabinettsbeschluss). Verhindert „falsche DIP-Treffer" für Regulierungs-
 * themen (Regel 5) und stützt sich nur auf belegte, datierte Quellen.
 */
function officialSignal(db: DatabaseSync, dossierId: number): LegislationSignal | null {
  const rows = db
    .prepare(
      `SELECT nd.title, nd.published_at AS d, nd.original_url AS url, s.name AS src
       FROM dossier_documents dd
       JOIN normalized_documents nd ON nd.id = dd.normalized_document_id
       JOIN sources s ON s.id = nd.source_id
       WHERE dd.dossier_id = ?
         AND nd.doc_type IN ('pressemitteilung','rss_article')
         AND nd.duplicate_of IS NULL
         AND nd.published_at IS NOT NULL
       ORDER BY nd.published_at DESC`,
    )
    .all(dossierId) as Array<{ title: string; d: string; url: string | null; src: string }>;
  for (const r of rows) {
    const action = detectAction(r.title);
    if (action) {
      return {
        letzteAktion: `${action} ${formatDatumKurz(r.d)}`,
        quelle: { url: r.url ?? null, datum: isoDay(r.d), typ: sourceTyp(r.src) },
      };
    }
  }
  return null;
}

/**
 * Leitet je Gesetz (frontend_gesetz_id) ein belegtes Signal ab — oder keines,
 * dann greift in der Projektion der kuratierte Overlay-Fallback.
 * Gepinnte Dossiers nutzen ausschließlich ihren DIP-Vorgang (autoritativ),
 * ungepinnte nur eindeutige offizielle Quellen.
 */
export function deriveLegislationSignals(db: DatabaseSync): Map<string, LegislationSignal> {
  const map = new Map<string, LegislationSignal>();
  const dossiers = db
    .prepare(
      `SELECT id, frontend_gesetz_id AS gid, dip_vorgang_id AS vid
       FROM dossiers WHERE frontend_gesetz_id IS NOT NULL ORDER BY frontend_gesetz_id`,
    )
    .all() as Array<{ id: number; gid: string; vid: string | null }>;
  for (const { id, gid, vid } of dossiers) {
    if (map.has(gid)) continue; // erstes Dossier je Gesetz gewinnt (stabil)
    const sig = vid ? dipSignal(db, vid) : officialSignal(db, id);
    if (sig) map.set(gid, sig);
  }
  return map;
}
