import type { DatabaseSync } from 'node:sqlite';

import type { Overlays } from '../overlays.js';

/**
 * GESETZE-Projektion. MVP: kuratierte Basis + Fallback-Status aus dem Overlay.
 * Sobald DIP-Daten vorliegen (spätere Ausbaustufe), liefern Pipeline-Daten
 * phasen/letzteAktion/nächsterSchritt; das Overlay bleibt für die kuratierten
 * Felder (Beschreibung, Ansprechpartner, Positionen) maßgeblich.
 *
 * Wichtig: GESETZE[].news referenziert NEWS-IDs desselben Laufs. Im Fallback-Modus
 * (NEWS = kuratierte Fallback-News) gelten die kuratierten Referenzen; im DB-Modus
 * werden Referenzen aus dossier_documents abgeleitet (MVP: leer, bis das
 * Clustering aktiviert ist).
 */
export function projectGesetze(
  db: DatabaseSync,
  overlays: Overlays,
  docIdToNewsId: Map<number, string>,
  newsUsedFallback: boolean,
): unknown[] {
  const dossierNews = newsDocsByFrontendGesetz(db);
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
      letzteAktion: ov.fallback.letzteAktion,
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
