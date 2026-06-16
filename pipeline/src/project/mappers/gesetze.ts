import type { DatabaseSync } from 'node:sqlite';

import { formatDatumKurz } from '../format.js';
import type { Overlays } from '../overlays.js';

/**
 * GESETZE-Projektion. Kuratierte Overlays sind die Basis und behalten Vorrang.
 * Aus DIP/RSS werden faktenbasiert NUR ergänzt:
 *  - news: aus dossier_documents verknüpfte, projizierte NEWS (DIP + RSS).
 *  - letzteAktion: NUR wenn das Dossier eine kuratierte dip_vorgang_id besitzt
 *    (eindeutige Bindung an genau einen DIP-Vorgang); sonst bleibt der Overlay-Wert.
 * phase, nächsterSchritt, prioritaet, positionen, ansprechpartner, beschreibung,
 * ressort, tags bleiben vollständig kuratiert.
 */
export function projectGesetze(
  db: DatabaseSync,
  overlays: Overlays,
  docIdToNewsId: Map<number, string>,
  newsUsedFallback: boolean,
): unknown[] {
  const dossierNews = newsDocsByFrontendGesetz(db);
  const pinnedActions = latestActionByGesetz(db);
  return Object.entries(overlays.gesetze).map(([id, ov]) => {
    let news: string[];
    if (newsUsedFallback) {
      news = ov.fallback.news;
    } else {
      news = (dossierNews.get(id) ?? [])
        .map((docId) => docIdToNewsId.get(docId))
        .filter((n): n is string => n !== undefined);
    }
    return {
      id,
      name: ov.name,
      kurz: ov.kurz,
      beschreibung: ov.beschreibung,
      ressort: ov.ressort,
      referat: ov.referat,
      prioritaet: ov.prioritaet,
      phase: ov.fallback.phase,
      phasen: ov.fallback.phasen,
      tags: ov.tags,
      // Nur via eindeutigem dip_vorgang_id-Pin aktualisieren, sonst kuratierter Wert.
      letzteAktion: pinnedActions.get(id) ?? ov.fallback.letzteAktion,
      'nächsterSchritt': ov.fallback.naechsterSchritt,
      ansprechpartner: ov.ansprechpartner,
      positionen: ov.positionen,
      news,
    };
  });
}

function newsDocsByFrontendGesetz(db: DatabaseSync): Map<string, number[]> {
  const rows = db
    .prepare(
      `SELECT d.frontend_gesetz_id AS gid, dd.normalized_document_id AS doc_id
       FROM dossier_documents dd
       JOIN dossiers d ON d.id = dd.dossier_id
       WHERE d.frontend_gesetz_id IS NOT NULL
       ORDER BY dd.match_score DESC`,
    )
    .all() as Array<{ gid: string; doc_id: number }>;
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const list = map.get(r.gid) ?? [];
    list.push(r.doc_id);
    map.set(r.gid, list);
  }
  return map;
}

/**
 * letzteAktion je Gesetz aus dem kuratiert gepinnten DIP-Vorgang ableiten.
 * Bevorzugt die jüngste Vorgangsposition, sonst den Beratungsstand des Vorgangs.
 * Liefert nur Einträge für Dossiers mit gesetzter dip_vorgang_id und vorhandenen Daten.
 */
function latestActionByGesetz(db: DatabaseSync): Map<string, string> {
  const map = new Map<string, string>();
  const pins = db
    .prepare(
      `SELECT frontend_gesetz_id AS gid, dip_vorgang_id AS vid
       FROM dossiers WHERE frontend_gesetz_id IS NOT NULL AND dip_vorgang_id IS NOT NULL`,
    )
    .all() as Array<{ gid: string; vid: string }>;

  const posStmt = db.prepare(
    `SELECT json_extract(meta_json,'$.positionstyp') AS typ,
            json_extract(meta_json,'$.zuordnung')   AS zuord,
            COALESCE(json_extract(meta_json,'$.event_date'), published_at) AS d
     FROM normalized_documents
     WHERE doc_type='vorgangsposition' AND json_extract(meta_json,'$.vorgang_id') = ?
       AND COALESCE(json_extract(meta_json,'$.event_date'), published_at) IS NOT NULL
     ORDER BY d DESC LIMIT 1`,
  );
  const vorgangStmt = db.prepare(
    `SELECT json_extract(meta_json,'$.beratungsstand') AS stand, published_at AS d
     FROM normalized_documents WHERE doc_type='vorgang' AND external_id = ? LIMIT 1`,
  );

  for (const { gid, vid } of pins) {
    const pos = posStmt.get(vid) as { typ: string | null; zuord: string | null; d: string | null } | undefined;
    if (pos && pos.d) {
      const label = [pos.typ, pos.zuord ? `(${pos.zuord})` : ''].filter(Boolean).join(' ') || 'Vorgangsposition';
      map.set(gid, `${label} – ${formatDatumKurz(pos.d)}`);
      continue;
    }
    const v = vorgangStmt.get(`dip-vorgang-${vid}`) as { stand: string | null; d: string | null } | undefined;
    if (v && v.stand && v.d) map.set(gid, `${v.stand} – ${formatDatumKurz(v.d)}`);
  }
  return map;
}
